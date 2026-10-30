import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Se o Jarvis for aberto de dentro de uma sessão do Claude Code (ex.: `npm run dev` pelo Claude),
 * herdaria variáveis que fazem o `claude` se achar uma sub-sessão e parar de gravar o transcript.
 */
const INHERITED = /^(CLAUDE|ANTHROPIC_|MCP_|CCD_|ELECTRON_|VITE_)/

export function cleanEnv(base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(base)) {
    if (v !== undefined && !INHERITED.test(k)) env[k] = v
  }
  return env
}

let cached: Promise<{ env: Record<string, string>; claudePath: string | null }> | null = null

/**
 * Ambiente do shell de login do usuário (PATH do nvm, homebrew etc.) e o caminho do `claude`.
 * Apps abertos pelo Finder recebem só um PATH mínimo.
 */
export function loginShellEnv(): Promise<{ env: Record<string, string>; claudePath: string | null }> {
  cached ??= new Promise((resolve) => {
    const shell = process.env.SHELL || '/bin/zsh'
    const marker = '__JARVIS_ENV__'
    execFile(
      shell,
      ['-l', '-i', '-c', `echo ${marker}; env -0; echo ${marker}; command -v claude`],
      { env: cleanEnv(), timeout: 10000, maxBuffer: 4 * 1024 * 1024 },
      (_err, stdout) => {
        const parts = (stdout ?? '').split(marker)
        const env: Record<string, string> = {}
        for (const entry of (parts[1] ?? '').split('\0')) {
          const i = entry.indexOf('=')
          if (i > 0) env[entry.slice(0, i).trim()] = entry.slice(i + 1)
        }
        const found = (parts[2] ?? '').trim().split('\n').pop()?.trim()
        const fallback = join(homedir(), '.local', 'bin', 'claude')
        const claudePath = found && existsSync(found) ? found : existsSync(fallback) ? fallback : null
        resolve({ env: cleanEnv(Object.keys(env).length ? env : process.env), claudePath })
      }
    )
  })
  return cached
}
