import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { CommitInfo, ProjectDetail, ProjectInfo } from '@shared/types'
import { loginShellEnv } from './shellEnv'

/** Pastas varridas atrás de repositórios Git (até 2 níveis abaixo). */
export const DEFAULT_ROOTS = [join(homedir(), 'Documents'), join(homedir(), 'Developer'), join(homedir(), 'Projects')]
const SKIP = new Set(['node_modules', '.git', 'Library', 'dist', 'build', 'out', 'vendor', '.venv', 'venv', 'target', '.next'])

function git(cwd: string, args: string[], timeout = 15000): Promise<{ ok: boolean; out: string }> {
  return loginShellEnv().then(
    ({ env }) =>
      new Promise((resolve) => {
        execFile(
          'git',
          args,
          { cwd, env: { ...env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }, timeout, maxBuffer: 16 * 1024 * 1024 },
          // Alguns comandos (ex.: diff --no-index) saem com código 1 e mesmo assim trazem saída útil.
          (err, stdout, stderr) => resolve({ ok: !err, out: (stdout || stderr || (err ? String(err) : '')).trimEnd() })
        )
      })
  )
}

/** Varre as raízes atrás de pastas com .git (sem entrar em worktrees do Claude nem node_modules). */
export async function discoverRepos(roots: string[], extra: string[]): Promise<string[]> {
  const found = new Set<string>()
  async function walk(dir: string, depth: number): Promise<void> {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    if (entries.some((e) => e.name === '.git')) {
      found.add(dir)
      return
    }
    if (depth === 0) return
    await Promise.all(
      entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name))
        .map((e) => walk(join(dir, e.name), depth - 1))
    )
  }
  await Promise.all(roots.map((r) => walk(r, 3)))
  for (const p of extra) {
    if (p.includes('/.claude/worktrees/')) continue
    try {
      await fs.access(join(p, '.git'))
      found.add(p)
    } catch {
      /* não é repositório */
    }
  }
  return [...found].sort()
}

/** Converte a URL do remoto (ssh ou https) na página web do repositório. */
export function remoteWeb(url: string): { web: string; provider: 'github' | 'gitlab' | 'other' } | null {
  const m = /^(?:git@|ssh:\/\/git@|https?:\/\/(?:[^@/]+@)?)([^:/]+)[:/](.+?)(?:\.git)?\/?$/.exec(url.trim())
  if (!m) return null
  const host = m[1]
  return {
    web: `https://${host}/${m[2]}`,
    provider: host.includes('github') ? 'github' : host.includes('gitlab') ? 'gitlab' : 'other'
  }
}

async function inspect(path: string): Promise<ProjectInfo> {
  const [status, last, remote, stash, worktrees] = await Promise.all([
    git(path, ['status', '--porcelain=v2', '--branch']),
    git(path, ['log', '-1', '--format=%h%x1f%s%x1f%an%x1f%ct']),
    git(path, ['remote', 'get-url', 'origin']),
    git(path, ['stash', 'list']),
    git(path, ['worktree', 'list', '--porcelain'])
  ])
  const info: ProjectInfo = {
    path,
    name: basename(path),
    branch: '',
    ahead: 0,
    behind: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicts: 0,
    stashes: stash.ok && stash.out ? stash.out.split('\n').length : 0,
    worktrees: worktrees.ok ? Math.max(0, worktrees.out.split('\n').filter((l) => l.startsWith('worktree ')).length - 1) : 0
  }
  if (!status.ok) return { ...info, error: status.out.split('\n')[0] }
  for (const line of status.out.split('\n')) {
    if (line.startsWith('# branch.head ')) info.branch = line.slice(14)
    else if (line.startsWith('# branch.upstream ')) info.upstream = line.slice(18)
    else if (line.startsWith('# branch.ab ')) {
      const [, a, b] = /\+(\d+) -(\d+)/.exec(line) ?? []
      info.ahead = Number(a ?? 0)
      info.behind = Number(b ?? 0)
    } else if (line.startsWith('? ')) info.untracked++
    else if (line.startsWith('u ')) info.conflicts++
    else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const xy = line.slice(2, 4)
      if (xy[0] !== '.') info.staged++
      if (xy[1] !== '.') info.unstaged++
    }
  }
  if (last.ok && last.out) {
    const [hash, subject, author, ts] = last.out.split('\x1f')
    info.lastCommit = { hash, subject, author, date: Number(ts) * 1000 }
  }
  if (remote.ok && remote.out) {
    const r = remoteWeb(remote.out)
    info.remote = remote.out
    if (r) {
      info.web = r.web
      info.provider = r.provider
    }
  }
  return info
}

