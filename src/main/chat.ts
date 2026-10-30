import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import type {
  CanUseTool,
  PermissionResult,
  PermissionUpdate,
  Query,
  SDKMessage,
  SDKUserMessage
} from '@anthropic-ai/claude-agent-sdk'
import type { ChatEvent, ChatSendOptions, PermissionMode } from '@shared/types'
import { summarizeInput, toMessage } from './indexer'
import { loginShellEnv } from './shellEnv'

/** Fecha o processo do `claude` depois de um tempo ocioso — a sessão continua no disco e é retomada no próximo envio. */
const IDLE_CLOSE_MS = 20 * 60 * 1000

interface PendingPermission {
  resolve: (r: PermissionResult) => void
  input: Record<string, unknown>
  suggestions?: PermissionUpdate[]
}

/** Fila de mensagens do usuário consumida pelo SDK (modo de entrada em streaming). */
class InputQueue implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = []
  private waiter: ((r: IteratorResult<SDKUserMessage>) => void) | null = null
  private closed = false

  push(m: SDKUserMessage): void {
    if (this.waiter) {
      this.waiter({ value: m, done: false })
      this.waiter = null
    } else this.items.push(m)
  }

  close(): void {
    this.closed = true
    this.waiter?.({ value: undefined, done: true })
    this.waiter = null
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const m = this.items.shift()
        if (m) return Promise.resolve({ value: m, done: false })
        if (this.closed) return Promise.resolve({ value: undefined, done: true })
        return new Promise((r) => (this.waiter = r))
      }
    }
  }
}

interface ChatSession {
  key: string
  query: Query
  input: InputQueue
  permissions: Map<string, PendingPermission>
  running: boolean
  idleTimer?: NodeJS.Timeout
  draft: { kind: 'text' | 'thinking'; text: string } | null
  draftTimer?: NodeJS.Timeout
  /** Último init — reenviado se a janela recarregar. */
  init?: Extract<ChatEvent, { type: 'init' }>
}

export class ChatManager {
  private sessions = new Map<string, ChatSession>()

  constructor(private emit: (key: string, ev: ChatEvent) => void) {}

  active(): string[] {
    return [...this.sessions.keys()]
  }

  /** Estado atual de uma sessão viva, para a interface se reidratar após um reload. */
  info(key: string): { init?: ChatEvent; running: boolean } | null {
    const s = this.sessions.get(key)
    return s ? { init: s.init, running: s.running } : null
  }

  has(key: string): boolean {
    return this.sessions.has(key)
  }

  async send(o: ChatSendOptions): Promise<{ ok: boolean; error?: string }> {
    let s = this.sessions.get(o.key)
    if (!s) {
      try {
        s = await this.start(o)
      } catch (err) {
        this.emit(o.key, { type: 'state', state: 'error', error: String(err) })
        return { ok: false, error: String(err) }
      }
    }
    clearTimeout(s.idleTimer)
    const uuid = randomUUID()
    s.input.push({
      type: 'user',
      message: { role: 'user', content: o.text },
      parent_tool_use_id: null,
      uuid
    } as SDKUserMessage)
    this.emit(o.key, {
      type: 'message',
      message: { uuid, role: 'user', timestamp: new Date().toISOString(), blocks: [{ kind: 'text', text: o.text }] }
    })
    s.running = true
    this.emit(o.key, { type: 'state', state: 'running' })
    return { ok: true }
  }

  private async start(o: ChatSendOptions): Promise<ChatSession> {
    this.emit(o.key, { type: 'state', state: 'starting' })
    const [{ query }, { env, claudePath }] = await Promise.all([
      import('@anthropic-ai/claude-agent-sdk'),
      loginShellEnv()
    ])
    if (!claudePath) throw new Error('Não encontrei o `claude` no seu PATH. Instale o Claude Code CLI.')

    const input = new InputQueue()
    const permissions = new Map<string, PendingPermission>()
    const key = o.key

    const canUseTool: CanUseTool = (toolName, toolInput, opts) =>
      new Promise<PermissionResult>((resolve) => {
        const id = randomUUID()
        permissions.set(id, { resolve, input: toolInput, suggestions: opts.suggestions })
        opts.signal.addEventListener('abort', () => {
          if (!permissions.delete(id)) return
          this.emit(key, { type: 'permission-done', id })
          resolve({ behavior: 'deny', message: 'Cancelado.' })
        })
        this.emit(key, {
          type: 'permission',
          request: {
            id,
            toolName,
            title: opts.title ?? `Claude quer usar ${opts.displayName ?? toolName}`,
            description: opts.description ?? opts.decisionReason,
            detail: summarizeInput(toolInput) || JSON.stringify(toolInput).slice(0, 400),
            canAlwaysAllow: !opts.suppressAlwaysAllowRule && !!opts.suggestions?.length
          }
        })
      })

    const q = query({
      prompt: input,
      options: {
        cwd: existsSync(o.cwd) ? o.cwd : homedir(),
        resume: o.resumeId,
        sessionId: o.newSessionId,
        pathToClaudeCodeExecutable: claudePath,
        env,
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        includePartialMessages: true,
        permissionMode: o.permissionMode,
        allowDangerouslySkipPermissions: true,
        model: o.model,
        canUseTool,
        // A interface do Jarvis ainda não tem o formulário de perguntas — Claude pergunta em texto.
        disallowedTools: ['AskUserQuestion']
      }
    })

    const s: ChatSession = { key, query: q, input, permissions, running: false, draft: null }
    this.sessions.set(key, s)
    void this.pump(s)
    return s
  }

