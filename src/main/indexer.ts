import { createReadStream, existsSync, promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { createInterface } from 'node:readline'
import type { SessionInfo, TranscriptBlock, TranscriptMessage } from '@shared/types'

/**
 * Lê (somente leitura) as sessões do Claude Code:
 *  - transcripts:  ~/.claude/projects/<proj>/<sessionId>.jsonl   (CLI e Desktop)
 *  - metadados do Desktop: ~/Library/Application Support/Claude/claude-code-sessions/**\/local_*.json
 *  - sessões vivas: ~/.claude/sessions/<pid>.json
 * Nunca escrevemos nesses arquivos — são formatos internos do Claude.
 */

const HOME = homedir()
export const PROJECTS_DIR = join(HOME, '.claude', 'projects')
export const DESKTOP_DIR = join(HOME, 'Library', 'Application Support', 'Claude', 'claude-code-sessions')
const LIVE_DIR = join(HOME, '.claude', 'sessions')

interface DesktopMeta {
  title?: string
  isArchived?: boolean
  originCwd?: string
  cwd?: string
  branch?: string
  model?: string
  createdAt?: number
  lastActivityAt?: number
}

/** Estado acumulado da leitura de um .jsonl — permite continuar do último offset. */
interface ScanState {
  size: number
  mtimeMs: number
  offset: number
  customTitle?: string
  aiTitle?: string
  cwd?: string
  branch?: string
  model?: string
  firstPrompt?: string
  lastPrompt?: string
  firstTimestamp?: number
  messageCount: number
}

type Cache = Record<string, ScanState>

export class SessionIndexer {
  private cache: Cache = {}
  private cacheDirty = false

  constructor(private cacheFile: string) {}

  async load(): Promise<void> {
    try {
      this.cache = JSON.parse(await fs.readFile(this.cacheFile, 'utf8'))
    } catch {
      this.cache = {}
    }
  }

  async persist(): Promise<void> {
    if (!this.cacheDirty) return
    this.cacheDirty = false
    await fs.writeFile(this.cacheFile, JSON.stringify(this.cache))
  }

  async listSessions(): Promise<SessionInfo[]> {
    const [files, desktop, live] = await Promise.all([listTranscriptFiles(), readDesktopMeta(), readLiveSessions()])
    const sessions: SessionInfo[] = []
    const seen = new Set<string>()

    for (const file of files) {
      const id = basename(file, '.jsonl')
      let state: ScanState
      try {
        state = await this.scan(file)
      } catch {
        continue
      }
      seen.add(file)
      if (state.messageCount === 0) continue

      const meta = desktop.get(id)
      const cwd = state.cwd ?? meta?.cwd ?? ''
      const projectPath = meta?.originCwd ?? stripWorktree(cwd)
      sessions.push({
        id,
        title: meta?.title || state.customTitle || state.aiTitle || truncate(state.firstPrompt, 80) || 'Sessão sem título',
        source: meta ? 'desktop' : 'cli',
        cwd,
        projectPath,
        projectName: basename(projectPath) || '~',
        branch: meta?.branch ?? state.branch,
        model: meta?.model ?? state.model,
        firstPrompt: truncate(state.firstPrompt, 400),
        lastPrompt: truncate(state.lastPrompt, 400),
        messageCount: state.messageCount,
        createdAt: meta?.createdAt ?? state.firstTimestamp ?? state.mtimeMs,
        lastActivityAt: Math.max(state.mtimeMs, meta?.lastActivityAt ?? 0),
        archived: meta?.isArchived ?? false,
        live: live.has(id),
        filePath: file
      })
    }

    // Remove do cache arquivos que sumiram.
    for (const key of Object.keys(this.cache)) {
      if (!seen.has(key)) {
        delete this.cache[key]
        this.cacheDirty = true
      }
    }
    void this.persist()

    return sessions.sort((a, b) => b.lastActivityAt - a.lastActivityAt)
  }

  private async scan(file: string): Promise<ScanState> {
    const stat = await fs.stat(file)
    const prev = this.cache[file]
    if (prev && prev.size === stat.size && prev.mtimeMs === stat.mtimeMs) return prev

    // Arquivo cresceu → continua de onde parou. Encolheu/reescrito → do zero.
    const state: ScanState =
      prev && stat.size >= prev.offset ? { ...prev } : { size: 0, mtimeMs: 0, offset: 0, messageCount: 0 }

    const stream = createReadStream(file, { start: state.offset, encoding: 'utf8' })
    const rl = createInterface({ input: stream, crlfDelay: Infinity })
    let consumed = state.offset
    for await (const line of rl) {
      // Só conta como consumida a linha completa (seguida de \n); a última pode estar sendo escrita.
      consumed += Buffer.byteLength(line, 'utf8') + 1
      if (consumed > stat.size) break
      state.offset = consumed
      if (line.length) scanLine(line, state)
    }
    state.size = stat.size
    state.mtimeMs = stat.mtimeMs
    this.cache[file] = state
    this.cacheDirty = true
    return state
  }
}

function scanLine(line: string, s: ScanState): void {
  // Checagens baratas por prefixo antes de qualquer JSON.parse (arquivos chegam a centenas de MB).
  if (line.startsWith('{"type":"custom-title"')) {
    s.customTitle = safeParse(line)?.customTitle ?? s.customTitle
    return
  }
  if (line.startsWith('{"type":"ai-title"')) {
    s.aiTitle = safeParse(line)?.aiTitle ?? s.aiTitle
    return
  }
  if (line.startsWith('{"type":"last-prompt"')) {
    s.lastPrompt = safeParse(line)?.lastPrompt ?? s.lastPrompt
    return
  }
  if (!line.includes('"isSidechain":false')) return
  const isUser = line.includes('"type":"user"')
  const isAssistant = !isUser && line.includes('"type":"assistant"')
  if (!isUser && !isAssistant) return

  // Linhas de tool_result também são "user" — não contam como mensagem humana.
  const isToolResult = isUser && line.includes('"tool_result"')
  if (!isToolResult) s.messageCount++

  const needsDetails = !s.cwd || (isUser && !s.firstPrompt && !isToolResult) || (isAssistant && !s.model)
  if (!needsDetails) return
  const d = safeParse(line)
  if (!d) return
  if (!s.cwd && d.cwd) s.cwd = d.cwd
  if (!s.branch && d.gitBranch && d.gitBranch !== 'HEAD') s.branch = d.gitBranch
  if (!s.firstTimestamp && d.timestamp) s.firstTimestamp = Date.parse(d.timestamp)
  if (isAssistant && !s.model && d.message?.model && d.message.model !== '<synthetic>') s.model = d.message.model
  if (isUser && !s.firstPrompt && !d.isMeta) {
    const text = extractUserText(d.message?.content)
    if (text && !text.startsWith('<') && !text.startsWith('Caveat:')) s.firstPrompt = text
  }
}

async function listTranscriptFiles(): Promise<string[]> {
  const out: string[] = []
  let dirs: string[] = []
  try {
    dirs = await fs.readdir(PROJECTS_DIR)
  } catch {
    return out
  }
  await Promise.all(
    dirs.map(async (d) => {
      try {
        for (const f of await fs.readdir(join(PROJECTS_DIR, d))) {
          if (f.endsWith('.jsonl')) out.push(join(PROJECTS_DIR, d, f))
        }
      } catch {
        /* não é diretório */
      }
    })
  )
  return out
}

async function readDesktopMeta(): Promise<Map<string, DesktopMeta>> {
  const map = new Map<string, DesktopMeta>()
  async function walk(dir: string, depth: number): Promise<void> {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    await Promise.all(
      entries.map(async (e) => {
        const p = join(dir, e.name)
        if (e.isDirectory() && depth < 3) return walk(p, depth + 1)
        if (e.isFile() && e.name.startsWith('local_') && e.name.endsWith('.json')) {
          const d = safeParse(await fs.readFile(p, 'utf8').catch(() => ''))
          if (d?.cliSessionId) map.set(d.cliSessionId, d)
        }
      })
    )
  }
  await walk(DESKTOP_DIR, 0)
  return map
}

async function readLiveSessions(): Promise<Set<string>> {
  const live = new Set<string>()
  let files: string[] = []
  try {
    files = await fs.readdir(LIVE_DIR)
  } catch {
    return live
  }
  for (const f of files) {
    if (!f.endsWith('.json')) continue
    const d = safeParse(await fs.readFile(join(LIVE_DIR, f), 'utf8').catch(() => ''))
    if (!d?.sessionId || !d.pid) continue
    try {
      process.kill(d.pid, 0)
      live.add(d.sessionId)
    } catch {
      /* processo morto — arquivo antigo */
    }
  }
  return live
}

/** Últimas `limit` mensagens da conversa principal (sem subagentes). */
export async function readTranscript(file: string, limit = 400): Promise<TranscriptMessage[]> {
  if (!existsSync(file)) return []
  const ring: TranscriptMessage[] = []
  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line.includes('"isSidechain":false')) continue
    if (!line.includes('"type":"user"') && !line.includes('"type":"assistant"') && !line.includes('"compact_boundary"'))
      continue
    const d = safeParse(line)
    if (!d) continue
    const msg = toMessage(d)
    if (!msg) continue
    ring.push(msg)
    if (ring.length > limit) ring.shift()
  }
  return ring
}

