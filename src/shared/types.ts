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
  | { kind: 'tool_use'; name: string; input: string }
  | { kind: 'tool_result'; text: string; isError?: boolean }

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'auto' | 'bypassPermissions'

export interface ChatPermissionRequest {
  id: string
  toolName: string
  title: string
  description?: string
  detail: string
  canAlwaysAllow: boolean
}

export type ChatState = 'idle' | 'starting' | 'running' | 'error'

/** Eventos do chat (Agent SDK) enviados do processo principal para a interface. */
export type ChatEvent =
  | { type: 'state'; state: ChatState; error?: string }
  | { type: 'init'; model: string; permissionMode: PermissionMode; models: { value: string; label: string }[] }
  | { type: 'message'; message: TranscriptMessage }
  | { type: 'draft'; kind: 'text' | 'thinking'; text: string }
  | { type: 'draft-clear' }
  | { type: 'permission'; request: ChatPermissionRequest }
  | { type: 'permission-done'; id: string }
  | { type: 'result'; costUsd?: number; durationMs: number; isError: boolean; error?: string }

export interface ChatSendOptions {
  key: string
  cwd: string
  text: string
  resumeId?: string
  newSessionId?: string
  permissionMode: PermissionMode
  model?: string
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
  chatRespondPermission(key: string, id: string, decision: 'allow' | 'always' | 'deny'): void
  chatActive(): Promise<string[]>
  chatInfo(key: string): Promise<{ init?: ChatEvent; running: boolean } | null>
  onChatEvent(cb: (key: string, ev: ChatEvent) => void): () => void

  pickDirectory(): Promise<string | null>
  openInFinder(path: string): void
  homeDir: string
}
