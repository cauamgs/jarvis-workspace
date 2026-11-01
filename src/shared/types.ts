export type SessionSource = 'desktop' | 'cli'

export interface SessionInfo {
  /** ID da sessão do Claude Code CLI (nome do .jsonl) — usado no `claude --resume`. */
  id: string
  title: string
  source: SessionSource
  /** Diretório onde a sessão roda (worktree, se houver). */
  cwd: string
  /** Diretório do projeto original (sem worktree). */
  projectPath: string
  projectName: string
  branch?: string
  model?: string
  firstPrompt?: string
  lastPrompt?: string
  messageCount: number
  createdAt: number
  lastActivityAt: number
  archived: boolean
  /** Existe um processo `claude` rodando agora com esta sessão. */
  live: boolean
  filePath: string
}

export interface Workspace {
  id: string
  name: string
  color: string
  icon: string
  createdAt: number
  sessionIds: string[]
  /** Sessões de projetos cujo caminho começa com um destes prefixos entram automaticamente. */
  autoPaths: string[]
}

export interface TranscriptMessage {
  uuid: string
  role: 'user' | 'assistant' | 'system'
  timestamp?: string
  blocks: TranscriptBlock[]
}

export type TranscriptBlock =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool_use'; id: string; name: string; input: string; raw?: Record<string, unknown> }
  | { kind: 'tool_result'; toolUseId: string; text: string; isError?: boolean }
  | { kind: 'image'; mediaType: string; data?: string }

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'auto' | 'bypassPermissions'

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface ChatQuestion {
  question: string
  header: string
  multiSelect: boolean
  options: { label: string; description: string }[]
}

export interface ChatPermissionRequest {
  id: string
  /** tool = permissão comum; question = AskUserQuestion; plan = ExitPlanMode (aprovar plano). */
  kind: 'tool' | 'question' | 'plan'
  toolName: string
  title: string
  description?: string
  detail: string
  canAlwaysAllow: boolean
  questions?: ChatQuestion[]
  plan?: string
}

export interface PermissionResponse {
  decision: 'allow' | 'always' | 'deny'
  /** Respostas do AskUserQuestion: pergunta → opção(ões) escolhida(s). */
  answers?: Record<string, string>
  /** Modo de permissão a adotar depois de aprovar um plano. */
  mode?: PermissionMode
  /** Motivo/orientação ao negar (ex.: "continue planejando, mas…"). */
  message?: string
}

export type ChatState = 'idle' | 'starting' | 'running' | 'error'

export interface BackgroundTask {
  id: string
  toolUseId?: string
  description: string
  status: 'running' | 'completed' | 'failed' | 'stopped'
  summary?: string
  lastTool?: string
  toolUses?: number
}

export interface ContextUsage {
  percentage: number
  totalTokens: number
  maxTokens: number
  categories: { name: string; tokens: number; color: string; kind: string }[]
}

export interface RateLimitInfo {
  status: 'allowed' | 'allowed_warning' | 'rejected'
  resetsAt?: number
  type?: string
  utilization?: number
}

export interface SlashCommandInfo {
  name: string
  description: string
  argumentHint: string
  builtin?: boolean
}

export interface McpServerInfo {
  name: string
  status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled'
  error?: string
  version?: string
}

export interface ChatImage {
  mediaType: string
  data: string
  name?: string
}

/** Eventos do chat (Agent SDK) enviados do processo principal para a interface. */
export type ChatEvent =
  | { type: 'state'; state: ChatState; error?: string }
  | {
      type: 'init'
      model: string
      permissionMode: PermissionMode
      models: { value: string; label: string }[]
      commands: SlashCommandInfo[]
      account?: { email?: string; subscriptionType?: string }
    }
  | { type: 'message'; message: TranscriptMessage }
  | { type: 'draft'; kind: 'text' | 'thinking'; text: string }
  | { type: 'draft-clear' }
  | { type: 'permission'; request: ChatPermissionRequest }
  | { type: 'permission-done'; id: string }
  | { type: 'result'; costUsd?: number; durationMs: number; isError: boolean; error?: string }
  | { type: 'subagent'; parentId: string; message: TranscriptMessage }
  | { type: 'task'; task: BackgroundTask }
  | { type: 'suggestion'; text: string }
  | { type: 'rate-limit'; info: RateLimitInfo }
  | { type: 'context'; usage: ContextUsage }

export interface ChatSendOptions {
  key: string
  cwd: string
  text: string
  images?: ChatImage[]
  resumeId?: string
  newSessionId?: string
  permissionMode: PermissionMode
  model?: string
  effort?: EffortLevel
}

export interface RewindResult {
  canRewind: boolean
  error?: string
  filesChanged?: string[]
  insertions?: number
  deletions?: number
}