function toMessage(d: any): TranscriptMessage | null {
  if (d.type === 'system' && d.subtype === 'compact_boundary') {
    return { uuid: d.uuid, role: 'system', timestamp: d.timestamp, blocks: [{ kind: 'text', text: 'Conversa compactada' }] }
  }
  if (d.type !== 'user' && d.type !== 'assistant') return null
  if (d.isMeta) return null
  const content = d.message?.content
  const blocks: TranscriptBlock[] = []
  if (typeof content === 'string') {
    blocks.push({ kind: 'text', text: content })
  } else if (Array.isArray(content)) {
    for (const c of content) {
      if (c.type === 'text' && c.text) blocks.push({ kind: 'text', text: c.text })
      else if (c.type === 'thinking' && c.thinking) blocks.push({ kind: 'thinking', text: c.thinking })
      else if (c.type === 'tool_use') blocks.push({ kind: 'tool_use', name: c.name, input: summarizeInput(c.input) })
      else if (c.type === 'tool_result')
        blocks.push({ kind: 'tool_result', text: truncate(extractUserText(c.content), 1200) ?? '', isError: c.is_error })
    }
  }
  if (!blocks.length) return null
  return { uuid: d.uuid, role: d.type, timestamp: d.timestamp, blocks }
}

function summarizeInput(input: any): string {
  if (!input || typeof input !== 'object') return ''
  const v = input.command ?? input.file_path ?? input.pattern ?? input.url ?? input.query ?? input.description ?? input.prompt
  return truncate(typeof v === 'string' ? v : JSON.stringify(input), 300) ?? ''
}

function extractUserText(content: any): string | undefined {
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    const t = content
      .filter((c) => c?.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text)
      .join('\n')
      .trim()
    return t || undefined
  }
  return undefined
}

function stripWorktree(cwd: string): string {
  const i = cwd.indexOf('/.claude/worktrees/')
  return i >= 0 ? cwd.slice(0, i) : cwd
}

function truncate(s: string | undefined, n: number): string | undefined {
  if (!s) return s
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

function safeParse(s: string): any {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}
