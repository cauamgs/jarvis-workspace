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

// ---------- central de projetos ----------

export interface CommitInfo {
  hash: string
  subject: string
  author: string
  date: number
  refs?: string
}

export interface ProjectInfo {
  path: string
  name: string
  branch: string
  upstream?: string
  ahead: number
  behind: number
  staged: number
  unstaged: number
  untracked: number
  conflicts: number
  stashes: number
  worktrees: number
  lastCommit?: CommitInfo
  remote?: string
  web?: string
  provider?: 'github' | 'gitlab' | 'other'
  error?: string
}

export interface ProjectDetail {
  files: { code: string; path: string }[]
  commits: CommitInfo[]
  branches: { name: string; date: number; track?: string }[]
}

// ---------- voz ----------

export type VoiceEvent =
  | { type: 'state'; listening: boolean }
  | { type: 'ready' }
  | { type: 'level'; value: number }
  | { type: 'partial'; text: string }
  | { type: 'final'; text: string }
  | { type: 'error'; message: string }

// ---------- automação do Mac ----------

export interface AppEntry {
  name: string
  path: string
}

export type AutoActionType = 'app' | 'quit' | 'url' | 'folder' | 'shortcut' | 'volume' | 'darkmode' | 'sleep-display' | 'shell' | 'wait'

export interface AutoAction {
  type: AutoActionType
  /** Nome do app, URL, pasta, nome do atalho, volume (0–100), on/off/toggle, comando ou segundos. */
  target: string
}

export interface AutoResult {
  ok: boolean
  output: string
}

export interface Routine {
  id: string
  name: string
  icon: string
  /** Frases que disparam a rotina por voz/busca, além do nome (ex.: "foco", "hora de trabalhar"). */
  triggers: string[]
  steps: AutoAction[]
}

/** Pedidos de navegação para a janela principal (vindos da busca rápida, barra de menu ou notificações). */
export type NavRequest =
  | { type: 'show' }
  | { type: 'session'; id: string; send?: string; voice?: boolean }
  | { type: 'workspace'; id: string }
  | { type: 'new'; cwd: string; workspaceId?: string; text?: string; voice?: boolean }
  | { type: 'module'; id: 'sessions' | 'system' | 'projects' | 'automation' | 'memory' | 'lab' }
  | { type: 'search'; query: string }
  | { type: 'project'; path: string }

// ---------- memória: busca nas conversas, cadernos, resumos e MCP ----------

export interface SearchHit {
  uuid: string
  role: 'user' | 'assistant'
  timestamp: number
  snippet: string
}

export interface SearchGroup {
  sessionId: string
  total: number
  lastHit: number
  hits: SearchHit[]
}

export interface SearchResult {
  groups: SearchGroup[]
  /** Índice ainda sendo construído (resultados parciais). */
  indexing: boolean
  indexed: number
  ms: number
}

export interface ContextMessage {
  uuid: string
  role: 'user' | 'assistant'
  timestamp: number
  text: string
  match?: boolean
}

export interface MemoryFile {
  path: string
  kind: 'project' | 'auto' | 'user'
  label: string
  text: string
}

export interface SessionSummary {
  sessionId: string
  createdAt: number
  /** Mensagens da sessão quando o resumo foi gerado (para saber se ficou desatualizado). */
  messageCount: number
  text: string
}

export interface McpBridgeStatus {
  running: boolean
  error?: string
  url: string
  name: string
  /** Registrado no escopo de usuário do Claude Code. */
  registered: boolean
  /** Registro aponta para este endereço e token. */
  current: boolean
}

export interface McpServerEntry {
  id: string
  name: string
  /** jarvis = o servidor do próprio app; user/local/project = escopos do Claude Code. */
  scope: 'jarvis' | 'user' | 'local' | 'project'
  project?: string
  transport: 'http' | 'sse' | 'stdio'
  /** URL ou linha de comando. */
  target: string
  /** Configuração com segredos mascarados. */
  config: Record<string, unknown>
}

export interface McpToolInfo {
  name: string
  title?: string
  description?: string
  inputSchema: Record<string, unknown>
  readOnly?: boolean
  destructive?: boolean
}

export interface McpCallResult {
  ok: boolean
  isError?: boolean
  text: string
  ms: number
}

