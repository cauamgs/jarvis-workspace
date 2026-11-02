import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { ContextMessage, McpBridgeStatus, MemoryFile, NavRequest, SearchResult, SessionInfo, Workspace } from '@shared/types'
import { highlightRegex, queryTerms } from '@shared/text'
import { inWorkspace, shortPath, timeAgo } from '../../lib'
import { Markdown } from '../Markdown'

type Tab = 'search' | 'notes' | 'mcp'

interface Props {
  sessions: SessionInfo[]
  workspaces: Workspace[]
  /** Busca vinda de fora (busca rápida / voz). */
  initialQuery?: { q: string; n: number }
  onNavigate: (req: NavRequest) => void
}

/** Texto com os termos da busca destacados. */
function Highlight({ text, terms }: { text: string; terms: string[] }): React.JSX.Element {
  const re = useMemo(() => highlightRegex(terms), [terms])
  if (!re) return <>{text}</>
  const out: React.ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index))
    out.push(<mark key={m.index}>{m[0]}</mark>)
    last = m.index! + m[0].length
  }
  out.push(text.slice(last))
  return <>{out}</>
}

export function MemoryView({ sessions, workspaces, initialQuery, onNavigate }: Props): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('search')
  const [query, setQuery] = useState(initialQuery?.q ?? '')
  const [scope, setScope] = useState<string>('all')
  const [role, setRole] = useState<'' | 'user' | 'assistant'>('')
  const [result, setResult] = useState<SearchResult | null>(null)
  const [hit, setHit] = useState<{ sessionId: string; uuid: string } | null>(null)
  const [wsId, setWsId] = useState<string | null>(workspaces[0]?.id ?? null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!initialQuery) return
    setTab('search')
    setQuery(initialQuery.q)
    inputRef.current?.focus()
  }, [initialQuery])

  const byId = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions])
  const terms = useMemo(() => queryTerms(query), [query])

  // Busca com pequena espera enquanto digita.
  useEffect(() => {
    if (!terms.length) {
      setResult(null)
      return
    }
    const ws = workspaces.find((w) => w.id === scope)
    const ids = ws ? sessions.filter((s) => inWorkspace(ws, s)).map((s) => s.id) : undefined
    let alive = true
    const t = setTimeout(() => {
      void window.jarvis.searchConversations(query, { sessionIds: ids, role: role || undefined }).then((r) => alive && setResult(r))
    }, 220)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [query, terms.length, scope, role, workspaces, sessions])

  const totalHits = result?.groups.reduce((n, g) => n + g.total, 0) ?? 0

  return (
    <div className="memview">
      <section className="panel">
        <div className="panel-header">
          Memória
          <span className="count">{result?.indexing ? 'INDEXANDO…' : result ? `${result.indexed} SESSÕES` : ''}</span>
        </div>
        <div className="tabs">
          <button className={`tab${tab === 'search' ? ' on' : ''}`} onClick={() => setTab('search')}>Conversas</button>
          <button className={`tab${tab === 'notes' ? ' on' : ''}`} onClick={() => setTab('notes')}>Cadernos</button>
          <button className={`tab${tab === 'mcp' ? ' on' : ''}`} onClick={() => setTab('mcp')}>Conexão</button>
        </div>

        {tab === 'search' && (
          <>
            <div className="search mem-search">
              <input
                ref={inputRef}
                className="input"
                autoFocus
                placeholder='Buscar em todas as conversas…  ex.: migration postgres, "erro 502"'
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="mem-filters">
              <select className="select" value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="all">Todas as sessões</option>
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>{w.icon} {w.name}</option>
                ))}
              </select>
              {(['', 'user', 'assistant'] as const).map((r) => (
                <button key={r} className={`chip${role === r ? ' on' : ''}`} onClick={() => setRole(r)}>
                  {r === '' ? 'Tudo' : r === 'user' ? 'Meus pedidos' : 'Respostas'}
                </button>
              ))}
            </div>
            <div className="panel-body">
              {!terms.length && (
                <div className="mem-hint">
                  <p>Encontre qualquer coisa já conversada com o Claude, em qualquer projeto: decisões, comandos, erros, nomes de arquivos.</p>
                  <p>Todos os termos precisam aparecer na mesma mensagem. Use <b>"aspas"</b> para frase exata. Acentos e maiúsculas são ignorados.</p>
                </div>
              )}
              {result && terms.length > 0 && (
                <div className="proj-summary">
                  <span><b>{totalHits}</b> trechos</span>
                  <span><b>{result.groups.length}</b> sessões</span>
                  <span style={{ marginLeft: 'auto' }}>{result.ms} ms</span>
                </div>
              )}
              {result?.groups.map((g) => {
                const s = byId.get(g.sessionId)
                return (
                  <div key={g.sessionId} className="mem-group">
                    <div className="mem-group-head">
                      <span className="t">{s?.title ?? 'Sessão'}</span>
                      <span className="m">{s?.projectName} · {g.total} · {timeAgo(g.lastHit)}</span>
                    </div>
                    {g.hits.map((h) => (
                      <div
                        key={h.uuid}
                        className={`mem-hit${hit?.uuid === h.uuid ? ' on' : ''}`}
                        onClick={() => setHit({ sessionId: g.sessionId, uuid: h.uuid })}
                      >
                        <span className={`who ${h.role}`}>{h.role === 'user' ? 'VOCÊ' : 'CLAUDE'}</span>
                        <span className="snip"><Highlight text={h.snippet} terms={terms} /></span>
                      </div>
                    ))}
                  </div>
                )
              })}
              {result && terms.length > 0 && !result.groups.length && <div className="empty">Nada encontrado</div>}
            </div>
          </>
        )}

        {tab === 'notes' && (
          <div className="panel-body">
            <div className="mem-hint">
              <p>Cada workspace tem um caderno. Ele entra no início de toda sessão nova do chat do Jarvis daquele projeto, e qualquer sessão do Claude (inclusive as já existentes) pode lê-lo e anotar nele pela conexão.</p>
            </div>
            {workspaces.length === 0 && <div className="empty">Crie um workspace no módulo Sessões</div>}
            {workspaces.map((w) => (
              <div key={w.id} className={`proj${wsId === w.id ? ' active' : ''}`} onClick={() => setWsId(w.id)}>
                <div className="proj-name"><span style={{ color: w.color }}>{w.icon}</span> {w.name}</div>
                <div className="proj-meta">{w.autoPaths.length ? w.autoPaths.map((p) => shortPath(p, window.jarvis.homeDir)).join(' · ') : `${w.sessionIds.length} sessões`}</div>
              </div>
            ))}
          </div>
        )}

        {tab === 'mcp' && (
          <div className="panel-body">
            <div className="mem-hint">
              <p>A conexão dá a qualquer sessão do Claude Code (terminal, Claude Desktop e o chat do Jarvis) ferramentas para consultar esta memória e o seu ambiente.</p>
            </div>
            <ul className="mem-tools">
              <li><b>buscar_conversas</b> · <b>ler_conversa</b> — encontra e lê sessões anteriores</li>
              <li><b>memoria_workspace</b> · <b>anotar_memoria</b> — lê e escreve no caderno</li>
              <li><b>contexto_projeto</b> — CLAUDE.md e memórias automáticas</li>
              <li><b>estado_ambiente</b> · <b>logs_container</b> — git, portas e Docker</li>
              <li><b>quem_alterou</b> — sessões que editaram um arquivo</li>
            </ul>
          </div>
        )}
      </section>

      {tab === 'search' && (hit ? <HitPanel key={hit.uuid} hit={hit} session={byId.get(hit.sessionId)} terms={terms} onNavigate={onNavigate} /> : <IdlePanel />)}
      {tab === 'notes' && (wsId && workspaces.some((w) => w.id === wsId) ? <NotesPanel key={wsId} ws={workspaces.find((w) => w.id === wsId)!} sessions={sessions} /> : <IdlePanel />)}
      {tab === 'mcp' && <McpPanel />}
    </div>
  )
}

