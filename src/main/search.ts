import { createReadStream, promises as fs } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { ContextMessage, SearchHit } from '@shared/types'
import { foldPattern, queryTerms } from '@shared/text'

/**
 * Índice de texto de todas as conversas: só o que foi dito (pedidos, respostas e um resumo de cada
 * ferramenta usada), sem resultados de ferramentas — cerca de 2% do tamanho dos transcripts.
 * Lido de forma incremental, como o SessionIndexer, e guardado um arquivo por sessão.
 */

interface Doc {
  /** uuid da mensagem */
  u: string
  r: 'user' | 'assistant'
  /** timestamp (ms) */
  t: number
  /** texto */
  x: string
}

interface SessionText {
  id: string
  file: string
  offset: number
  size: number
  mtimeMs: number
  docs: Doc[]
  /** Arquivos alterados pela sessão (Edit/Write/MultiEdit/NotebookEdit). */
  touched: string[]
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const MAX_DOC = 6000

export class SearchIndex {
  private byId = new Map<string, SessionText>()
  private dirty = new Set<string>()
  private queue: Promise<void> = Promise.resolve()
  private persistTimer: NodeJS.Timeout | null = null
  indexing = false

  constructor(private dir: string) {}

  async load(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true })
    for (const f of await fs.readdir(this.dir)) {
      if (!f.endsWith('.json')) continue
      try {
        const s: SessionText = JSON.parse(await fs.readFile(join(this.dir, f), 'utf8'))
        this.byId.set(s.id, s)
      } catch {
        /* arquivo corrompido: será reindexado */
      }
    }
  }

  get size(): number {
    return this.byId.size
  }

  /** Atualiza o índice com a lista atual de sessões (em fila: nunca duas varreduras ao mesmo tempo). */
  update(sessions: { id: string; filePath: string }[]): Promise<void> {
    this.queue = this.queue.then(() => this.run(sessions)).catch(() => undefined)
    return this.queue
  }

  private async run(sessions: { id: string; filePath: string }[]): Promise<void> {
    this.indexing = true
    const live = new Set<string>()
    for (const s of sessions) {
      if (!s.filePath) continue
      live.add(s.id)
      try {
        await this.scan(s.id, s.filePath)
      } catch {
        /* arquivo sumiu no meio da leitura */
      }
    }
    for (const id of [...this.byId.keys()]) {
      if (live.has(id)) continue
      this.byId.delete(id)
      await fs.rm(join(this.dir, id + '.json'), { force: true })
    }
    this.indexing = false
    this.schedulePersist()
  }

  private async scan(id: string, file: string): Promise<void> {
    const stat = await fs.stat(file)
    const prev = this.byId.get(id)
    if (prev && prev.file === file && prev.size === stat.size && prev.mtimeMs === stat.mtimeMs) return
    const s: SessionText =
      prev && prev.file === file && stat.size >= prev.offset
        ? prev
        : { id, file, offset: 0, size: 0, mtimeMs: 0, docs: [], touched: [] }
    const touched = new Set(s.touched)

    const rl = createInterface({ input: createReadStream(file, { start: s.offset, encoding: 'utf8' }), crlfDelay: Infinity })
    let consumed = s.offset
    for await (const line of rl) {
      consumed += Buffer.byteLength(line, 'utf8') + 1
      if (consumed > stat.size) break
      s.offset = consumed
      const doc = lineToDoc(line, touched)
      if (doc) s.docs.push(doc)
    }
    s.touched = [...touched]
    s.size = stat.size
    s.mtimeMs = stat.mtimeMs
    this.byId.set(id, s)
    this.dirty.add(id)
  }

  private schedulePersist(): void {
    if (this.persistTimer || !this.dirty.size) return
    this.persistTimer = setTimeout(() => void this.persist(), 20_000)
  }

  async persist(): Promise<void> {
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persistTimer = null
    const ids = [...this.dirty]
    this.dirty.clear()
    for (const id of ids) {
      const s = this.byId.get(id)
      if (!s) continue
      const tmp = join(this.dir, id + '.json.tmp')
      await fs.writeFile(tmp, JSON.stringify(s))
      await fs.rename(tmp, join(this.dir, id + '.json'))
    }
  }

  /**
   * Busca mensagens que contêm todos os termos (sem diferenciar maiúsculas e acentos).
   * Retorna por sessão, da sessão com o resultado mais recente para a mais antiga.
   */
  search(
    query: string,
    opts: { sessionIds?: Set<string>; role?: 'user' | 'assistant'; perSession?: number; maxSessions?: number } = {}
  ): { sessionId: string; total: number; lastHit: number; hits: SearchHit[] }[] {
    const terms = queryTerms(query)
    if (!terms.length) return []
    const res = terms.map((t) => new RegExp(foldPattern(t).replace(/ +/g, '\\s+'), 'i'))
    const perSession = opts.perSession ?? 4
    const groups: { sessionId: string; total: number; lastHit: number; hits: SearchHit[] }[] = []

    for (const s of this.byId.values()) {
      if (opts.sessionIds && !opts.sessionIds.has(s.id)) continue
      let total = 0
      let lastHit = 0
      const hits: SearchHit[] = []
      // Do fim para o começo: os trechos mais recentes primeiro.
      for (let i = s.docs.length - 1; i >= 0; i--) {
        const d = s.docs[i]
        if (opts.role && d.r !== opts.role) continue
        if (!res.every((re) => re.test(d.x))) continue
        total++
        lastHit = Math.max(lastHit, d.t)
        if (hits.length < perSession) hits.push({ uuid: d.u, role: d.r, timestamp: d.t, snippet: snippet(d.x, res[0]) })
      }
      if (total) groups.push({ sessionId: s.id, total, lastHit, hits })
    }
    groups.sort((a, b) => b.lastHit - a.lastHit)
    return groups.slice(0, opts.maxSessions ?? 60)
  }

  /** Mensagens em volta de uma mensagem (ou as últimas da sessão, sem `uuid`). */
  context(sessionId: string, uuid?: string, radius = 4): ContextMessage[] {
    const s = this.byId.get(sessionId)
    if (!s) return []
    const i = uuid ? s.docs.findIndex((d) => d.u === uuid) : s.docs.length - 1
    if (i < 0) return []
    const from = uuid ? Math.max(0, i - radius) : Math.max(0, s.docs.length - radius * 2)
    return s.docs
      .slice(from, i + radius + 1)
      .map((d) => ({ uuid: d.u, role: d.r, timestamp: d.t, text: d.x, match: d.u === uuid }))
  }

  /** Todas as mensagens de uma sessão (para resumos). */
  messages(sessionId: string): ContextMessage[] {
    return (this.byId.get(sessionId)?.docs ?? []).map((d) => ({ uuid: d.u, role: d.r, timestamp: d.t, text: d.x }))
  }

  touched(sessionId: string): string[] {
    return this.byId.get(sessionId)?.touched ?? []
  }

  /** Sessões que alteraram um arquivo (caminho absoluto ou final do caminho). */
  sessionsTouching(path: string): string[] {
    const out: string[] = []
    for (const s of this.byId.values()) if (s.touched.some((f) => f === path || f.endsWith('/' + path.replace(/^\/+/, '')))) out.push(s.id)
    return out
  }
}

