import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import type { McpCallResult, McpServerEntry, McpToolInfo } from '@shared/types'
import { loginShellEnv } from './shellEnv'

/**
 * Laboratório MCP: lista os servidores MCP configurados no Claude Code (usuário, local e .mcp.json
 * dos projetos, só leitura) e o do próprio Jarvis, e conecta como cliente para listar e testar
 * ferramentas manualmente.
 */

const SECRET = /auth|token|key|secret|pass|cookie|bearer/i

function redact(v: unknown, key = ''): unknown {
  if (typeof v === 'string') return SECRET.test(key) || /^Bearer\s/i.test(v) ? '••••••' : v
  if (Array.isArray(v)) return v.map((x) => redact(x, key))
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redact(x, k)]))
  return v
}

function entry(name: string, cfg: any, scope: McpServerEntry['scope'], project?: string): McpServerEntry | null {
  if (!cfg || typeof cfg !== 'object') return null
  const transport: McpServerEntry['transport'] = cfg.type === 'http' ? 'http' : cfg.type === 'sse' ? 'sse' : 'stdio'
  const target = transport === 'stdio' ? [cfg.command, ...(cfg.args ?? [])].filter(Boolean).join(' ') : String(cfg.url ?? '')
  if (!target) return null
  return { id: `${scope}:${project ?? ''}:${name}`, name, scope, project, transport, target, config: redact(cfg) as Record<string, unknown> }
}

export class McpLab {
  private clients = new Map<string, Client>()
  /** Configurações reais (com segredos) — nunca vão para a interface. */
  private raw = new Map<string, any>()

  constructor(private jarvis: () => { name: string; url: string; headers: Record<string, string> } | null) {}

  async servers(projectPaths: string[]): Promise<McpServerEntry[]> {
    const out: McpServerEntry[] = []
    this.raw.clear()
    const add = (name: string, cfg: any, scope: McpServerEntry['scope'], project?: string): void => {
      const e = entry(name, cfg, scope, project)
      if (!e) return
      out.push(e)
      this.raw.set(e.id, cfg)
    }

    const j = this.jarvis()
    if (j) add(j.name, { type: 'http', url: j.url, headers: { ...j.headers, 'X-Jarvis-Lab': '1' } }, 'jarvis')

    let cfg: any = {}
    try {
      cfg = JSON.parse(await fs.readFile(join(homedir(), '.claude.json'), 'utf8'))
    } catch {
      /* sem configuração */
    }
    for (const [name, c] of Object.entries(cfg.mcpServers ?? {})) if (!j || name !== j.name) add(name, c, 'user')
    for (const [p, v] of Object.entries<any>(cfg.projects ?? {}))
      for (const [name, c] of Object.entries(v?.mcpServers ?? {})) add(name, c, 'local', p)
    for (const p of new Set(projectPaths)) {
      try {
        const m = JSON.parse(await fs.readFile(join(p, '.mcp.json'), 'utf8'))
        for (const [name, c] of Object.entries(m.mcpServers ?? {})) add(name, c, 'project', p)
      } catch {
        /* projeto sem .mcp.json */
      }
    }
    return out
  }

  private async client(id: string): Promise<Client> {
    const existing = this.clients.get(id)
    if (existing) return existing
    const cfg = this.raw.get(id)
    if (!cfg) throw new Error('Servidor não encontrado. Atualize a lista.')
    const headers: Record<string, string> = cfg.headers ?? {}
    let transport
    if (cfg.type === 'http') transport = new StreamableHTTPClientTransport(new URL(cfg.url), { requestInit: { headers } })
    else if (cfg.type === 'sse') transport = new SSEClientTransport(new URL(cfg.url), { requestInit: { headers } })
    else {
      const { env } = await loginShellEnv()
      transport = new StdioClientTransport({
        command: cfg.command,
        args: cfg.args ?? [],
        env: { ...env, ...(cfg.env ?? {}) },
        cwd: id.split(':')[1] || homedir(),
        stderr: 'ignore'
      })
    }
    const client = new Client({ name: 'jarvis-lab', version: '0.1.0' })
    await withTimeout(client.connect(transport), 20000, 'O servidor não respondeu a tempo.')
    client.onclose = () => this.clients.delete(id)
    this.clients.set(id, client)
    return client
  }

  async tools(id: string): Promise<{ ok: boolean; tools?: McpToolInfo[]; instructions?: string; error?: string }> {
    try {
      const c = await this.client(id)
      const r = await withTimeout(c.listTools(), 20000, 'O servidor não listou as ferramentas a tempo.')
      return {
        ok: true,
        instructions: c.getInstructions(),
        tools: r.tools.map((t) => ({
          name: t.name,
          title: t.title ?? t.annotations?.title,
          description: t.description,
          inputSchema: t.inputSchema as Record<string, unknown>,
          readOnly: t.annotations?.readOnlyHint,
          destructive: t.annotations?.destructiveHint
        }))
      }
    } catch (err) {
      await this.disconnect(id)
      return { ok: false, error: message(err) }
    }
  }

  async call(id: string, tool: string, args: Record<string, unknown>): Promise<McpCallResult> {
    const t0 = Date.now()
    try {
      const c = await this.client(id)
      const r: any = await withTimeout(c.callTool({ name: tool, arguments: args }), 120000, 'A ferramenta não respondeu em 2 minutos.')
      const text = (r.content ?? [])
        .map((b: any) => (b.type === 'text' ? b.text : b.type === 'image' ? `[imagem ${b.mimeType}]` : JSON.stringify(b)))
        .join('\n')
      return { ok: !r.isError, isError: !!r.isError, text: text || JSON.stringify(r.structuredContent ?? r, null, 2), ms: Date.now() - t0 }
    } catch (err) {
      return { ok: false, text: message(err), ms: Date.now() - t0 }
    }
  }

  async disconnect(id: string): Promise<void> {
    const c = this.clients.get(id)
    this.clients.delete(id)
    await c?.close().catch(() => undefined)
  }

  closeAll(): void {
    for (const id of [...this.clients.keys()]) void this.disconnect(id)
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(msg)), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      }
    )
  })
}