function IdlePanel(): React.JSX.Element {
  return (
    <section className="panel">
      <div className="idle">
        <div>
          <h2>MEMÓRIA</h2>
          <p>Tudo o que você e o Claude já conversaram, em um só lugar.</p>
        </div>
      </div>
    </section>
  )
}

function HitPanel({
  hit,
  session,
  terms,
  onNavigate
}: {
  hit: { sessionId: string; uuid: string }
  session?: SessionInfo
  terms: string[]
  onNavigate: (req: NavRequest) => void
}): React.JSX.Element {
  const [radius, setRadius] = useState(3)
  const [msgs, setMsgs] = useState<ContextMessage[]>([])
  const [copied, setCopied] = useState(false)
  const matchRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.jarvis.searchContext(hit.sessionId, hit.uuid, radius).then(setMsgs)
  }, [hit, radius])
  useEffect(() => {
    if (radius === 3) matchRef.current?.scrollIntoView({ block: 'center' })
  }, [msgs, radius])

  const excerpt = (): string =>
    `Trecho da sessão "${session?.title ?? hit.sessionId}" (${session?.projectPath ?? ''}):\n\n` +
    msgs.map((m) => `${m.role === 'user' ? 'Usuário' : 'Claude'}: ${m.text}`).join('\n\n')

  return (
    <section className="panel">
      <div className="detail-head">
        <h1>{session?.title ?? 'Sessão'}</h1>
        <div className="kv">
          {session && <span><b>PROJETO</b>{shortPath(session.projectPath, window.jarvis.homeDir)}</span>}
          {session?.branch && <span><b>BRANCH</b>{session.branch}</span>}
          {session && <span><b>ATIVIDADE</b>{timeAgo(session.lastActivityAt)}</span>}
        </div>
        <div className="actions">
          <button className="btn primary" onClick={() => onNavigate({ type: 'session', id: hit.sessionId })}>◈ Abrir sessão</button>
          <button
            className="btn"
            onClick={() => {
              void navigator.clipboard.writeText(excerpt())
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
          >
            {copied ? '✓ Copiado' : '⧉ Copiar trecho'}
          </button>
          <button className="btn ghost" onClick={() => setRadius((r) => r + 6)}>↕ Mais contexto</button>
        </div>
      </div>
      <div className="panel-body mem-thread">
        {msgs.map((m) => (
          <div key={m.uuid} ref={m.match ? matchRef : undefined} className={`mem-msg ${m.role}${m.match ? ' match' : ''}`}>
            <div className="mem-msg-head">
              {m.role === 'user' ? '▸ VOCÊ' : '◆ CLAUDE'} <span>{new Date(m.timestamp).toLocaleString('pt-BR')}</span>
            </div>
            <div className="mem-msg-text">
              <Highlight text={m.text} terms={terms} />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function NotesPanel({ ws, sessions }: { ws: Workspace; sessions: SessionInfo[] }): React.JSX.Element {
  const [text, setText] = useState<string | null>(null)
  const [saved, setSaved] = useState('')
  const [preview, setPreview] = useState(false)
  const [files, setFiles] = useState<MemoryFile[]>([])
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    const load = (): void =>
      void window.jarvis.memoryGet(ws.id).then((t) => {
        setText(t)
        setSaved(t)
      })
    load()
    // Notas acrescentadas pelo Claude (anotar_memoria) aparecem sem recarregar.
    return window.jarvis.onMemoryChanged((id) => id === ws.id && load())
  }, [ws.id])

  // Pastas do workspace: vinculadas ou de onde vêm as sessões dele.
  const paths = useMemo(() => {
    const set = new Set(ws.autoPaths)
    for (const s of sessions) if (inWorkspace(ws, s) && s.projectPath) set.add(s.projectPath)
    return [...set]
  }, [ws, sessions])

  useEffect(() => {
    void Promise.all(paths.map((p) => window.jarvis.projectContext(p))).then((all) => {
      const seen = new Set<string>()
      setFiles(all.flat().filter((f) => f.kind !== 'user' && !seen.has(f.path) && seen.add(f.path)))
    })
  }, [paths])

  const dirty = text !== null && text !== saved
  async function save(): Promise<void> {
    if (text === null) return
    await window.jarvis.memorySet(ws.id, text)
    setSaved(text)
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <span style={{ color: ws.color }}>{ws.icon}</span> Caderno · {ws.name}
        <span className="count">{dirty ? 'NÃO SALVO' : 'SALVO'}</span>
      </div>
      <div className="mem-notes-bar">
        <button className={`chip${!preview ? ' on' : ''}`} onClick={() => setPreview(false)}>Editar</button>
        <button className={`chip${preview ? ' on' : ''}`} onClick={() => setPreview(true)}>Visualizar</button>
        <span style={{ flex: 1 }} />
        <button className="btn sm primary" disabled={!dirty} onClick={() => void save()}>Salvar</button>
      </div>
      <div className="panel-body mem-notes">
        {preview ? (
          <div className="mem-preview">{text?.trim() ? <Markdown text={text} /> : <div className="empty">Caderno vazio</div>}</div>
        ) : (
          <textarea
            className="input mem-editor"
            value={text ?? ''}
            placeholder={'Decisões, convenções e informações que valem para todas as sessões deste workspace.\n\nex.:\n- API de homologação: https://hml.exemplo.com\n- Migrations sempre com knex, nunca SQL solto\n- Branch de entrega: develop'}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => dirty && void save()}
            onKeyDown={(e) => {
              if (e.key === 's' && e.metaKey) {
                e.preventDefault()
                void save()
              }
            }}
          />
        )}
        {files.length > 0 && (
          <>
            <div className="group-label">O QUE O CLAUDE JÁ LÊ NESTES PROJETOS · SOMENTE LEITURA</div>
            {files.map((f) => (
              <Fragment key={f.path}>
                <div className="file-row" onClick={() => setOpen(open === f.path ? null : f.path)}>
                  <span className={`pill ${f.kind === 'auto' ? 'new' : 'dim'}`}>{f.kind === 'auto' ? 'AUTO' : 'MD'}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    {f.label}
                    <div className="proj-meta">{shortPath(f.path, window.jarvis.homeDir)}</div>
                  </span>
                  <span className="dim">{open === f.path ? '▾' : '▸'}</span>
                </div>
                {open === f.path && (
                  <div className="mem-preview inset">
                    <Markdown text={f.text} />
                  </div>
                )}
              </Fragment>
            ))}
          </>
        )}
      </div>
    </section>
  )
}

function McpPanel(): React.JSX.Element {
  const [st, setSt] = useState<McpBridgeStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    void window.jarvis.mcpBridgeStatus().then(setSt)
  }, [])

  async function run(fn: () => Promise<{ ok: boolean; status?: McpBridgeStatus; error?: string }>): Promise<void> {
    setBusy(true)
    setErr(null)
    const r = await fn()
    setBusy(false)
    if (r.ok && r.status) setSt(r.status)
    else setErr(r.error ?? 'Falhou.')
  }

  const state = !st ? '…' : !st.running ? 'SERVIDOR PARADO' : st.registered && st.current ? 'CONECTADO' : st.registered ? 'DESATUALIZADO' : 'NÃO CONECTADO'
  const ok = st?.running && st.registered && st.current

  return (
    <section className="panel">
      <div className="detail-head">
        <h1>Conexão com o Claude Code</h1>
        <div className="kv">
          <span><b>ESTADO</b><span style={{ color: ok ? 'var(--green)' : 'var(--amber)' }}>{state}</span></span>
          {st && <span><b>SERVIDOR</b>{st.name}</span>}
          {st && <span><b>ENDEREÇO</b>{st.url}</span>}
        </div>
        <div className="actions">
          {st?.running && (
            <button className="btn primary" disabled={busy} onClick={() => void run(window.jarvis.mcpBridgeConnect)}>
              {busy ? 'Aguarde…' : st.registered ? '↻ Reconectar' : '⚡ Conectar ao Claude Code'}
            </button>
          )}
          {st?.registered && (
            <button className="btn danger" disabled={busy} onClick={() => void run(window.jarvis.mcpBridgeDisconnect)}>
              Desconectar
            </button>
          )}
        </div>
      </div>
      <div className="panel-body mem-mcp">
        {err && <div className="warn">✕ {err}</div>}
        {st?.error && <div className="warn">✕ {st.error}</div>}
        {st?.registered && !st.current && (
          <div className="warn">O registro no Claude Code aponta para outro endereço ou token. Clique em Reconectar.</div>
        )}
        <div className="md">
          <p>
            <b>Conectar</b> registra o servidor <code>{st?.name ?? 'jarvis'}</code> nas configurações de usuário do Claude Code
            (<code>claude mcp add --scope user</code>). A partir daí, toda sessão nova — no terminal, no Claude Desktop ou aqui
            no Jarvis — passa a ter as ferramentas do Jarvis. Sessões já abertas precisam ser reiniciadas.
          </p>
          <p>
            O servidor só aceita conexões desta máquina com um token secreto, e só funciona enquanto o Jarvis estiver aberto.
            Os chats do próprio Jarvis já recebem as ferramentas mesmo sem conectar.
          </p>
          <p>Experimente pedir numa sessão: <i>"como resolvemos aquele erro de CORS no outro projeto?"</i> ou <i>"anote no caderno que a branch de entrega é develop"</i>.</p>
        </div>
      </div>
    </section>
  )
}
