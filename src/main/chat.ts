import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import type {
  CanUseTool,
  PermissionResult,
  PermissionUpdate,
  Query,
  SDKMessage,
  SDKUserMessage
} from '@anthropic-ai/claude-agent-sdk'
import type {
  BackgroundTask,
  ChatEvent,
  ChatPermissionRequest,
  ChatQuestion,
  ChatSendOptions,
  ContextUsage,
  EffortLevel,
  McpServerInfo,
  PermissionMode,
  PermissionResponse,
  RewindResult,
  TranscriptBlock
} from '@shared/types'
import { summarizeInput, toMessage } from './indexer'
import { loginShellEnv } from './shellEnv'

/** Fecha o processo do `claude` depois de um tempo ocioso — a sessão continua no disco e é retomada no próximo envio. */
const IDLE_CLOSE_MS = 20 * 60 * 1000

type SDK = typeof import('@anthropic-ai/claude-agent-sdk')
let sdkPromise: Promise<SDK> | null = null
const loadSdk = (): Promise<SDK> => (sdkPromise ??= import('@anthropic-ai/claude-agent-sdk'))

interface PendingPermission {
  resolve: (r: PermissionResult) => void
  input: Record<string, unknown>
  suggestions?: PermissionUpdate[]
  request: ChatPermissionRequest
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
  /** Estado reenviado se a janela recarregar. */
  init?: Extract<ChatEvent, { type: 'init' }>
  tasks: Map<string, BackgroundTask>
  context?: ContextUsage
}

export interface ChatInfo {
  init?: ChatEvent
  running: boolean
  permissions: ChatPermissionRequest[]
  tasks: BackgroundTask[]
  context?: ContextUsage
}

export class ChatManager {
  private sessions = new Map<string, ChatSession>()

  constructor(private emit: (key: string, ev: ChatEvent) => void) {}

  active(): string[] {
    return [...this.sessions.keys()]
  }

  /** Estado atual de uma sessão viva, para a interface se reidratar após um reload. */
  info(key: string): ChatInfo | null {
    const s = this.sessions.get(key)
    if (!s) return null
    return {
      init: s.init,
      running: s.running,
      permissions: [...s.permissions.values()].map((p) => p.request),
      tasks: [...s.tasks.values()],
      context: s.context
    }
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
    const images = o.images ?? []
    const content = images.length
      ? [
          ...images.map((img) => ({
            type: 'image' as const,
            source: { type: 'base64' as const, media_type: img.mediaType as 'image/png', data: img.data }
          })),
          ...(o.text ? [{ type: 'text' as const, text: o.text }] : [])
        ]
      : o.text
    s.input.push({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null, uuid } as SDKUserMessage)

    const blocks: TranscriptBlock[] = [
      ...images.map((img) => ({ kind: 'image' as const, mediaType: img.mediaType, data: img.data })),
      ...(o.text ? [{ kind: 'text' as const, text: o.text }] : [])
    ]
    this.emit(o.key, { type: 'message', message: { uuid, role: 'user', timestamp: new Date().toISOString(), blocks } })
    s.running = true
    this.emit(o.key, { type: 'state', state: 'running' })
    return { ok: true }
  }

  private async start(o: ChatSendOptions): Promise<ChatSession> {
    this.emit(o.key, { type: 'state', state: 'starting' })
    const [{ query }, { env, claudePath }] = await Promise.all([loadSdk(), loginShellEnv()])
    if (!claudePath) throw new Error('Não encontrei o `claude` no seu PATH. Instale o Claude Code CLI.')
    // Nunca rodar o Claude num diretório diferente do da sessão (ex.: cair na pasta pessoal).
    if (!existsSync(o.cwd)) throw new Error(`A pasta desta sessão não existe mais: ${o.cwd}`)

    const input = new InputQueue()
    const permissions = new Map<string, PendingPermission>()
    const key = o.key

    const canUseTool: CanUseTool = (toolName, toolInput, opts) =>
      new Promise<PermissionResult>((resolve) => {
        const id = randomUUID()
        const request = buildRequest(id, toolName, toolInput, opts)
        permissions.set(id, { resolve, input: toolInput, suggestions: opts.suggestions, request })
        opts.signal.addEventListener('abort', () => {
          if (!permissions.delete(id)) return
          this.emit(key, { type: 'permission-done', id })
          resolve({ behavior: 'deny', message: 'Cancelado.' })
        })
        this.emit(key, { type: 'permission', request })
      })

    const q = query({
      prompt: input,
      options: {
        cwd: o.cwd,
        resume: o.resumeId,
        sessionId: o.newSessionId,
        pathToClaudeCodeExecutable: claudePath,
        env,
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        includePartialMessages: true,
        permissionMode: o.permissionMode,
        allowDangerouslySkipPermissions: true,
        model: o.model,
        effort: o.effort,
        canUseTool,
        // Checkpoints de arquivos: permitem "restaurar arquivos até aqui".
        enableFileCheckpointing: true,
        promptSuggestions: true,
        agentProgressSummaries: true
      }
    })

    const s: ChatSession = { key, query: q, input, permissions, running: false, draft: null, tasks: new Map() }
    this.sessions.set(key, s)
    void this.pump(s)
    return s
  }

