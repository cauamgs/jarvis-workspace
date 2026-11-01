import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { shell } from 'electron'
import type { AppEntry, AutoAction, AutoResult, Routine } from '@shared/types'
import { loginShellEnv } from './shellEnv'

/**
 * Automação do Mac: abrir apps, rodar Atalhos do macOS, ações do sistema e rotinas
 * (sequências de passos definidas pelo usuário).
 */

const APP_DIRS = ['/Applications', '/Applications/Utilities', '/System/Applications', '/System/Applications/Utilities', join(homedir(), 'Applications')]

function run(cmd: string, args: string[], timeout = 30000): Promise<AutoResult> {
  return loginShellEnv().then(
    ({ env }) =>
      new Promise((resolve) => {
        execFile(cmd, args, { env, timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) =>
          resolve({ ok: !err, output: (stdout || stderr || (err ? String(err) : '')).trim() })
        )
      })
  )
}

let appsCache: { at: number; list: AppEntry[] } | null = null

export async function listApps(): Promise<AppEntry[]> {
  if (appsCache && Date.now() - appsCache.at < 60_000) return appsCache.list
  const seen = new Map<string, AppEntry>()
  for (const dir of APP_DIRS) {
    let names: string[] = []
    try {
      names = await fs.readdir(dir)
    } catch {
      continue
    }
    for (const n of names) {
      if (!n.endsWith('.app')) continue
      const name = n.slice(0, -4)
      if (!seen.has(name)) seen.set(name, { name, path: join(dir, n) })
    }
  }
  const list = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
  appsCache = { at: Date.now(), list }
  return list
}

let shortcutsCache: { at: number; list: string[] } | null = null

export async function listShortcuts(): Promise<string[]> {
  if (shortcutsCache && Date.now() - shortcutsCache.at < 60_000) return shortcutsCache.list
  const r = await run('shortcuts', ['list'], 10000)
  const list = r.ok ? r.output.split('\n').map((s) => s.trim()).filter(Boolean) : []
  shortcutsCache = { at: Date.now(), list }
  return list
}

const appleScript = (src: string): Promise<AutoResult> => run('osascript', ['-e', src])
const quote = (s: string): string => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

/** Executa uma ação. Ações de shell só vêm de rotinas criadas pelo próprio usuário. */
export async function runAction(a: AutoAction): Promise<AutoResult> {
  switch (a.type) {
    case 'app':
      return run('open', ['-a', a.target])
    case 'quit':
      // Encerramento educado: o próprio app pergunta se há algo não salvo.
      return appleScript(`tell application "${quote(a.target)}" to quit`)
    case 'url':
      if (!/^https?:\/\//.test(a.target)) return { ok: false, output: 'Só endereços http(s).' }
      await shell.openExternal(a.target)
      return { ok: true, output: '' }
    case 'folder': {
      const err = await shell.openPath(a.target.replace(/^~(?=\/|$)/, homedir()))
      return { ok: !err, output: err }
    }
    case 'shortcut':
      return run('shortcuts', ['run', a.target], 120000)
    case 'volume': {
      const v = Math.max(0, Math.min(100, Math.round(Number(a.target))))
      return appleScript(`set volume output volume ${v}`)
    }
    case 'darkmode': {
      const value = a.target === 'on' ? 'true' : a.target === 'off' ? 'false' : 'not dark mode'
      return appleScript(`tell application "System Events" to tell appearance preferences to set dark mode to ${value}`)
    }
    case 'sleep-display':
      return run('pmset', ['displaysleepnow'])
    case 'shell': {
      const { env } = await loginShellEnv()
      return new Promise((resolve) =>
        execFile(process.env.SHELL || '/bin/zsh', ['-l', '-c', a.target], { env, cwd: homedir(), timeout: 120000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) =>
          resolve({ ok: !err, output: (stdout || stderr || (err ? String(err) : '')).trim() })
        )
      )
    }
    case 'wait':
      await new Promise((r) => setTimeout(r, Math.min(30000, Number(a.target) * 1000 || 0)))
      return { ok: true, output: '' }
  }
}

export async function runRoutine(r: Routine, onStep?: (i: number, res: AutoResult) => void): Promise<AutoResult[]> {
  const results: AutoResult[] = []
  for (let i = 0; i < r.steps.length; i++) {
    const res = await runAction(r.steps[i])
    results.push(res)
    onStep?.(i, res)
    // Um passo que falha não impede os seguintes (ex.: app já fechado).
  }
  return results
}

/** Rotinas do usuário, salvas em routines.json no diretório de dados do Jarvis. */
export class RoutineStore {
  private routines: Routine[] = []

  constructor(private file: string) {}

  async load(): Promise<void> {
    try {
      this.routines = JSON.parse(await fs.readFile(this.file, 'utf8')).routines ?? []
    } catch {
      this.routines = []
    }
  }

  list(): Routine[] {
    return this.routines
  }

  async save(r: Routine): Promise<Routine[]> {
    const i = this.routines.findIndex((x) => x.id === r.id)
    if (i >= 0) this.routines[i] = r
    else this.routines.push(r)
    await this.flush()
    return this.routines
  }

  async remove(id: string): Promise<Routine[]> {
    this.routines = this.routines.filter((r) => r.id !== id)
    await this.flush()
    return this.routines
  }

  private async flush(): Promise<void> {
    const tmp = this.file + '.tmp'
    await fs.writeFile(tmp, JSON.stringify({ version: 1, routines: this.routines }, null, 2))
    await fs.rename(tmp, this.file)
  }
}