// ---------- painel do sistema ----------

export interface SystemSnapshot {
  at: number
  cpu: { total: number; cores: number[]; load: number[]; model: string }
  memory: { used: number; total: number; compressed: number; pressure: number }
  disk: { used: number; total: number }
  battery: { percent: number; charging: boolean; source: 'ac' | 'battery'; remaining?: string } | null
  network: { rxPerSec: number; txPerSec: number }
  uptime: number
}

export interface ListeningPort {
  port: number
  pid: number
  command: string
  user: string
  address: string
  args?: string
}

export interface ProcessInfo {
  pid: number
  ppid: number
  cpu: number
  mem: number
  rss: number
  elapsed: string
  user: string
  name: string
  path: string
}

export interface ContainerInfo {
  id: string
  name: string
  image: string
  state: string
  status: string
  ports: string
  project?: string
  cpu?: number
  mem?: string
}

export interface DockerState {
  status: 'running' | 'stopped' | 'missing'
  containers: ContainerInfo[]
  error?: string
}

/** Pedidos de navegação para a janela principal (vindos da busca rápida, barra de menu ou notificações). */
export type NavRequest =
  | { type: 'show' }
  | { type: 'session'; id: string; send?: string }
  | { type: 'workspace'; id: string }
  | { type: 'new'; cwd: string; workspaceId?: string; text?: string }

export interface JarvisApi {
  listSessions(): Promise<SessionInfo[]>
  getTranscript(sessionId: string): Promise<TranscriptMessage[]>
  onSessionsChanged(cb: () => void): () => void

  listWorkspaces(): Promise<Workspace[]>
  saveWorkspace(ws: Workspace): Promise<Workspace[]>
  deleteWorkspace(id: string): Promise<Workspace[]>
  assignSession(workspaceId: string, sessionId: string, assigned: boolean): Promise<Workspace[]>

  ptyStart(opts: {
    key: string
    cwd: string
    resumeId?: string
    newSessionId?: string
  }): Promise<{ ok: boolean; error?: string; replay?: string }>
  ptyActive(): Promise<string[]>
  ptyWrite(key: string, data: string): void
  ptyResize(key: string, cols: number, rows: number): void
  ptyKill(key: string): void
  onPtyData(cb: (key: string, data: string) => void): () => void
  onPtyExit(cb: (key: string, code: number) => void): () => void

  chatSend(o: ChatSendOptions): Promise<{ ok: boolean; error?: string }>
  chatInterrupt(key: string): Promise<void>
  chatClose(key: string): Promise<void>
  chatSetPermissionMode(key: string, mode: PermissionMode): Promise<void>
  chatSetModel(key: string, model: string): Promise<void>
  chatRespondPermission(key: string, id: string, response: PermissionResponse): void
  chatSetEffort(key: string, effort: EffortLevel): Promise<void>
  chatRewind(key: string, userMessageId: string, dryRun: boolean): Promise<RewindResult>
  chatMcpStatus(key: string): Promise<McpServerInfo[]>
  chatMcpToggle(key: string, name: string, enabled: boolean): Promise<void>
  chatMcpReconnect(key: string, name: string): Promise<void>
  forkSession(sessionId: string, upToMessageId?: string): Promise<{ ok: boolean; sessionId?: string; error?: string }>
  renameSession(sessionId: string, title: string): Promise<void>
  pickImages(): Promise<ChatImage[]>
  chatActive(): Promise<string[]>
  chatInfo(key: string): Promise<{
    init?: ChatEvent
    running: boolean
    permissions: ChatPermissionRequest[]
    tasks: BackgroundTask[]
    context?: ContextUsage
  } | null>
  onChatEvent(cb: (key: string, ev: ChatEvent) => void): () => void

  /** Janela principal: recebe pedidos de navegação. */
  onNav(cb: (req: NavRequest) => void): () => void
  /** Busca rápida: pede navegação na janela principal (e se esconde). */
  navigate(req: NavRequest): void
  hidePalette(): void
  showPalette(): void
  onPaletteShown(cb: () => void): () => void
  shortcutLabel: string

  sysSnapshot(): Promise<SystemSnapshot>
  sysPorts(): Promise<ListeningPort[]>
  sysProcesses(): Promise<ProcessInfo[]>
  sysKill(pid: number, force: boolean): Promise<{ ok: boolean; error?: string }>
  sysDocker(): Promise<DockerState>
  sysDockerAction(id: string, action: 'start' | 'stop' | 'restart'): Promise<{ ok: boolean; error?: string }>
  sysDockerLogs(id: string): Promise<string>
  sysStartDocker(): Promise<{ ok: boolean; error?: string }>
  openExternal(url: string): void

  pickDirectory(): Promise<string | null>
  openInFinder(path: string): void
  homeDir: string
}
