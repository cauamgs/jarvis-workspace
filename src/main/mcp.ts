import { execFile } from 'node:child_process'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import type { McpBridgeStatus, SessionInfo, Workspace } from '@shared/types'
import type { SearchIndex } from './search'
import { type MemoryStore, projectContext, workspacesFor } from './memory'
import type { SummaryStore } from './summary'
import * as projects from './projects'
import * as system from './system'
import { loginShellEnv } from './shellEnv'

/**
 * Servidor MCP do Jarvis (HTTP em 127.0.0.1): dá a qualquer sessão do Claude Code — terminal,
 * Desktop ou o chat do próprio Jarvis — acesso à busca nas conversas, à memória dos workspaces e
 * ao estado do ambiente. Toda requisição exige o token guardado em userData/mcp-token.
 */

export interface McpContext {
  sessions: () => SessionInfo[]
  workspaces: () => Workspace[]
  search: SearchIndex
  memory: MemoryStore
  summaries: SummaryStore
  onMemoryChanged: (wsId: string) => void
}

const INSTRUCTIONS = `Jarvis WorkSpace é a central de trabalho do usuário: conhece todas as sessões do Claude Code dele
(de todos os projetos), mantém um caderno de memória por workspace e enxerga o ambiente local.
- Quando o usuário citar trabalho anterior ("como resolvemos…", "naquela sessão…", "o que decidimos sobre…"),
  use buscar_conversas e depois ler_conversa para recuperar o contexto, em vez de pedir que ele repita.
- No começo de uma tarefa num projeto, consulte memoria_workspace com o diretório atual.
- Registre com anotar_memoria decisões duráveis, convenções e informações de ambiente que valham para
  sessões futuras (não registre segredos nem detalhes passageiros).`

const text = (t: string): { content: { type: 'text'; text: string }[] } => ({ content: [{ type: 'text', text: t }] })
const date = (ms: number): string => (ms ? new Date(ms).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '?')