export interface McpActivity {
  id: string
  at: number
  tool: string
  args: string
  ms: number
  ok: boolean
  preview: string
  /** Chamada feita pelo próprio Laboratório (teste manual). */
  fromLab: boolean
}

/** Arquivo entregue pelo Claude (SendUserFile / enviar_arquivo). */
export interface DeliveredFile {
  path: string
  name: string
  ext: string
  kind: 'image' | 'video' | 'audio' | 'pdf' | 'html' | 'text' | 'other'
  mime: string
  exists: boolean
  size: number
  mtime?: number
}

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
  voiceShortcutLabel: string
  voiceStart(): Promise<{ ok: boolean; error?: string }>
  voiceStop(): void
  voiceCancel(): void
  onVoiceEvent(cb: (ev: VoiceEvent) => void): () => void
  /** Busca rápida: aberta pelo atalho de voz (já começa ouvindo). */
  onPaletteVoice(cb: () => void): () => void

  sysSnapshot(): Promise<SystemSnapshot>
  sysPorts(): Promise<ListeningPort[]>
  sysProcesses(): Promise<ProcessInfo[]>
  sysKill(pid: number, force: boolean): Promise<{ ok: boolean; error?: string }>
  sysDocker(): Promise<DockerState>
  sysDockerAction(id: string, action: 'start' | 'stop' | 'restart'): Promise<{ ok: boolean; error?: string }>
  sysDockerLogs(id: string): Promise<string>
  sysStartDocker(): Promise<{ ok: boolean; error?: string }>
  openExternal(url: string): void

  projList(): Promise<ProjectInfo[]>
  projDetail(path: string): Promise<ProjectDetail>
  projFileDiff(path: string, file: string, code: string): Promise<string>
  projCommitDiff(path: string, hash: string): Promise<string>
  projAction(path: string, action: 'fetch' | 'pull'): Promise<{ ok: boolean; out: string }>
  projCheckout(path: string, branch: string): Promise<{ ok: boolean; out: string }>
  projOpen(path: string, app: 'finder' | 'terminal' | 'vscode'): void

  autoApps(): Promise<AppEntry[]>
  autoShortcuts(): Promise<string[]>
  autoRun(action: AutoAction): Promise<AutoResult>
  autoRoutines(): Promise<Routine[]>
  autoSaveRoutine(r: Routine): Promise<Routine[]>
  autoDeleteRoutine(id: string): Promise<Routine[]>
  autoRunRoutine(id: string): Promise<AutoResult[]>

  searchConversations(query: string, opts?: { sessionIds?: string[]; role?: 'user' | 'assistant' }): Promise<SearchResult>
  searchContext(sessionId: string, uuid?: string, radius?: number): Promise<ContextMessage[]>
  memoryGet(wsId: string): Promise<string>
  memorySet(wsId: string, text: string): Promise<void>
  memoryAppend(wsId: string, note: string): Promise<void>
  onMemoryChanged(cb: (wsId: string) => void): () => void
  projectContext(path: string): Promise<MemoryFile[]>
  summaryGet(sessionId: string): Promise<{ summary: SessionSummary | null; running: boolean; messageCount: number }>
  summaryGenerate(sessionId: string): Promise<{ ok: boolean; summary?: SessionSummary; error?: string }>
  mcpBridgeStatus(): Promise<McpBridgeStatus>
  mcpBridgeConnect(): Promise<{ ok: boolean; status?: McpBridgeStatus; error?: string }>
  mcpBridgeDisconnect(): Promise<{ ok: boolean; status?: McpBridgeStatus; error?: string }>
  fileInfo(paths: string[]): Promise<DeliveredFile[]>
  fileText(path: string): Promise<string>
  fileOpen(path: string): void
  fileReveal(path: string): void
  /** URL para exibir um arquivo entregue (imagem, vídeo, áudio, PDF). */
  fileUrl(path: string): string
  labServers(): Promise<McpServerEntry[]>
  labTools(id: string): Promise<{ ok: boolean; tools?: McpToolInfo[]; instructions?: string; error?: string }>
  labCall(id: string, tool: string, args: Record<string, unknown>): Promise<McpCallResult>
  labDisconnect(id: string): Promise<void>
  mcpActivity(): Promise<McpActivity[]>
  onMcpActivity(cb: (a: McpActivity) => void): () => void

  pickDirectory(): Promise<string | null>
  openInFinder(path: string): void
  homeDir: string
}
