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

  pickDirectory(): Promise<string | null>
  openInFinder(path: string): void
  homeDir: string
}