function buildServer(ctx: McpContext): McpServer {
  const server = new McpServer({ name: 'jarvis', version: '0.1.0' }, { instructions: INSTRUCTIONS })
  const sessionById = (id: string): SessionInfo | undefined => ctx.sessions().find((s) => s.id === id || s.id.startsWith(id))

  server.registerTool(
    'buscar_conversas',
    {
      title: 'Buscar nas conversas',
      description:
        'Busca texto em todas as sessões anteriores do Claude Code do usuário (pedidos, respostas e ferramentas usadas). ' +
        'Todos os termos precisam aparecer na mesma mensagem; use "aspas" para frase exata. Ignora acentos e maiúsculas.',
      inputSchema: {
        consulta: z.string().describe('Termos de busca, ex.: "migration" postgres'),
        cwd: z.string().optional().describe('Diretório atual; com apenas_projeto, restringe ao projeto'),
        apenas_projeto: z.boolean().optional().describe('Só sessões do projeto do cwd'),
        limite: z.number().int().min(1).max(30).optional().describe('Máximo de sessões (padrão 8)')
      },
      annotations: { readOnlyHint: true }
    },
    async ({ consulta, cwd, apenas_projeto, limite }) => {
      let ids: Set<string> | undefined
      if (apenas_projeto && cwd) {
        const root = cwd.replace(/\/+$/, '')
        ids = new Set(ctx.sessions().filter((s) => s.projectPath === root || root.startsWith(s.projectPath + '/') || s.projectPath.startsWith(root + '/')).map((s) => s.id))
      }
      const groups = ctx.search.search(consulta, { sessionIds: ids, maxSessions: limite ?? 8, perSession: 3 })
      if (!groups.length) return text(`Nada encontrado para: ${consulta}`)
      const out = groups.map((g) => {
        const s = sessionById(g.sessionId)
        const head = `## ${s?.title ?? 'Sessão'} — sessao_id: ${g.sessionId}\nprojeto: ${s?.projectPath ?? '?'} · ${g.total} trecho(s) · último: ${date(g.lastHit)}`
        const hits = g.hits.map((h) => `- [${h.role === 'user' ? 'usuário' : 'claude'} · ${date(h.timestamp)} · mensagem_id: ${h.uuid}] ${h.snippet}`)
        return [head, ...hits].join('\n')
      })
      return text(out.join('\n\n') + '\n\nUse ler_conversa com sessao_id e mensagem_id para ver o contexto completo.')
    }
  )

  server.registerTool(
    'ler_conversa',
    {
      title: 'Ler conversa',
      description:
        'Lê uma sessão anterior: com mensagem_id, as mensagens em volta daquele trecho; sem ele, o resumo de passagem ' +
        '(se existir) e as últimas mensagens da sessão.',
      inputSchema: {
        sessao_id: z.string().describe('ID da sessão (de buscar_conversas)'),
        mensagem_id: z.string().optional().describe('ID da mensagem encontrada'),
        raio: z.number().int().min(1).max(15).optional().describe('Mensagens antes e depois (padrão 4)')
      },
      annotations: { readOnlyHint: true }
    },
    async ({ sessao_id, mensagem_id, raio }) => {
      const s = sessionById(sessao_id)
      if (!s) return text('Sessão não encontrada.')
      const parts = [`# ${s.title}\nprojeto: ${s.projectPath} · branch: ${s.branch ?? '?'} · última atividade: ${date(s.lastActivityAt)}`]
      if (!mensagem_id) {
        const sum = await ctx.summaries.get(s.id)
        if (sum) parts.push(`## Resumo de passagem (${date(sum.createdAt)})\n${sum.text}`)
        const files = ctx.search.touched(s.id)
        if (files.length) parts.push(`## Arquivos alterados\n${files.slice(-40).join('\n')}`)
      }
      const msgs = ctx.search.context(s.id, mensagem_id, raio ?? (mensagem_id ? 4 : 6))
      if (!msgs.length && mensagem_id) return text('Mensagem não encontrada nesta sessão.')
      parts.push(
        (mensagem_id ? '## Trecho' : '## Últimas mensagens') +
          '\n' +
          msgs.map((m) => `[${m.match ? '>>> ' : ''}${m.role === 'user' ? 'USUÁRIO' : 'CLAUDE'} · ${date(m.timestamp)}]\n${m.text}`).join('\n\n')
      )
      return text(parts.join('\n\n'))
    }
  )

  server.registerTool(
    'memoria_workspace',
    {
      title: 'Memória do workspace',
      description:
        'Lê o caderno de memória dos workspaces do Jarvis que incluem o diretório informado (decisões, convenções, ' +
        'ambientes, pendências registradas pelo usuário e por sessões anteriores).',
      inputSchema: { cwd: z.string().describe('Diretório de trabalho atual') },
      annotations: { readOnlyHint: true }
    },
    async ({ cwd }) => {
      const list = workspacesFor(cwd, ctx.workspaces(), ctx.sessions())
      if (!list.length)
        return text('Este diretório não pertence a nenhum workspace do Jarvis. O usuário pode vincular a pasta a um workspace no app.')
      const parts = await Promise.all(
        list.map(async (w) => `# Workspace ${w.icon} ${w.name}\n${(await ctx.memory.get(w.id)).trim() || '(caderno vazio)'}`)
      )
      return text(parts.join('\n\n'))
    }
  )

  server.registerTool(
    'anotar_memoria',
    {
      title: 'Anotar na memória',
      description:
        'Acrescenta uma nota curta e durável ao caderno do workspace (decisão tomada, convenção, comando útil, ' +
        'endereço de ambiente). Não use para segredos nem para o andamento passo a passo.',
      inputSchema: {
        cwd: z.string().describe('Diretório de trabalho atual'),
        nota: z.string().min(3).max(2000).describe('Texto da nota, autocontido'),
        workspace: z.string().optional().describe('Nome do workspace, se o diretório estiver em mais de um')
      }
    },
    async ({ cwd, nota, workspace }) => {
      let list = workspacesFor(cwd, ctx.workspaces(), ctx.sessions())
      if (workspace) list = list.filter((w) => w.name.toLowerCase() === workspace.toLowerCase())
      if (!list.length) return text('Nenhum workspace do Jarvis corresponde a este diretório; nada foi anotado.')
      if (list.length > 1) return text(`O diretório está em mais de um workspace (${list.map((w) => w.name).join(', ')}). Informe o parâmetro workspace.`)
      await ctx.memory.append(list[0].id, nota)
      ctx.onMemoryChanged(list[0].id)
      return text(`Anotado no workspace ${list[0].name}.`)
    }
  )

  server.registerTool(
    'contexto_projeto',
    {
      title: 'Contexto do projeto',
      description: 'Lista os arquivos de contexto do Claude para um projeto (CLAUDE.md e memórias automáticas) com o conteúdo.',
      inputSchema: { cwd: z.string().describe('Diretório do projeto') },
      annotations: { readOnlyHint: true }
    },
    async ({ cwd }) => {
      const files = (await projectContext(cwd)).filter((f) => f.kind !== 'user')
      if (!files.length) return text('Nenhum CLAUDE.md ou memória automática para este projeto.')
      return text(files.map((f) => `# ${f.label}\n${f.path}\n\n${f.text}`).join('\n\n'))
    }
  )

  server.registerTool(
    'estado_ambiente',
    {
      title: 'Estado do ambiente',
      description: 'Estado local: git do diretório (branch, alterações, à frente/atrás), portas em uso e containers Docker.',
      inputSchema: { cwd: z.string().optional().describe('Diretório do repositório') },
      annotations: { readOnlyHint: true }
    },
    async ({ cwd }) => {
      const [repo, ports, dock] = await Promise.all([
        cwd ? projects.listProjects([cwd]).then((r) => r[0]) : Promise.resolve(undefined),
        system.listeningPorts().catch(() => []),
        system.docker().catch(() => null)
      ])
      const parts: string[] = []
      if (repo) {
        parts.push(
          repo.error
            ? `## Git\n${repo.error}`
            : `## Git (${repo.name})\nbranch: ${repo.branch}${repo.upstream ? ` → ${repo.upstream}` : ''} · à frente ${repo.ahead} · atrás ${repo.behind}\n` +
                `staged ${repo.staged} · modificados ${repo.unstaged} · novos ${repo.untracked} · conflitos ${repo.conflicts}` +
                (repo.lastCommit ? `\núltimo commit: ${repo.lastCommit.hash} ${repo.lastCommit.subject} (${date(repo.lastCommit.date)})` : '')
        )
      }
      parts.push(
        '## Portas em escuta\n' +
          (ports.length
            ? ports.map((p) => `${p.port}\t${p.command} (pid ${p.pid}, ${p.address})${p.args ? ' — ' + p.args.slice(0, 140) : ''}`).join('\n')
            : 'nenhuma')
      )
      if (dock?.status === 'running') {
        const running = dock.containers.filter((c) => c.state === 'running')
        parts.push(
          `## Containers (${running.length} rodando de ${dock.containers.length})\n` +
            dock.containers.map((c) => `${c.state === 'running' ? '●' : '○'} ${c.name} · ${c.image} · ${c.status}${c.ports ? ' · ' + c.ports : ''}`).join('\n')
        )
      } else parts.push(`## Containers\nmotor ${dock?.status === 'missing' ? 'não instalado' : 'parado'}`)
      return text(parts.join('\n\n'))
    }
  )

  server.registerTool(
    'logs_container',
    {
      title: 'Logs de container',
      description: 'Últimas linhas de log de um container Docker (pelo nome ou ID).',
      inputSchema: {
        container: z.string().describe('Nome ou ID do container'),
        linhas: z.number().int().min(10).max(300).optional().describe('Quantidade de linhas finais (padrão 120)')
      },
      annotations: { readOnlyHint: true }
    },
    async ({ container, linhas }) => {
      const out = await system.dockerLogs(container)
      if (!out) return text('Sem logs (container inexistente ou nome inválido).')
      return text(out.split('\n').slice(-(linhas ?? 120)).join('\n'))
    }
  )

  server.registerTool(
    'quem_alterou',
    {
      title: 'Sessões que alteraram um arquivo',
      description: 'Lista as sessões do Claude Code que editaram um arquivo (caminho absoluto ou o final do caminho).',
      inputSchema: { arquivo: z.string().describe('Ex.: /repo/src/app.ts ou src/app.ts') },
      annotations: { readOnlyHint: true }
    },
    async ({ arquivo }) => {
      const ids = ctx.search.sessionsTouching(arquivo)
      if (!ids.length) return text('Nenhuma sessão registrada alterou esse arquivo.')
      const list = ids
        .map((id) => sessionById(id))
        .filter((s): s is SessionInfo => !!s)
        .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
      return text(list.map((s) => `- ${s.title} — sessao_id: ${s.id} · ${s.projectName} · ${date(s.lastActivityAt)}`).join('\n'))
    }
  )

  return server
}

