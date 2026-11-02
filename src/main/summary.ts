import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ContextMessage, SessionSummary } from '@shared/types'
import { loginShellEnv } from './shellEnv'

/**
 * Resumo de passagem de uma sessão: o que foi feito, decisões, estado e próximos passos.
 * Gerado por uma chamada avulsa ao Claude (sem ferramentas e sem gravar sessão nova) e
 * guardado pelo Jarvis em userData/summaries/<id>.json.
 */

const MAX_INPUT = 140_000

const PROMPT = `Você vai escrever um RESUMO DE PASSAGEM de uma sessão de desenvolvimento com o Claude Code.
Ele será usado para continuar o trabalho numa sessão nova, sem acesso à conversa original.
Escreva em português, em Markdown, de forma densa e factual, com estas seções:

## Objetivo
## O que foi feito
## Decisões e motivos
## Estado atual
(o que funciona, o que está quebrado ou não testado, branch, comandos úteis)
## Próximos passos
## Arquivos e referências
(caminhos de arquivos, URLs, IDs, nomes de recursos citados)

Não invente nada que não esteja na conversa. Omita seções sem conteúdo. Não inclua segredos (senhas, tokens).

<conversa>
{{CONVERSA}}
</conversa>`

export class SummaryStore {
  private running = new Map<string, Promise<SessionSummary>>()

  constructor(private dir: string) {}

  private file(id: string): string {
    return join(this.dir, id.replace(/[^\w-]/g, '') + '.json')
  }

  async get(id: string): Promise<SessionSummary | null> {
    try {
      return JSON.parse(await fs.readFile(this.file(id), 'utf8'))
    } catch {
      return null
    }
  }

  isRunning(id: string): boolean {
    return this.running.has(id)
  }

  generate(id: string, messages: ContextMessage[], cwd: string): Promise<SessionSummary> {
    const current = this.running.get(id)
    if (current) return current
    const p = this.run(id, messages, cwd).finally(() => this.running.delete(id))
    this.running.set(id, p)
    return p
  }

  private async run(id: string, messages: ContextMessage[], cwd: string): Promise<SessionSummary> {
    if (!messages.length) throw new Error('A sessão ainda não foi indexada ou não tem mensagens.')
    const [{ query }, { env, claudePath }] = await Promise.all([import('@anthropic-ai/claude-agent-sdk'), loginShellEnv()])
    if (!claudePath) throw new Error('Não encontrei o `claude` no seu PATH.')

    const q = query({
      prompt: PROMPT.replace('{{CONVERSA}}', condense(messages)),
      options: {
        cwd: (await fs.stat(cwd).catch(() => null))?.isDirectory() ? cwd : homedir(),
        pathToClaudeCodeExecutable: claudePath,
        env,
        model: 'sonnet',
        tools: [],
        settingSources: [],
        persistSession: false,
        maxTurns: 1
      }
    })
    let text = ''
    for await (const m of q) {
      if (m.type === 'result') {
        if (m.subtype !== 'success') throw new Error('O Claude não conseguiu gerar o resumo.')
        text = m.result
      }
    }
    if (!text.trim()) throw new Error('O resumo veio vazio.')
    const summary: SessionSummary = { sessionId: id, createdAt: Date.now(), messageCount: messages.length, text: text.trim() }
    await fs.mkdir(this.dir, { recursive: true })
    await fs.writeFile(this.file(id), JSON.stringify(summary, null, 2))
    return summary
  }
}

/** Conversa em texto corrido; se passar do limite, mantém o começo (objetivo) e o fim (estado atual). */
function condense(messages: ContextMessage[]): string {
  const lines = messages.map((m) => `[${m.role === 'user' ? 'USUÁRIO' : 'CLAUDE'}] ${m.text}`)
  const all = lines.join('\n\n')
  if (all.length <= MAX_INPUT) return all
  const head: string[] = []
  let size = 0
  for (const l of lines) {
    if (size + l.length > MAX_INPUT * 0.2) break
    head.push(l)
    size += l.length
  }
  const tail: string[] = []
  for (let i = lines.length - 1; i >= head.length; i--) {
    if (size + lines[i].length > MAX_INPUT) break
    tail.unshift(lines[i])
    size += lines[i].length
  }
  return [...head, `\n[… ${lines.length - head.length - tail.length} mensagens omitidas …]\n`, ...tail].join('\n\n')
}