  private async pump(s: ChatSession): Promise<void> {
    let initSent = false
    try {
      for await (const m of s.query) {
        this.handle(s, m)
        if (m.type === 'system' && m.subtype === 'init' && !initSent) {
          initSent = true
          const [models, commands, account] = await Promise.all([
            s.query.supportedModels().catch(() => []),
            s.query.supportedCommands().catch(() => []),
            s.query.accountInfo().catch(() => undefined)
          ])
          s.init = {
            type: 'init',
            model: m.model,
            permissionMode: m.permissionMode as PermissionMode,
            models: models.map((x) => ({ value: x.value, label: x.displayName })),
            commands: commands.map((c) => ({
              name: c.name,
              description: c.description,
              argumentHint: c.argumentHint,
              builtin: c.builtin
            })),
            account: account && { email: account.email, subscriptionType: account.subscriptionType }
          }
          this.emit(s.key, s.init)
          void this.refreshContext(s)
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
    // Mensagens de subagentes vão para o cartão da ferramenta Agent que os criou.
    if ('parent_tool_use_id' in m && m.parent_tool_use_id) {
      if (m.type === 'assistant') {
        const msg = toMessage({ type: 'assistant', uuid: m.uuid, message: m.message, timestamp: new Date().toISOString() })
        if (msg) this.emit(s.key, { type: 'subagent', parentId: m.parent_tool_use_id, message: msg })
      }
      return
    }

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
      case 'prompt_suggestion':
        this.emit(s.key, { type: 'suggestion', text: m.suggestion })
        return
      case 'rate_limit_event': {
        const r = m.rate_limit_info
        this.emit(s.key, {
          type: 'rate-limit',
          info: { status: r.status, resetsAt: r.resetsAt, type: r.rateLimitType, utilization: r.utilization }
        })
        return
      }
      case 'system':
        switch (m.subtype) {
          case 'compact_boundary':
            this.emit(s.key, {
              type: 'message',
              message: { uuid: m.uuid, role: 'system', blocks: [{ kind: 'text', text: 'Conversa compactada' }] }
            })
            void this.refreshContext(s)
            return
          case 'task_started':
            return this.upsertTask(s, m.task_id, {
              toolUseId: m.tool_use_id,
              description: m.description,
              status: 'running'
            })
          case 'task_progress':
            return this.upsertTask(s, m.task_id, {
              toolUseId: m.tool_use_id,
              description: m.description,
              summary: m.summary,
              lastTool: m.last_tool_name,
              toolUses: m.usage?.tool_uses
            })
          case 'task_updated': {
            const st = m.patch.status
            return this.upsertTask(s, m.task_id, {
              description: m.patch.description,
              status:
                st === 'completed' ? 'completed' : st === 'failed' ? 'failed' : st === 'killed' ? 'stopped' : st ? 'running' : undefined
            })
          }
          case 'task_notification':
            return this.upsertTask(s, m.task_id, { toolUseId: m.tool_use_id, status: m.status, summary: m.summary })
        }
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
        void this.refreshContext(s)
        s.idleTimer = setTimeout(() => this.close(s.key), IDLE_CLOSE_MS)
        return
    }
  }

  private upsertTask(s: ChatSession, id: string, patch: Partial<BackgroundTask>): void {
    const prev = s.tasks.get(id) ?? { id, description: '', status: 'running' as const }
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<BackgroundTask>
    const task = { ...prev, ...clean }
    s.tasks.set(id, task)
    this.emit(s.key, { type: 'task', task })
  }

  private async refreshContext(s: ChatSession): Promise<void> {
    try {
      const u = await s.query.getContextUsage()
      s.context = {
        percentage: u.percentage,
        totalTokens: u.totalTokens,
        maxTokens: u.maxTokens,
        categories: u.categories.map((c) => ({ name: c.name, tokens: c.tokens, color: c.color, kind: c.kind }))
      }
      this.emit(s.key, { type: 'context', usage: s.context })
    } catch {
      /* CLI antigo ou sessão encerrando */
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

  respondPermission(key: string, id: string, r: PermissionResponse): void {
    const s = this.sessions.get(key)
    const p = s?.permissions.get(id)
    if (!s || !p) return
    s.permissions.delete(id)
    this.emit(key, { type: 'permission-done', id })

    if (r.decision === 'deny') {
      p.resolve({ behavior: 'deny', message: r.message?.trim() || 'O usuário negou esta ação pelo Jarvis.' })
      return
    }
    const updatedInput = p.request.kind === 'question' ? { ...p.input, answers: r.answers ?? {} } : p.input
    p.resolve({
      behavior: 'allow',
      updatedInput,
      updatedPermissions: r.decision === 'always' ? p.suggestions : undefined
    })
    // Plano aprovado: sai do modo plano para o modo escolhido.
    if (p.request.kind === 'plan' && r.mode) void this.setPermissionMode(key, r.mode)
  }

  async interrupt(key: string): Promise<void> {
    await this.sessions.get(key)?.query.interrupt().catch(() => undefined)
  }

  async setPermissionMode(key: string, mode: PermissionMode): Promise<void> {
    const s = this.sessions.get(key)
    await s?.query.setPermissionMode(mode)
    if (s?.init) {
      s.init = { ...s.init, permissionMode: mode }
      this.emit(key, s.init)
    }
  }

  async setModel(key: string, model: string): Promise<void> {
    const s = this.sessions.get(key)
    await s?.query.setModel(model)
    if (s?.init) s.init = { ...s.init, model }
  }

  async setEffort(key: string, effort: EffortLevel): Promise<void> {
    await this.sessions.get(key)?.query.applyFlagSettings({ effortLevel: effort })
  }

  async rewind(key: string, userMessageId: string, dryRun: boolean): Promise<RewindResult> {
    const s = this.sessions.get(key)
    if (!s) return { canRewind: false, error: 'O chat desta sessão não está ativo no Jarvis.' }
    try {
      return await s.query.rewindFiles(userMessageId, { dryRun })
    } catch (err) {
      return { canRewind: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async mcpStatus(key: string): Promise<McpServerInfo[]> {
    const list = (await this.sessions.get(key)?.query.mcpServerStatus().catch(() => [])) ?? []
    return list.map((m) => ({ name: m.name, status: m.status, error: m.error, version: m.serverInfo?.version }))
  }

  async mcpToggle(key: string, name: string, enabled: boolean): Promise<void> {
    await this.sessions.get(key)?.query.toggleMcpServer(name, enabled)
  }

  async mcpReconnect(key: string, name: string): Promise<void> {
    await this.sessions.get(key)?.query.reconnectMcpServer(name)
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

/** Ramifica uma sessão (cópia da conversa até uma mensagem) usando a API oficial do SDK. */
export async function forkSession(
  sessionId: string,
  upToMessageId?: string
): Promise<{ ok: boolean; sessionId?: string; error?: string }> {
  try {
    const { forkSession: fork } = await loadSdk()
    const r = await fork(sessionId, { upToMessageId })
    return { ok: true, sessionId: r.sessionId }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Renomeia a sessão no próprio transcript (o mesmo que o /rename do CLI). */
export async function renameSession(sessionId: string, title: string): Promise<void> {
  const { renameSession: rename } = await loadSdk()
  await rename(sessionId, title)
}

type PermissionOpts = Parameters<CanUseTool>[2]

function buildRequest(
  id: string,
  toolName: string,
  input: Record<string, unknown>,
  opts: PermissionOpts
): ChatPermissionRequest {
  const base = {
    id,
    toolName,
    title: opts.title ?? `Claude quer usar ${opts.displayName ?? toolName}`,
    description: opts.description ?? opts.decisionReason,
    detail: summarizeInput(input) || JSON.stringify(input).slice(0, 400),
    canAlwaysAllow: !opts.suppressAlwaysAllowRule && !!opts.suggestions?.length
  }
  if (toolName === 'AskUserQuestion' && Array.isArray(input.questions)) {
    const questions = (input.questions as ChatQuestion[]).map((q) => ({
      question: q.question,
      header: q.header,
      multiSelect: !!q.multiSelect,
      options: (q.options ?? []).map((o) => ({ label: o.label, description: o.description }))
    }))
    return { ...base, kind: 'question', title: 'Claude tem uma pergunta', questions, canAlwaysAllow: false }
  }
  if (toolName === 'ExitPlanMode') {
    const plan = typeof input.plan === 'string' ? input.plan : undefined
    return { ...base, kind: 'plan', title: 'Plano pronto para revisão', plan, canAlwaysAllow: false }
  }
  return { ...base, kind: 'tool' }
}
