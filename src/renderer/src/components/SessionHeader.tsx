import { useEffect, useRef, useState } from 'react'
import type { SessionInfo, Workspace } from '@shared/types'
import { inWorkspace, shortPath, timeAgo } from '../lib'

interface Props {
  session: SessionInfo
  workspaces: Workspace[]
  hasTerminal: boolean
  hasChat: boolean
  onOpenTerminal: () => void
  onCloseTerminal: () => void
  onCloseChat: () => void
  onToggleWorkspace: (wsId: string, assigned: boolean) => void
}

export function SessionHeader({ session: s, workspaces, ...p }: Props): React.JSX.Element {
  const [menu, setMenu] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const home = window.jarvis.homeDir

  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setMenu(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menu])

  return (
    <div className="detail-head">
      <h1>{s.title}</h1>
      <div className="kv">
        <span className="path" onClick={() => window.jarvis.openInFinder(s.projectPath)} title="Abrir no Finder">
          <b>PROJETO</b>{shortPath(s.projectPath, home)}
        </span>
        {s.branch && <span><b>BRANCH</b>{s.branch}</span>}
        {s.model && <span><b>MODELO</b>{s.model}</span>}
        <span><b>MSGS</b>{s.messageCount}</span>
        <span><b>ATIVIDADE</b>{timeAgo(s.lastActivityAt)}</span>
        <span><b>ORIGEM</b>{s.source === 'desktop' ? 'Claude Desktop' : 'Terminal'}</span>
      </div>
      <div className="actions">
        {p.hasChat && (
          <button className="btn danger" onClick={p.onCloseChat} title="Encerra o processo do Claude desta sessão">
            ■ Encerrar chat
          </button>
        )}
        {p.hasTerminal ? (
          <button className="btn danger" onClick={p.onCloseTerminal}>■ Encerrar terminal</button>
        ) : (
          <button className="btn" onClick={p.onOpenTerminal}>⌨ Abrir no terminal</button>
        )}
        <div className="ws-picker" ref={ref}>
          <button className="btn" onClick={() => setMenu((m) => !m)}>◆ Workspaces</button>
          {menu && (
            <div className="ws-menu">
              {workspaces.length === 0 && <div className="none">Nenhum workspace criado</div>}
              {workspaces.map((w) => {
                const auto = w.autoPaths.some((ap) => s.projectPath === ap || s.projectPath.startsWith(ap + '/'))
                return (
                  <label key={w.id} title={auto ? 'Incluída automaticamente pela pasta do projeto' : undefined}>
                    <input
                      type="checkbox"
                      checked={inWorkspace(w, s)}
                      disabled={auto}
                      onChange={(e) => p.onToggleWorkspace(w.id, e.target.checked)}
                    />
                    <span style={{ color: w.color }}>{w.icon}</span>
                    {w.name}
                    {auto && <span className="badge archived" style={{ marginLeft: 'auto' }}>AUTO</span>}
                  </label>
                )
              })}
            </div>
          )}
        </div>
        <button className="btn ghost" onClick={() => navigator.clipboard.writeText(`claude --resume ${s.id}`)} title="Copiar comando">
          ⧉ Copiar ID
        </button>
      </div>
    </div>
  )
}