function lineToDoc(line: string, touched: Set<string>): Doc | null {
  if (!line.includes('"isSidechain":false')) return null
  const isUser = line.includes('"type":"user"')
  if (!isUser && !line.includes('"type":"assistant"')) return null
  // Resultados de ferramentas são o grosso do volume e não interessam à busca.
  if (isUser && line.includes('"tool_result"')) return null
  let d: any
  try {
    d = JSON.parse(line)
  } catch {
    return null
  }
  if (d.isMeta || (d.type !== 'user' && d.type !== 'assistant')) return null
  const content = d.message?.content
  const parts: string[] = []
  if (typeof content === 'string') parts.push(content)
  else if (Array.isArray(content)) {
    for (const c of content) {
      if (c?.type === 'text' && c.text) parts.push(c.text)
      else if (c?.type === 'tool_use') {
        const inp = c.input ?? {}
        if (EDIT_TOOLS.has(c.name) && typeof (inp.file_path ?? inp.notebook_path) === 'string')
          touched.add(inp.file_path ?? inp.notebook_path)
        const what = inp.file_path ?? inp.command ?? inp.pattern ?? inp.url ?? inp.query ?? inp.description ?? ''
        parts.push(`⚙ ${c.name}${what ? ': ' + String(what).slice(0, 300) : ''}`)
      }
    }
  }
  let x = parts.join('\n').trim()
  // Saídas de comandos locais e lembretes do sistema não são conversa.
  if (!x || (isUser && /^<(local-command|command-|system-reminder|bash-)/.test(x))) return null
  if (x.length > MAX_DOC) x = x.slice(0, MAX_DOC) + '…'
  return { u: d.uuid, r: d.type, t: Date.parse(d.timestamp) || 0, x }
}

function snippet(text: string, re: RegExp): string {
  const m = re.exec(text)
  const at = m?.index ?? 0
  const start = Math.max(0, at - 90)
  const end = Math.min(text.length, at + 210)
  return (start > 0 ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ').trim() + (end < text.length ? '…' : '')
}
