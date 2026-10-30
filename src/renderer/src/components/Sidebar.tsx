import { useState } from 'react'
import type { Workspace } from '@shared/types'
import { ArcReactor } from './ArcReactor'

export type View = { kind: 'all' } | { kind: 'unassigned' } | { kind: 'live' } | { kind: 'ws'; id: string }

interface Props {
  view: View
  onView: (v: View) => void
  workspaces: Workspace[]
  counts: { all: number; unassigned: number; live: number; ws: Record<string, number> }
  onNewWorkspace: () => void
  onEditWorkspace: (ws: Workspace) => void
  onDropSession: (wsId: string, sessionId: string) => void
}

function greeting(): string {
  const h = new Date().getHours()
  return h < 12 ? 'Bom dia, senhor.' : h < 18 ? 'Boa tarde, senhor.' : 'Boa noite, senhor.'
}

export function Sidebar(p: Props): React.JSX.Element {
  const [dropId, setDropId] = useState<string | null>(null)
  const is = (v: View): boolean =>
    v.kind === p.view.kind && (v.kind !== 'ws' || (p.view.kind === 'ws' && p.view.id === v.id))

  return (
    <aside className="panel">
      <div className="reactor-wrap">
        <ArcReactor size={58} />
        <div className="greet">
          ONLINE
          <span>{greeting()}</span>
        </div>
      </div>
      <div className="panel-body">
        <div className="nav-section">VISÕES</div>
        <NavItem active={is({ kind: 'all' })} glyph="◎" label="Todas as sessões" n={p.counts.all} onClick={() => p.onView({ kind: 'all' })} />
        <NavItem active={is({ kind: 'live' })} glyph="●" label="Em execução" n={p.counts.live} color="#3dffb0" onClick={() => p.onView({ kind: 'live' })} />
        <NavItem active={is({ kind: 'unassigned' })} glyph="◌" label="Sem workspace" n={p.counts.unassigned} onClick={() => p.onView({ kind: 'unassigned' })} />

        <div className="nav-section">
          WORKSPACES
          <button title="Novo workspace" onClick={p.onNewWorkspace}>+</button>
        </div>
        {p.workspaces.length === 0 && (
          <div className="nav-item" onClick={p.onNewWorkspace} style={{ color: 'var(--text-faint)', fontWeight: 500 }}>
            + Criar primeiro workspace
          </div>
        )}
        {p.workspaces.map((ws) => (
          <div
            key={ws.id}
            className={`nav-item${is({ kind: 'ws', id: ws.id }) ? ' active' : ''}${dropId === ws.id ? ' drop' : ''}`}
            style={{ '--ws-color': ws.color } as React.CSSProperties}
            onClick={() => p.onView({ kind: 'ws', id: ws.id })}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes('jarvis/session')) {
                e.preventDefault()
                setDropId(ws.id)
              }
            }}
            onDragLeave={() => setDropId(null)}
            onDrop={(e) => {
              setDropId(null)
              const id = e.dataTransfer.getData('jarvis/session')
              if (id) p.onDropSession(ws.id, id)
            }}
          >
            <span className="glyph"><span>{ws.icon}</span></span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ws.name}</span>
            <span className="n">{p.counts.ws[ws.id] ?? 0}</span>
            <button
              className="edit"
              title="Editar workspace"
              onClick={(e) => {
                e.stopPropagation()
                p.onEditWorkspace(ws)
              }}
            >
              ⚙
            </button>
          </div>
        ))}
      </div>
    </aside>
  )
}

function NavItem(props: { active: boolean; glyph: string; label: string; n: number; color?: string; onClick: () => void }): React.JSX.Element {
  return (
    <div
      className={`nav-item${props.active ? ' active' : ''}`}
      style={props.color ? ({ '--ws-color': props.color } as React.CSSProperties) : undefined}
      onClick={props.onClick}
    >
      <span className="glyph"><span>{props.glyph}</span></span>
      {props.label}
      <span className="n">{props.n}</span>
    </div>
  )
}
