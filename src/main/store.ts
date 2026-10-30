import { promises as fs } from 'node:fs'
import type { Workspace } from '@shared/types'

/** Workspaces do Jarvis — guardados só aqui, apenas referenciando IDs de sessão. */
export class WorkspaceStore {
  private workspaces: Workspace[] = []

  constructor(private file: string) {}

  async load(): Promise<void> {
    try {
      this.workspaces = JSON.parse(await fs.readFile(this.file, 'utf8')).workspaces ?? []
    } catch {
      this.workspaces = []
    }
  }

  list(): Workspace[] {
    return this.workspaces
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
    await fs.writeFile(tmp, JSON.stringify({ version: 1, workspaces: this.workspaces }, null, 2))
    await fs.rename(tmp, this.file)
  }
}