export class McpBridge {
  private http: Server | null = null
  private token = ''
  private error: string | undefined

  constructor(
    private ctx: McpContext,
    private port: number,
    private tokenFile: string,
    /** Nome do servidor na configuração do Claude Code ("jarvis" ou "jarvis-dev"). */
    readonly name: string
  ) {}

  get url(): string {
    return `http://127.0.0.1:${this.port}/mcp`
  }

  /** Configuração para passar ao Agent SDK nos chats do próprio Jarvis. */
  sdkConfig(): { type: 'http'; url: string; headers: Record<string, string> } | null {
    return this.http ? { type: 'http', url: this.url, headers: { Authorization: `Bearer ${this.token}` } } : null
  }

  async start(): Promise<void> {
    this.token = (await fs.readFile(this.tokenFile, 'utf8').catch(() => '')).trim()
    if (!this.token) {
      this.token = randomBytes(24).toString('hex')
      await fs.writeFile(this.tokenFile, this.token, { mode: 0o600 })
    }
    const expected = Buffer.from(`Bearer ${this.token}`)

    const http = createServer(async (req, res) => {
      // Só clientes locais com o token; navegadores (que mandam Origin) ficam de fora.
      const auth = Buffer.from(String(req.headers.authorization ?? ''))
      const hostOk = /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(String(req.headers.host ?? ''))
      if (!hostOk || req.headers.origin || auth.length !== expected.length || !timingSafeEqual(auth, expected)) {
        res.writeHead(401).end()
        return
      }
      if (!req.url?.startsWith('/mcp')) {
        res.writeHead(404).end()
        return
      }
      if (req.method !== 'POST') {
        // Modo sem estado: não há fluxo SSE aberto pelo servidor.
        res.writeHead(405, { Allow: 'POST' }).end()
        return
      }
      const server = buildServer(this.ctx)
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
      res.on('close', () => {
        void transport.close()
        void server.close()
      })
      try {
        await server.connect(transport)
        await transport.handleRequest(req, res)
      } catch (err) {
        if (!res.headersSent) res.writeHead(500).end(String(err))
      }
    })
    await new Promise<void>((resolve) => {
      http.once('error', (err) => {
        this.error = `Porta ${this.port} indisponível: ${(err as Error).message}`
        resolve()
      })
      http.listen(this.port, '127.0.0.1', () => {
        this.http = http
        resolve()
      })
    })
  }