  private async pump(s: ChatSession): Promise<void> {
    let modelsSent = false
    try {
      for await (const m of s.query) {
        this.handle(s, m)
        if (m.type === 'system' && m.subtype === 'init' && !modelsSent) {
          modelsSent = true
          const models = await s.query.supportedModels().catch(() => [])
          s.init = {
            type: 'init',
            model: m.model,
            permissionMode: m.permissionMode as PermissionMode,
            models: models.map((x) => ({ value: x.value, label: x.displayName }))
          }
          this.emit(s.key, s.init)
        }
      }
      this.emit(s.key, { type: 'state', state: 'idle' })
    } catch (err) {
      this.emit(s.key, { type: 'state', state: 'error', error: err instanceof Error ? err.message : String(err) })
    } finally {
      this.dispose(s)
    }
  }

  private handle(s: ChatSession, m: SDKMessage): void {
    // Subagentes rodam "dentro" de uma ferramenta — por ora mostramos só a conversa principal.
    if ('parent_tool_use_id' in m && m.parent_tool_use_id) return

    switch (m.type) {
      case 'stream_event': {
        const ev = m.event
        if (ev.type === 'content_block_start') {
          const kind = ev.content_block.type
          s.draft = kind === 'text' || kind === 'thinking' ? { kind, text: '' } : null
        } else if (ev.type === 'content_block_delta' && s.draft) {
          if (ev.delta.type === 'text_delta') s.draft.text += ev.delta.text
          else if (ev.delta.type === 'thinking_delta') s.draft.text += ev.delta.thinking
          this.flushDraftSoon(s)
        }
        return
      }
      case 'assistant':
      case 'user': {
        const msg = toMessage({ type: m.type, uuid: m.uuid, message: m.message, timestamp: new Date().toISOString() })
        if (m.type === 'assistant') {
          s.draft = null
          clearTimeout(s.draftTimer)
          s.draftTimer = undefined
          this.emit(s.key, { type: 'draft-clear' })
        }
        if (msg) this.emit(s.key, { type: 'message', message: msg })
        return
      }
      case 'system':
        if (m.subtype === 'compact_boundary')
          this.emit(s.key, {
            type: 'message',
            message: { uuid: m.uuid, role: 'system', blocks: [{ kind: 'text', text: 'Conversa compactada' }] }
          })
        return
      case 'result':
        s.running = false
        this.emit(s.key, { type: 'draft-clear' })
        this.emit(s.key, {
          type: 'result',
          costUsd: m.total_cost_usd,
          durationMs: m.duration_ms,
          isError: m.is_error,
          error: m.subtype === 'success' ? undefined : m.errors?.join('\n')
        })
        this.emit(s.key, { type: 'state', state: 'idle' })
        s.idleTimer = setTimeout(() => this.close(s.key), IDLE_CLOSE_MS)
        return
    }
  }

  /** Agrupa os deltas de streaming (~20 fps) para não inundar o IPC. */
  private flushDraftSoon(s: ChatSession): void {
    if (s.draftTimer) return
    s.draftTimer = setTimeout(() => {
      s.draftTimer = undefined
      if (s.draft) this.emit(s.key, { type: 'draft', kind: s.draft.kind, text: s.draft.text })
    }, 50)
  }

  respondPermission(key: string, id: string, decision: 'allow' | 'always' | 'deny'): void {
    const s = this.sessions.get(key)
    const p = s?.permissions.get(id)
    if (!s || !p) return
    s.permissions.delete(id)
    this.emit(key, { type: 'permission-done', id })
    if (decision === 'deny') p.resolve({ behavior: 'deny', message: 'O usuário negou esta ação pelo Jarvis.' })
    else
      p.resolve({
        behavior: 'allow',
        updatedInput: p.input,
        updatedPermissions: decision === 'always' ? p.suggestions : undefined
      })
  }

  async interrupt(key: string): Promise<void> {
    await this.sessions.get(key)?.query.interrupt().catch(() => undefined)
  }

  async setPermissionMode(key: string, mode: PermissionMode): Promise<void> {
    const s = this.sessions.get(key)
    await s?.query.setPermissionMode(mode)
    if (s?.init) s.init = { ...s.init, permissionMode: mode }
  }

  async setModel(key: string, model: string): Promise<void> {
    const s = this.sessions.get(key)
    await s?.query.setModel(model)
    if (s?.init) s.init = { ...s.init, model }
  }

  close(key: string): void {
    const s = this.sessions.get(key)
    if (!s) return
    s.input.close()
    s.query.close()
    this.dispose(s)
  }

  closeAll(): void {
    for (const k of this.active()) this.close(k)
  }

  private dispose(s: ChatSession): void {
    if (this.sessions.get(s.key) !== s) return
    clearTimeout(s.idleTimer)
    clearTimeout(s.draftTimer)
    for (const p of s.permissions.values()) p.resolve({ behavior: 'deny', message: 'Sessão encerrada.' })
    s.permissions.clear()
    this.sessions.delete(s.key)
    this.emit(s.key, { type: 'state', state: 'idle' })
  }
}
