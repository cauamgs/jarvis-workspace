import { useEffect, useMemo, useState } from 'react'
import type { McpActivity, McpBridgeStatus, McpCallResult, McpServerEntry, McpToolInfo } from '@shared/types'
import { timeAgo } from '../../lib'

const SCOPE_LABEL: Record<McpServerEntry['scope'], string> = {
  jarvis: 'DO JARVIS',
  user: 'CLAUDE CODE · USUÁRIO',
  local: 'CLAUDE CODE · LOCAL (POR PROJETO)',
  project: 'PROJETOS · .MCP.JSON'
}

/** Laboratório MCP: o servidor do Jarvis e os servidores do Claude Code, com teste de ferramentas. */
export function LabView(): React.JSX.Element {
  const [servers, setServers] = useState<McpServerEntry[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [status, setStatus] = useState<McpBridgeStatus | null>(null)

  async function refresh(): Promise<void> {
    const [list, st] = await Promise.all([window.jarvis.labServers(), window.jarvis.mcpBridgeStatus()])
    setServers(list)
    setStatus(st)
    setSelected((cur) => (cur && list.some((s) => s.id === cur) ? cur : list[0]?.id ?? null))
  }
  useEffect(() => {
    void refresh()
  }, [])

  const groups = useMemo(() => {
    const g = new Map<McpServerEntry['scope'], McpServerEntry[]>()
    for (const s of servers ?? []) g.set(s.scope, [...(g.get(s.scope) ?? []), s])
    return [...g]
  }, [servers])
  const current = servers?.find((s) => s.id === selected) ?? null
  const others = (servers ?? []).filter((s) => s.scope !== 'jarvis').length

  return (
    <div className="labview">
      <section className="panel">
        <div className="panel-header">
          Lab MCP
          <span className="count">{servers ? String(servers.length).padStart(2, '0') : ''}</span>
          <button className="btn sm" onClick={() => void refresh()}>↻</button>
        </div>
        <div className="panel-body">
          {status && !status.running && (
            <div className="warn">✕ O servidor do Jarvis não está rodando. {status.error}</div>
          )}
          {groups.map(([scope, list]) => (
            <div key={scope}>
              <div className="group-label">{SCOPE_LABEL[scope]}</div>
              {list.map((s) => (
                <div key={s.id} className={`proj${selected === s.id ? ' active' : ''}`} onClick={() => setSelected(s.id)}>
                  <div className="proj-name">
                    {s.scope === 'jarvis' && (
                      <span
                        className="lab-dot"
                        style={{ background: status?.registered && status.current ? 'var(--green)' : 'var(--amber)' }}
                        title={status?.registered && status.current ? 'Conectado ao Claude Code' : 'Ainda não conectado ao Claude Code'}
                      />
                    )}
                    {s.name}
                    <span className="pill dim" style={{ marginLeft: 'auto' }}>{s.transport.toUpperCase()}</span>
                  </div>
                  <div className="proj-meta" title={s.target}>{s.project ? (s.project.split('/').pop() ?? s.project) + ' · ' : ''}{s.transport === 'stdio' ? s.target.split(' ').map((a) => a.split('/').pop()).join(' ') : s.target}</div>
                </div>
              ))}
            </div>
          ))}
          {servers && others === 0 && (
            <div className="mem-hint">
              <p>Nenhum outro servidor MCP configurado no Claude Code. Os que você adicionar (<code>claude mcp add</code> ou <code>.mcp.json</code> nos projetos) aparecem aqui para testar.</p>
              <p>Conectores do claude.ai (Gmail, Notion…) ficam na sua conta e não aparecem nesta lista.</p>
            </div>
          )}
        </div>
      </section>

      {current ? (
        <ServerPanel key={current.id} server={current} status={status} onStatus={setStatus} />
      ) : (
        <section className="panel">
          <div className="idle"><div><h2>LAB MCP</h2><p>Selecione um servidor.</p></div></div>
        </section>
      )}
    </div>
  )
}

type Tab = 'tools' | 'activity' | 'about'

function ServerPanel({
  server,
  status,
  onStatus
}: {
  server: McpServerEntry
  status: McpBridgeStatus | null
  onStatus: (s: McpBridgeStatus) => void
}): React.JSX.Element {
  const isJarvis = server.scope === 'jarvis'
  const [tab, setTab] = useState<Tab>('tools')
  const [tools, setTools] = useState<McpToolInfo[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tool, setTool] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function loadTools(): Promise<void> {
    setLoading(true)
    setError(null)
    const r = await window.jarvis.labTools(server.id)
    setLoading(false)
    if (r.ok && r.tools) {
      setTools(r.tools)
      setTool((t) => t ?? r.tools![0]?.name ?? null)
    } else setError(r.error ?? 'Falhou.')
  }
  // O servidor do Jarvis é local e seguro: lista na hora. Os outros só quando o usuário pede (stdio inicia um processo).
  useEffect(() => {
    if (isJarvis) void loadTools()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id])

  async function bridge(fn: () => Promise<{ ok: boolean; status?: McpBridgeStatus; error?: string }>): Promise<void> {
    setBusy(true)
    setError(null)
    const r = await fn()
    setBusy(false)
    if (r.ok && r.status) onStatus(r.status)
    else setError(r.error ?? 'Falhou.')
  }

  const connected = status?.registered && status.current
  const current = tools?.find((t) => t.name === tool) ?? null

  return (
    <section className="panel">
      <div className="detail-head">
        <h1>{server.name}</h1>
        <div className="kv">
          {isJarvis && (
            <span>
              <b>CLAUDE CODE</b>
              <span style={{ color: connected ? 'var(--green)' : 'var(--amber)' }}>
                {connected ? 'CONECTADO' : status?.registered ? 'DESATUALIZADO' : 'NÃO CONECTADO'}
              </span>
            </span>
          )}
          <span><b>TRANSPORTE</b>{server.transport}</span>
          <span><b>{server.transport === 'stdio' ? 'COMANDO' : 'ENDEREÇO'}</b>{server.target}</span>
          {tools && <span><b>FERRAMENTAS</b>{tools.length}</span>}
        </div>
        <div className="actions">
          {isJarvis && status?.running && (
            <button className="btn primary" disabled={busy} onClick={() => void bridge(window.jarvis.mcpBridgeConnect)}>
              {busy ? 'Aguarde…' : status.registered ? '↻ Reconectar ao Claude Code' : '⚡ Conectar ao Claude Code'}
            </button>
          )}
          {isJarvis && status?.registered && (
            <button className="btn danger" disabled={busy} onClick={() => void bridge(window.jarvis.mcpBridgeDisconnect)}>
              Desconectar
            </button>
          )}
          {!isJarvis && (
            <button className="btn primary" disabled={loading} onClick={() => void loadTools()}>
              {loading ? 'Conectando…' : tools ? '↻ Recarregar ferramentas' : '⚡ Conectar e listar ferramentas'}
            </button>
          )}
          {!isJarvis && tools && (
            <button className="btn ghost" onClick={() => void window.jarvis.labDisconnect(server.id).then(() => setTools(null))}>
              Desconectar
            </button>
          )}
        </div>
      </div>
      <div className="tabs">
        <button className={`tab${tab === 'tools' ? ' on' : ''}`} onClick={() => setTab('tools')}>Ferramentas</button>
        {isJarvis && (
          <button className={`tab${tab === 'activity' ? ' on' : ''}`} onClick={() => setTab('activity')}>Atividade</button>
        )}
        <button className={`tab${tab === 'about' ? ' on' : ''}`} onClick={() => setTab('about')}>{isJarvis ? 'Como funciona' : 'Configuração'}</button>
      </div>
      {error && <div className="warn">✕ {error}</div>}
      {isJarvis && status?.registered && !status.current && (
        <div className="warn">O registro no Claude Code aponta para outro endereço ou token. Clique em Reconectar.</div>
      )}

      {tab === 'tools' && (
        <div className="lab-tools">
          <div className="lab-tool-list">
            {!tools && !loading && !isJarvis && (
              <div className="mem-hint"><p>Conecte para ver as ferramentas deste servidor.</p></div>
            )}
            {loading && <div className="empty">Conectando…</div>}
            {tools?.map((t) => (
              <div key={t.name} className={`lab-tool${tool === t.name ? ' on' : ''}`} onClick={() => setTool(t.name)}>
                <span className="n">{t.name}</span>
                {t.readOnly ? <span className="pill dim">LEITURA</span> : <span className={`pill ${t.destructive ? 'conflict' : 'mod'}`}>ESCRITA</span>}
              </div>
            ))}
          </div>
          {current ? <ToolRunner key={server.id + current.name} serverId={server.id} tool={current} /> : <div className="lab-runner" />}
        </div>
      )}
      {tab === 'activity' && <ActivityLog />}
      {tab === 'about' && (
        <div className="panel-body mem-mcp">
          {isJarvis ? (
            <div className="md">
              <p>
                O Jarvis roda um servidor MCP em <code>{server.target}</code> que dá ao Claude acesso à <b>Memória</b> (busca nas
                conversas, cadernos dos workspaces, resumos) e ao estado do seu ambiente (git, portas, Docker).
              </p>
              <p>
                Os chats do próprio Jarvis já recebem essas ferramentas. <b>Conectar ao Claude Code</b> registra o servidor{' '}
                <code>{server.name}</code> nas configurações de usuário do Claude Code (<code>claude mcp add --scope user</code>),
                para que sessões do terminal e do Claude Desktop também as tenham. Sessões já abertas precisam ser reiniciadas.
              </p>
              <p>
                Só aceita conexões desta máquina com um token secreto, e só funciona enquanto o Jarvis estiver aberto. A aba
                Atividade mostra cada ferramenta que o Claude chamou.
              </p>
            </div>
          ) : (
            <>
              <div className="group-label" style={{ padding: '0 0 8px' }}>CONFIGURAÇÃO (SEGREDOS MASCARADOS)</div>
              <pre className="lab-pre">{JSON.stringify(server.config, null, 2)}</pre>
            </>
          )}
        </div>
      )}
    </section>
  )
}

interface Prop {
  type?: string | string[]
  description?: string
  enum?: unknown[]
  default?: unknown
}

/** Formulário gerado do JSON Schema da ferramenta + execução manual. */
function ToolRunner({ serverId, tool }: { serverId: string; tool: McpToolInfo }): React.JSX.Element {
  const props = (tool.inputSchema.properties ?? {}) as Record<string, Prop>
  const required = new Set((tool.inputSchema.required as string[] | undefined) ?? [])
  const [values, setValues] = useState<Record<string, string | boolean>>({})
  const [result, setResult] = useState<McpCallResult | null>(null)
  const [running, setRunning] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const typeOf = (p: Prop): string => (Array.isArray(p.type) ? p.type.find((t) => t !== 'null') ?? 'string' : p.type ?? 'string')

  function build(): Record<string, unknown> | null {
    const args: Record<string, unknown> = {}
    for (const [k, p] of Object.entries(props)) {
      const v = values[k]
      const t = typeOf(p)
      if (t === 'boolean') {
        if (v !== undefined) args[k] = v
        continue
      }
      if (v === undefined || v === '') {
        if (required.has(k)) {
          setFormError(`Preencha "${k}".`)
          return null
        }
        continue
      }
      if (t === 'number' || t === 'integer') args[k] = Number(v)
      else if (t === 'object' || t === 'array') {
        try {
          args[k] = JSON.parse(String(v))
        } catch {
          setFormError(`"${k}" precisa ser JSON válido.`)
          return null
        }
      } else args[k] = v
    }
    return args
  }

  async function run(): Promise<void> {
    setFormError(null)
    const args = build()
    if (!args) return
    // Ferramentas que podem alterar dados pedem um segundo clique.
    if (!tool.readOnly && !confirm) {
      setConfirm(true)
      return
    }
    setConfirm(false)
    setRunning(true)
    setResult(await window.jarvis.labCall(serverId, tool.name, args))
    setRunning(false)
  }

  return (
    <div className="lab-runner">
      <div className="lab-runner-head">
        <div className="t">{tool.title ?? tool.name}</div>
        {tool.description && <div className="d">{tool.description}</div>}
      </div>
      <div className="lab-form">
        {Object.keys(props).length === 0 && <div className="hint">Sem parâmetros.</div>}
        {Object.entries(props).map(([k, p]) => {
          const t = typeOf(p)
          return (
            <div key={k} className="field">
              <label>
                {k}
                {required.has(k) && <span style={{ color: 'var(--amber)' }}> *</span>}
                <span className="lab-type">{t}</span>
              </label>
              {t === 'boolean' ? (
                <label className="lab-check">
                  <input type="checkbox" checked={values[k] === true} onChange={(e) => setValues({ ...values, [k]: e.target.checked })} />
                  {values[k] === true ? 'verdadeiro' : 'falso'}
                </label>
              ) : p.enum ? (
                <select className="select" value={String(values[k] ?? '')} onChange={(e) => setValues({ ...values, [k]: e.target.value })}>
                  <option value="">—</option>
                  {p.enum.map((o) => <option key={String(o)} value={String(o)}>{String(o)}</option>)}
                </select>
              ) : t === 'object' || t === 'array' ? (
                <textarea className="input lab-json" placeholder={t === 'array' ? '[ ]' : '{ }'} value={String(values[k] ?? '')} onChange={(e) => setValues({ ...values, [k]: e.target.value })} />
              ) : (
                <input
                  className="input"
                  type={t === 'number' || t === 'integer' ? 'number' : 'text'}
                  placeholder={p.default !== undefined ? `padrão: ${String(p.default)}` : ''}
                  value={String(values[k] ?? '')}
                  onChange={(e) => setValues({ ...values, [k]: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && void run()}
                />
              )}
              {p.description && <div className="hint">{p.description}</div>}
            </div>
          )
        })}
        {formError && <div className="warn" style={{ margin: 0 }}>{formError}</div>}
        <div className="lab-run">
          {confirm && <span className="lab-confirm">Esta ferramenta pode alterar dados. Clique de novo para executar.</span>}
          <button className={`btn ${confirm ? 'danger' : 'primary'}`} disabled={running} onClick={() => void run()}>
            {running ? 'Executando…' : confirm ? 'Executar mesmo assim' : '▶ Executar'}
          </button>
        </div>
      </div>
      {result && (
        <div className="lab-result">
          <div className="lab-result-head">
            <span style={{ color: result.ok ? 'var(--green)' : 'var(--red)' }}>{result.ok ? '✓ OK' : '✕ ERRO'}</span>
            <span>{result.ms} ms</span>
            <span style={{ flex: 1 }} />
            <button className="row-btn" onClick={() => void navigator.clipboard.writeText(result.text)}>Copiar</button>
          </div>
          <pre className="lab-pre">{result.text}</pre>
        </div>
      )}
    </div>
  )
}

/** Chamadas recebidas pelo servidor do Jarvis, ao vivo. */
function ActivityLog(): React.JSX.Element {
  const [items, setItems] = useState<McpActivity[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [hideLab, setHideLab] = useState(false)

  useEffect(() => {
    void window.jarvis.mcpActivity().then(setItems)
    return window.jarvis.onMcpActivity((a) => setItems((l) => [a, ...l].slice(0, 200)))
  }, [])

  const shown = hideLab ? items.filter((a) => !a.fromLab) : items
  return (
    <div className="panel-body">
      <div className="mem-notes-bar">
        <span className="hint" style={{ flex: 1 }}>Cada ferramenta do Jarvis que o Claude chamou (desde que o app abriu).</span>
        <button className={`chip${hideLab ? ' on' : ''}`} onClick={() => setHideLab((v) => !v)}>Ocultar testes</button>
      </div>
      {shown.length === 0 && <div className="empty">Nenhuma chamada ainda</div>}
      {shown.map((a) => (
        <div key={a.id} className="lab-act" onClick={() => setOpen(open === a.id ? null : a.id)}>
          <div className="row">
            <span style={{ color: a.ok ? 'var(--green)' : 'var(--red)' }}>{a.ok ? '●' : '✕'}</span>
            <span className="act-tool">{a.tool}</span>
            {a.fromLab && <span className="pill dim">TESTE</span>}
            <span className="args">{a.args === '{}' ? '' : a.args}</span>
            <span className="meta">{a.ms} ms · {timeAgo(a.at)}</span>
          </div>
          {open === a.id && <pre className="lab-pre">{a.preview}{a.preview.length >= 400 ? '…' : ''}</pre>}
        </div>
      ))}
    </div>
  )
}
