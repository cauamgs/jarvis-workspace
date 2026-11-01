import { useEffect, useMemo, useState } from 'react'
import { Overlay } from '../Overlay'
import type { NavRequest, ProjectDetail, ProjectInfo, SessionInfo } from '@shared/types'
import { timeAgo } from '../../lib'

/** Último resultado em memória: voltar ao módulo é instantâneo enquanto atualiza em segundo plano. */
let cache: ProjectInfo[] | null = null

const dirty = (p: ProjectInfo): number => p.staged + p.unstaged + p.untracked + p.conflicts

interface Props {
  /** Projeto a abrir (vindo da busca rápida ou de uma sessão). */
  focusPath?: string
  onNavigate: (req: NavRequest) => void
}

export function ProjectsView({ focusPath, onNavigate }: Props): React.JSX.Element {
  const [list, setList] = useState<ProjectInfo[] | null>(cache)
  const [loading, setLoading] = useState(false)
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [selected, setSelected] = useState<string | null>(focusPath ?? null)
  const [query, setQuery] = useState('')
  const [onlyDirty, setOnlyDirty] = useState(false)

  async function refresh(): Promise<void> {
    setLoading(true)
    const [projects, s] = await Promise.all([window.jarvis.projList(), window.jarvis.listSessions()])
    cache = projects
    setList(projects)
    setSessions(s)
    setLoading(false)
  }

  useEffect(() => {
    void refresh()
  }, [])
  useEffect(() => {
    if (focusPath) setSelected(focusPath)
  }, [focusPath])

  const sessionsByProject = useMemo(() => {
    const map = new Map<string, SessionInfo[]>()
    for (const s of sessions) map.set(s.projectPath, [...(map.get(s.projectPath) ?? []), s])
    return map
  }, [sessions])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const lastActivity = (p: ProjectInfo): number =>
      Math.max(p.lastCommit?.date ?? 0, ...(sessionsByProject.get(p.path) ?? []).map((s) => s.lastActivityAt))
    return (list ?? [])
      .filter((p) => (!q || p.name.toLowerCase().includes(q) || p.branch.toLowerCase().includes(q)) && (!onlyDirty || dirty(p) > 0 || p.ahead > 0))
      .sort((a, b) => lastActivity(b) - lastActivity(a))
  }, [list, query, onlyDirty, sessionsByProject])

  const current = list?.find((p) => p.path === selected) ?? null
  const totals = useMemo(
    () => ({
      dirty: (list ?? []).filter((p) => dirty(p) > 0).length,
      ahead: (list ?? []).filter((p) => p.ahead > 0).length,
      behind: (list ?? []).filter((p) => p.behind > 0).length
    }),
    [list]
  )

  return (
    <div className="projview">
      <section className="panel proj-list">
        <div className="panel-header">
          Projetos
          <span className="count">{String(shown.length).padStart(2, '0')}</span>
          <button className="btn sm" onClick={() => void refresh()} disabled={loading} title="Varrer repositórios de novo">
            {loading ? '…' : '↻'}
          </button>
        </div>
        <div className="proj-summary">
          <span><b>{totals.dirty}</b> com alterações</span>
          <span><b>{totals.ahead}</b> à frente</span>
          <span><b>{totals.behind}</b> atrás</span>
        </div>
        <div className="search">
          <input className="input" placeholder="Buscar projeto ou branch…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button className={`chip${onlyDirty ? ' on' : ''}`} onClick={() => setOnlyDirty((v) => !v)} title="Só projetos com alterações ou commits não enviados">
            Pendentes
          </button>
        </div>
        <div className="panel-body">
          {list === null && <div className="empty">Varrendo repositórios…</div>}
          {shown.map((p) => {
            const ss = sessionsByProject.get(p.path) ?? []
            return (
              <div key={p.path} className={`proj${selected === p.path ? ' active' : ''}`} onClick={() => setSelected(p.path)}>
                <div className="proj-top">
                  <span className="proj-name">{p.name}</span>
                  {ss.some((s) => s.live) && <span className="live-dot" title="Sessão do Claude rodando" />}
                  <span className="proj-time">{p.lastCommit ? timeAgo(p.lastCommit.date) : ''}</span>
                </div>
                <div className="proj-meta">
                  <span className="branch">⎇ {p.branch || '—'}</span>
                  <StatusPills p={p} />
                  {ss.length > 0 && <span className="pill sessions" title="Sessões do Claude neste projeto">◈ {ss.length}</span>}
                </div>
                {p.error && <div className="proj-err">{p.error}</div>}
              </div>
            )
          })}
        </div>
      </section>
      {current ? (
        <ProjectPanel key={current.path} p={current} sessions={sessionsByProject.get(current.path) ?? []} onNavigate={onNavigate} onChanged={refresh} />
      ) : (
        <section className="panel">
          <div className="empty">Selecione um projeto</div>
        </section>
      )}
    </div>
  )
}

