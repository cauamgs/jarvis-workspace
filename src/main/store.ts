import { promises as fs } from 'node:fs'
import type { Workspace } from '@shared/types'

/** Workspaces do Jarvis — guardados só aqui, apenas referenciando IDs de sessão. */
export class WorkspaceStore {
  private workspaces: Workspace[] = []
  /** Títulos dados às sessões dentro do Jarvis (têm prioridade sobre os do Claude). */
  private sessionTitles: Record<string, string> = {}

  constructor(private file: string) {}

  async load(): Promise<void> {
    try {
      const data = JSON.parse(await fs.readFile(this.file, 'utf8'))
      this.workspaces = data.workspaces ?? []
      this.sessionTitles = data.titles ?? {}
    } catch {
      this.workspaces = []
    }
  }

  list(): Workspace[] {
    return this.workspaces
  }

  titles(): Record<string, string> {
    return this.sessionTitles
  }

  async setTitle(sessionId: string, title: string): Promise<void> {
    if (title.trim()) this.sessionTitles[sessionId] = title.trim()
    else delete this.sessionTitles[sessionId]
    await this.flush()
  }

  async save(ws: Workspace): Promise<Workspace[]> {
    const i = this.workspaces.findIndex((w) => w.id === ws.id)
    if (i >= 0) this.workspaces[i] = ws
    else this.workspaces.push(ws)
    await this.flush()
    return this.workspaces
  }

  async remove(id: string): Promise<Workspace[]> {
    this.workspaces = this.workspaces.filter((w) => w.id !== id)
    await this.flush()
    return this.workspaces
  }

  async assign(workspaceId: string, sessionId: string, assigned: boolean): Promise<Workspace[]> {
    const ws = this.workspaces.find((w) => w.id === workspaceId)
    if (ws) {
      const set = new Set(ws.sessionIds)
      if (assigned) set.add(sessionId)
      else set.delete(sessionId)
      ws.sessionIds = [...set]
      await this.flush()
    }
    return this.workspaces
  }

  private async flush(): Promise<void> {
    const tmp = this.file + '.tmp'
    await fs.writeFile(tmp, JSON.stringify({ version: 1, workspaces: this.workspaces, titles: this.sessionTitles }, null, 2))
    await fs.rename(tmp, this.file)
  }
}