/** Inspeciona vários repositórios com concorrência limitada (git é leve, mas são dezenas). */
export async function listProjects(paths: string[]): Promise<ProjectInfo[]> {
  const out: ProjectInfo[] = []
  let i = 0
  async function worker(): Promise<void> {
    while (i < paths.length) {
      const p = paths[i++]
      out.push(await inspect(p))
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker))
  return out
}

export async function projectDetail(path: string): Promise<ProjectDetail> {
  const [files, log, branches] = await Promise.all([
    git(path, ['status', '--porcelain=v1', '-uall']),
    git(path, ['log', '-25', '--format=%h%x1f%s%x1f%an%x1f%ct%x1f%D']),
    git(path, ['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)%1f%(committerdate:unix)%1f%(upstream:track)', 'refs/heads', '--count=30'])
  ])
  return {
    files: files.out
      .split('\n')
      .filter(Boolean)
      .map((l) => ({ code: l.slice(0, 2), path: l.slice(3).replace(/^"|"$/g, '') })),
    commits: log.out
      .split('\n')
      .filter(Boolean)
      .map((l): CommitInfo => {
        const [hash, subject, author, ts, refs] = l.split('\x1f')
        return { hash, subject, author, date: Number(ts) * 1000, refs: refs || undefined }
      }),
    branches: branches.out
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [name, ts, track] = l.split('\x1f')
        return { name, date: Number(ts) * 1000, track: track || undefined }
      })
  }
}

export async function fileDiff(path: string, file: string, code: string): Promise<string> {
  if (code.includes('?')) {
    // Arquivo novo (não rastreado): mostra o conteúdo como adição.
    const r = await git(path, ['diff', '--no-index', '--', '/dev/null', file])
    return r.out
  }
  const staged = code[0] !== ' ' && code[0] !== '?'
  const r = await git(path, ['diff', ...(staged ? ['HEAD'] : []), '--', file])
  return r.out
}

export async function commitDiff(path: string, hash: string): Promise<string> {
  if (!/^[0-9a-f]{4,40}$/i.test(hash)) return ''
  return (await git(path, ['show', '--stat', '--patch', '--format=%H%n%an <%ae>%n%ad%n%n%B', hash])).out
}

export async function gitAction(path: string, action: 'fetch' | 'pull'): Promise<{ ok: boolean; out: string }> {
  return action === 'fetch'
    ? git(path, ['fetch', '--prune'], 60000)
    : git(path, ['pull', '--ff-only'], 60000)
}

export async function checkout(path: string, branch: string): Promise<{ ok: boolean; out: string }> {
  if (!/^[\w./-]+$/.test(branch)) return { ok: false, out: 'Nome de branch inválido.' }
  return git(path, ['switch', branch], 30000)
}

/** Abre a pasta num app (Finder, Terminal, VS Code). */
export function openWith(path: string, app: 'finder' | 'terminal' | 'vscode'): void {
  loginShellEnv().then(({ env }) => {
    if (app === 'vscode') execFile('code', [path], { env }, (err) => err && execFile('open', ['-a', 'Visual Studio Code', path]))
    else if (app === 'terminal') execFile('open', ['-a', 'Terminal', path])
    else execFile('open', [path])
  })
}