  stop(): void {
    this.http?.close()
    this.http = null
  }

  /** Se o servidor está registrado no escopo de usuário do Claude Code (lido de ~/.claude.json). */
  async status(): Promise<McpBridgeStatus> {
    let registered = false
    let current = false
    try {
      const cfg = JSON.parse(await fs.readFile(join(homedir(), '.claude.json'), 'utf8'))
      const entry = cfg.mcpServers?.[this.name]
      registered = !!entry
      current = entry?.url === this.url && entry?.headers?.Authorization === `Bearer ${this.token}`
    } catch {
      /* sem configuração ainda */
    }
    return { running: !!this.http, error: this.error, url: this.url, name: this.name, registered, current }
  }

  /** Registra (ou atualiza) o servidor no Claude Code para todas as sessões do usuário, via CLI oficial. */
  async connect(): Promise<McpBridgeStatus> {
    const st = await this.status()
    if (st.registered) await this.claude(['mcp', 'remove', '--scope', 'user', this.name])
    const r = await this.claude([
      'mcp', 'add', '--scope', 'user', '--transport', 'http', this.name, this.url,
      '--header', `Authorization: Bearer ${this.token}`
    ])
    if (!r.ok) throw new Error(r.out || 'Falha ao registrar no Claude Code.')
    return this.status()
  }

  async disconnect(): Promise<McpBridgeStatus> {
    const r = await this.claude(['mcp', 'remove', '--scope', 'user', this.name])
    if (!r.ok) throw new Error(r.out || 'Falha ao remover do Claude Code.')
    return this.status()
  }

  private async claude(args: string[]): Promise<{ ok: boolean; out: string }> {
    const { env, claudePath } = await loginShellEnv()
    if (!claudePath) return { ok: false, out: 'Não encontrei o `claude` no seu PATH.' }
    return new Promise((resolve) =>
      execFile(claudePath, args, { env, cwd: homedir(), timeout: 30000 }, (err, stdout, stderr) =>
        resolve({ ok: !err, out: (stdout || stderr).trim() })
      )
    )
  }
}