function StatusPills({ p }: { p: ProjectInfo }): React.JSX.Element {
  return (
    <>
      {p.ahead > 0 && <span className="pill ahead" title="Commits não enviados">↑{p.ahead}</span>}
      {p.behind > 0 && <span className="pill behind" title="Commits no remoto ainda não baixados">↓{p.behind}</span>}
      {p.conflicts > 0 && <span className="pill conflict" title="Conflitos">⚠ {p.conflicts}</span>}
      {p.staged + p.unstaged > 0 && <span className="pill mod" title="Arquivos modificados">● {p.staged + p.unstaged}</span>}
      {p.untracked > 0 && <span className="pill new" title="Arquivos novos">+{p.untracked}</span>}
      {p.stashes > 0 && <span className="pill dim" title="Stashes">⧉ {p.stashes}</span>}
      {p.worktrees > 0 && <span className="pill dim" title="Worktrees (ex.: do Claude)">⑂ {p.worktrees}</span>}
    </>
  )
}

type Tab = 'changes' | 'commits' | 'branches'

function ProjectPanel({
  p,
  sessions,
  onNavigate,
  onChanged
}: {
  p: ProjectInfo
  sessions: SessionInfo[]
  onNavigate: (req: NavRequest) => void
  onChanged: () => Promise<void>
}): React.JSX.Element {
  const [detail, setDetail] = useState<ProjectDetail | null>(null)
  const [tab, setTab] = useState<Tab>(dirty(p) > 0 ? 'changes' : 'commits')
  const [patch, setPatch] = useState<{ title: string; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = (): void => void window.jarvis.projDetail(p.path).then(setDetail)
  useEffect(load, [p.path, p.branch, p.ahead, p.behind, p.staged, p.unstaged, p.untracked])

  async function action(kind: 'fetch' | 'pull'): Promise<void> {
    setBusy(kind)
    const r = await window.jarvis.projAction(p.path, kind)
    setBusy(null)
    setMsg({ ok: r.ok, text: r.ok ? (kind === 'fetch' ? 'Remoto atualizado.' : r.out.split('\n').pop() || 'Atualizado.') : r.out.split('\n').slice(-2).join(' ') })
    await onChanged()
  }

  async function checkout(branch: string): Promise<void> {
    setBusy('checkout')
    const r = await window.jarvis.projCheckout(p.path, branch)
    setBusy(null)
    setMsg({ ok: r.ok, text: r.ok ? `Agora em ${branch}.` : r.out.split('\n').slice(-2).join(' ') })
    await onChanged()
  }

  const mrUrl =
    p.web && p.provider === 'gitlab'
      ? `${p.web}/-/merge_requests`
      : p.web && p.provider === 'github'
        ? `${p.web}/pulls`
        : undefined
  const newMrUrl =
    p.web && p.branch && p.provider === 'gitlab'
      ? `${p.web}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${encodeURIComponent(p.branch)}`
      : p.web && p.branch && p.provider === 'github'
        ? `${p.web}/compare/${encodeURIComponent(p.branch)}?expand=1`
        : undefined
  const live = sessions.filter((s) => !s.archived).sort((a, b) => b.lastActivityAt - a.lastActivityAt)

  return (
    <section className="panel proj-detail">
      <div className="detail-head">
        <h1 style={{ cursor: 'default' }}>{p.name}</h1>
        <div className="kv">
          <span className="path" onClick={() => window.jarvis.projOpen(p.path, 'finder')} title="Abrir no Finder">
            <b>PASTA</b>{p.path.replace(window.jarvis.homeDir, '~')}
          </span>
          <span><b>BRANCH</b>{p.branch}{p.upstream && <span className="dim"> → {p.upstream}</span>}</span>
          {p.lastCommit && (
            <span><b>ÚLTIMO COMMIT</b>{p.lastCommit.hash} · {timeAgo(p.lastCommit.date)} · {p.lastCommit.author}</span>
          )}
        </div>
        <div className="proj-pills"><StatusPills p={p} /></div>
        <div className="actions">
          <button className="btn primary" onClick={() => onNavigate({ type: 'new', cwd: p.path })}>◈ Nova sessão Claude</button>
          <button className="btn" disabled={!!busy} onClick={() => void action('fetch')}>{busy === 'fetch' ? 'Buscando…' : '⟳ Fetch'}</button>
          <button className="btn" disabled={!!busy || !p.upstream} onClick={() => void action('pull')} title="git pull --ff-only">
            {busy === 'pull' ? 'Atualizando…' : '↓ Pull'}
          </button>
          <button className="btn ghost" onClick={() => window.jarvis.projOpen(p.path, 'vscode')}>VS Code</button>
          <button className="btn ghost" onClick={() => window.jarvis.projOpen(p.path, 'terminal')}>Terminal</button>
          {p.web && <button className="btn ghost" onClick={() => window.jarvis.openExternal(p.web!)}>{p.provider === 'gitlab' ? 'GitLab' : p.provider === 'github' ? 'GitHub' : 'Remoto'}</button>}
          {mrUrl && <button className="btn ghost" onClick={() => window.jarvis.openExternal(mrUrl)}>{p.provider === 'gitlab' ? 'MRs' : 'PRs'}</button>}
          {newMrUrl && p.ahead >= 0 && (
            <button className="btn ghost" onClick={() => window.jarvis.openExternal(newMrUrl)} title="Abrir criação de MR/PR da branch atual">
              + {p.provider === 'gitlab' ? 'MR' : 'PR'}
            </button>
          )}
        </div>
      </div>
      {msg && <div className={msg.ok ? 'note' : 'warn'} style={{ margin: '8px 20px 0' }} onClick={() => setMsg(null)}>{msg.ok ? '✓' : '✕'} {msg.text}</div>}

      {live.length > 0 && (
        <div className="proj-sessions">
          <span className="ps-title">SESSÕES DO CLAUDE</span>
          {live.slice(0, 6).map((s) => (
            <button key={s.id} className="ps-item" onClick={() => onNavigate({ type: 'session', id: s.id })} title={s.title}>
              {s.live && <i className="live-dot" />} {s.title}
              <small>{timeAgo(s.lastActivityAt)}</small>
            </button>
          ))}
        </div>
      )}

      <div className="tabs">
        <button className={`tab${tab === 'changes' ? ' on' : ''}`} onClick={() => setTab('changes')}>
          Alterações {detail && detail.files.length > 0 && <span className="pill mod">{detail.files.length}</span>}
        </button>
        <button className={`tab${tab === 'commits' ? ' on' : ''}`} onClick={() => setTab('commits')}>Commits</button>
        <button className={`tab${tab === 'branches' ? ' on' : ''}`} onClick={() => setTab('branches')}>Branches</button>
      </div>
      <div className="panel-body proj-body">
        {!detail && <div className="empty">Carregando…</div>}
        {detail && tab === 'changes' && (
          detail.files.length ? (
            detail.files.map((f) => (
              <div
                key={f.path}
                className="file-row"
                onClick={async () => setPatch({ title: f.path, text: await window.jarvis.projFileDiff(p.path, f.path, f.code) })}
              >
                <span className={`fcode ${codeClass(f.code)}`}>{codeLabel(f.code)}</span>
                <span className="fpath">{f.path}</span>
              </div>
            ))
          ) : (
            <div className="empty">Nada pendente — árvore limpa</div>
          )
        )}
        {detail && tab === 'commits' &&
          detail.commits.map((c) => (
            <div key={c.hash} className="commit-row" onClick={async () => setPatch({ title: `${c.hash} · ${c.subject}`, text: await window.jarvis.projCommitDiff(p.path, c.hash) })}>
              <span className="c-hash">{c.hash}</span>
              <span className="c-subject">
                {c.subject}
                {c.refs && <small className="c-refs">{c.refs}</small>}
              </span>
              <span className="c-meta">{c.author} · {timeAgo(c.date)}</span>
            </div>
          ))}
        {detail && tab === 'branches' &&
          detail.branches.map((b) => (
            <div key={b.name} className={`branch-row${b.name === p.branch ? ' current' : ''}`}>
              <span className="b-name">⎇ {b.name}</span>
              {b.track && <span className="pill dim">{b.track.replace('ahead', '↑').replace('behind', '↓').replace(/[[\]]/g, '')}</span>}
              <span className="c-meta">{timeAgo(b.date)}</span>
              {b.name !== p.branch && (
                <button className="row-btn" disabled={!!busy} onClick={() => void checkout(b.name)}>Trocar</button>
              )}
            </div>
          ))}
      </div>

      {patch && (
        <Overlay onClose={() => setPatch(null)}>
          <div className="panel modal logs-modal">
            <div className="panel-header">
              {patch.title}
              <button className="btn sm ghost" style={{ marginLeft: 'auto' }} onClick={() => setPatch(null)}>Fechar</button>
            </div>
            <PatchView text={patch.text} />
          </div>
        </Overlay>
      )}
    </section>
  )
}

function codeLabel(code: string): string {
  if (code.includes('?')) return 'NOVO'
  if (code.includes('U')) return 'CONFLITO'
  if (code.includes('D')) return 'REMOVIDO'
  if (code.includes('A')) return 'ADICIONADO'
  if (code.includes('R')) return 'RENOMEADO'
  return 'MODIFICADO'
}

function codeClass(code: string): string {
  if (code.includes('?') || code.includes('A')) return 'new'
  if (code.includes('U')) return 'conflict'
  if (code.includes('D')) return 'del'
  return 'mod'
}

/** Diff unificado do git, colorido por linha. */
function PatchView({ text }: { text: string }): React.JSX.Element {
  const lines = text.split('\n').slice(0, 4000)
  // Cabeçalho e mensagem do commit (antes do primeiro "diff --git") não são linhas de diff.
  const firstDiff = lines.findIndex((l) => l.startsWith('diff '))
  return (
    <pre className="diff patch">
      {lines.map((l, i) => {
        const cls = firstDiff >= 0 && i < firstDiff
          ? 'ctx'
          : l.startsWith('+++') || l.startsWith('---') || l.startsWith('diff ') || l.startsWith('index ')
          ? 'meta'
          : l.startsWith('@@')
            ? 'hunk'
            : l.startsWith('+')
              ? 'add'
              : l.startsWith('-')
                ? 'del'
                : 'ctx'
        return <div key={i} className={cls}>{l || ' '}</div>
      })}
      {!text && <div className="ctx">(sem diferenças)</div>}
    </pre>
  )
}
