import { existsSync } from 'node:fs'
import * as pty from 'node-pty'
import { cleanEnv } from './shellEnv'

const MAX_BUFFER = 256 * 1024

interface Term {
  proc: pty.IPty
  buffer: string
}

/**
 * Terminais embutidos rodando o `claude` CLI. Continuam vivos quando o usuário troca de sessão;
 * o buffer permite redesenhar a tela ao voltar.
 */
export class PtyManager {
  private terms = new Map<string, Term>()

  constructor(
    private onData: (key: string, data: string) => void,
    private onExit: (key: string, code: number) => void
  ) {}

  /** Retorna o buffer acumulado se o terminal já existir. */
  start(key: string, cwd: string, resumeId?: string, newSessionId?: string): { replay?: string } {
    const existing = this.terms.get(key)
    if (existing) return { replay: existing.buffer }

    if (!existsSync(cwd)) throw new Error(`A pasta desta sessão não existe mais: ${cwd}`)
    const shell = process.env.SHELL || '/bin/zsh'
    const args = resumeId ? `--resume ${resumeId}` : newSessionId ? `--session-id ${newSessionId}` : ''
    // Shell de login interativo: o app aberto pelo Finder não herda o PATH do usuário.
    const proc = pty.spawn(shell, ['-l', '-i', '-c', `exec claude ${args}`], {
      name: 'xterm-256color',
      cols: 120,
      rows: 32,
      cwd,
      env: { ...cleanEnv(), TERM: 'xterm-256color', COLORTERM: 'truecolor' }
    })
    const term: Term = { proc, buffer: '' }
    this.terms.set(key, term)
    proc.onData((data) => {
      term.buffer = (term.buffer + data).slice(-MAX_BUFFER)
      this.onData(key, data)
    })
    proc.onExit(({ exitCode }) => {
      this.terms.delete(key)
      this.onExit(key, exitCode)
    })
    return {}
  }

  has(key: string): boolean {
    return this.terms.has(key)
  }

  keys(): string[] {
    return [...this.terms.keys()]
  }

  write(key: string, data: string): void {
    this.terms.get(key)?.proc.write(data)
  }

  resize(key: string, cols: number, rows: number): void {
    if (cols > 0 && rows > 0) this.terms.get(key)?.proc.resize(cols, rows)
  }

  kill(key: string): void {
    this.terms.get(key)?.proc.kill()
    this.terms.delete(key)
  }

  killAll(): void {
    for (const k of this.keys()) this.kill(k)
  }
}
