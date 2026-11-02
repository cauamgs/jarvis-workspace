import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { MemoryFile, SessionInfo, Workspace } from '@shared/types'

/**
 * Memória dos workspaces: um caderno em Markdown por workspace, guardado pelo Jarvis
 * (userData/memory/<id>.md). O contexto que o Claude já tem de cada projeto (CLAUDE.md e as
 * memórias automáticas em ~/.claude/projects/<projeto>/memory) é só lido, nunca alterado.
 */
export class MemoryStore {
  constructor(private dir: string) {}

  private file(wsId: string): string {
    return join(this.dir, wsId.replace(/[^\w-]/g, '') + '.md')
  }

  async get(wsId: string): Promise<string> {
    return fs.readFile(this.file(wsId), 'utf8').catch(() => '')
  }

  async set(wsId: string, text: string): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true })
    const tmp = this.file(wsId) + '.tmp'
    await fs.writeFile(tmp, text)
    await fs.rename(tmp, this.file(wsId))
  }

  /** Acrescenta uma nota datada ao fim do caderno. */
  async append(wsId: string, note: string, author = 'Claude'): Promise<void> {
    const current = (await this.get(wsId)).trimEnd()
    const stamp = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    await this.set(wsId, `${current ? current + '\n\n' : ''}- ${note.trim()} _(${author}, ${stamp})_\n`)
  }

  async remove(wsId: string): Promise<void> {
    await fs.rm(this.file(wsId), { force: true })
  }
}

/** Workspaces que valem para uma pasta: vinculados ao caminho ou com sessões daquele projeto. */
export function workspacesFor(cwd: string, workspaces: Workspace[], sessions: SessionInfo[]): Workspace[] {
  const path = cwd.replace(/\/+$/, '')
  const inside = (base: string): boolean => path === base || path.startsWith(base + '/') || base.startsWith(path + '/')
  const projectSessions = new Set(sessions.filter((s) => s.projectPath && inside(s.projectPath)).map((s) => s.id))
  return workspaces.filter((w) => w.autoPaths.some(inside) || w.sessionIds.some((id) => projectSessions.has(id)))
}

/** Nome da pasta que o Claude Code usa para um projeto em ~/.claude/projects. */
function claudeProjectDir(path: string): string {
  return join(homedir(), '.claude', 'projects', path.replace(/[^a-zA-Z0-9]/g, '-'))
}

/** CLAUDE.md do projeto e do usuário e as memórias automáticas do Claude para o projeto (somente leitura). */
export async function projectContext(path: string): Promise<MemoryFile[]> {
  const out: MemoryFile[] = []
  const read = async (p: string, kind: MemoryFile['kind'], label: string): Promise<void> => {
    const text = await fs.readFile(p, 'utf8').catch(() => null)
    if (text !== null) out.push({ path: p, kind, label, text })
  }
  if (path) {
    await read(join(path, 'CLAUDE.md'), 'project', 'CLAUDE.md do projeto')
    await read(join(path, '.claude', 'CLAUDE.md'), 'project', '.claude/CLAUDE.md do projeto')
    await read(join(path, 'CLAUDE.local.md'), 'project', 'CLAUDE.local.md')
    const memDir = join(claudeProjectDir(path), 'memory')
    const files = await fs.readdir(memDir).catch(() => [] as string[])
    for (const f of files.filter((f) => f.endsWith('.md')).sort((a, b) => (a === 'MEMORY.md' ? -1 : b === 'MEMORY.md' ? 1 : a.localeCompare(b))))
      await read(join(memDir, f), 'auto', `Memória do Claude · ${f}`)
  }
  await read(join(homedir(), '.claude', 'CLAUDE.md'), 'user', 'CLAUDE.md pessoal (todos os projetos)')
  return out
}
