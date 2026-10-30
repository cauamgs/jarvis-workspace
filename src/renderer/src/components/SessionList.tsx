import { useMemo } from 'react'
import type { SessionInfo, Workspace } from '@shared/types'
import { dayGroup, inWorkspace, timeAgo } from '../lib'

interface Props {
  title: string
  sessions: SessionInfo[]
  workspaces: Workspace[]
  selectedId: string | null
  terminals: Set<string>
  onSelect: (id: string) => void
  query: string
  onQuery: (q: string) => void
  showArchived: boolean
  onToggleArchived: () => void
  onNewSession?: () => void
}

export function SessionList(p: Props): React.JSX.Element {
  const groups = useMemo(() => {
    const out: [string, SessionInfo[]][] = []
    for (const s of p.sessions) {
      const g = dayGroup(s.lastActivityAt)
      const last = out[out.length - 1]
      if (last && last[0] === g) last[1].push(s)
      else out.push([g, [s]])
    }
    return out
  }, [p.sessions])

  return (
    <section className="panel">
      <div className="panel-header">
        {p.title}
        <span className="count">{String(p.sessions.length).padStart(3, '0')}</span>
        {p.onNewSession && (
          <button className="btn sm" onClick={p.onNewSession} title="Nova sessão do Claude Code neste workspace">
            + Nova
          </button>
        )}
      </div>
      <div className="search">
        <input
          className="input"
          placeholder="Buscar sessões, projetos…"
          value={p.query}
          onChange={(e) => p.onQuery(e.target.value)}
        />
        <button className={`chip${p.showArchived ? ' on' : ''}`} onClick={p.onToggleArchived} title="Mostrar arquivadas">
          ARQ
        </button>
      </div>
      <div className="panel-body">
        {p.sessions.length === 0 && <div className="empty">Nenhuma sessão por aqui</div>}
        {groups.map(([g, list]) => (
          <div key={g}>
            <div className="group-label">{g}</div>
            {list.map((s) => {
              const wss = p.workspaces.filter((w) => inWorkspace(w, s))
              return (
                <div
                  key={s.id}
                  className={`session${p.selectedId === s.id ? ' active' : ''}`}
                  onClick={() => p.onSelect(s.id)}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('jarvis/session', s.id)
                    e.dataTransfer.effectAllowed = 'link'
                  }}
                >
                  <div className="title">
                    <span className="t">{s.title}</span>
                    {p.terminals.has(s.id) ? (
                      <span className="live-dot term" title="Terminal aberto no Jarvis" />
                    ) : s.live ? (
                      <span className="live-dot" title="Sessão rodando agora" />
                    ) : null}
                  </div>
                  <div className="meta">
                    <span className={`badge ${s.source}`}>{s.source === 'desktop' ? 'DESKTOP' : 'TERMINAL'}</span>
                    {s.archived && <span className="badge archived">ARQ</span>}
                    <span className="proj">{s.projectName}</span>
                    <span className="time">{timeAgo(s.lastActivityAt)}</span>
                  </div>
                  {wss.length > 0 && (
                    <div className="dots">
                      {wss.map((w) => (
                        <i key={w.id} title={w.name} style={{ background: w.color, boxShadow: `0 0 5px ${w.color}` }} />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </section>
  )
}
