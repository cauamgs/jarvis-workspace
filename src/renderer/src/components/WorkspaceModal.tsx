import { useState } from 'react'
import type { Workspace } from '@shared/types'
import { shortPath, uuid, WS_COLORS, WS_ICONS } from '../lib'

interface Props {
  initial?: Workspace
  projectPaths: string[]
  onSave: (ws: Workspace) => void
  onDelete?: (id: string) => void
  onClose: () => void
}

export function WorkspaceModal({ initial, projectPaths, onSave, onDelete, onClose }: Props): React.JSX.Element {
  const [name, setName] = useState(initial?.name ?? '')
  const [color, setColor] = useState(initial?.color ?? WS_COLORS[0])
  const [icon, setIcon] = useState(initial?.icon ?? WS_ICONS[0])
  const [autoPaths, setAutoPaths] = useState<string[]>(initial?.autoPaths ?? [])
  const [confirmDel, setConfirmDel] = useState(false)
  const home = window.jarvis.homeDir

  const toggle = (p: string): void =>
    setAutoPaths((a) => (a.includes(p) ? a.filter((x) => x !== p) : [...a, p]))

  const submit = (): void => {
    if (!name.trim()) return
    onSave({
      id: initial?.id ?? uuid(),
      name: name.trim(),
      color,
      icon,
      autoPaths,
      sessionIds: initial?.sessionIds ?? [],
      createdAt: initial?.createdAt ?? Date.now()
    })
  }

  const suggestions = projectPaths.filter((p) => !autoPaths.includes(p))

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel modal">
        <div className="panel-header">{initial ? 'Configurar workspace' : 'Novo workspace'}</div>
        <div className="body">
          <div className="field">
            <label>Nome</label>
            <input
              className="input"
              autoFocus
              value={name}
              placeholder="ex.: SAI, InovaApps, Faculdade…"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          </div>
          <div className="field">
            <label>Cor</label>
            <div className="swatches">
              {WS_COLORS.map((c) => (
                <div key={c} className={`swatch${c === color ? ' on' : ''}`} style={{ background: c, color: c }} onClick={() => setColor(c)} />
              ))}
            </div>
          </div>
          <div className="field">
            <label>Ícone</label>
            <div className="icons">
              {WS_ICONS.map((i) => (
                <button key={i} className={`icon-opt${i === icon ? ' on' : ''}`} style={{ color }} onClick={() => setIcon(i)}>
                  {i}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label>Pastas vinculadas</label>
            {autoPaths.map((p) => (
              <div key={p} className="path-row">
                <span>{shortPath(p, home)}</span>
                <button className="btn sm ghost" onClick={() => toggle(p)}>✕</button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
              {suggestions.map((p) => (
                <button key={p} className="chip" onClick={() => toggle(p)} title={p}>
                  + {p.split('/').pop()}
                </button>
              ))}
              <button
                className="chip"
                onClick={async () => {
                  const d = await window.jarvis.pickDirectory()
                  if (d && !autoPaths.includes(d)) setAutoPaths((a) => [...a, d])
                }}
              >
                + Outra pasta…
              </button>
            </div>
            <div className="hint">Toda sessão (atual ou futura) desses projetos entra automaticamente neste workspace.</div>
          </div>
        </div>
        <div className="foot">
          {initial && onDelete && (
            <button className="btn danger left" onClick={() => (confirmDel ? onDelete(initial.id) : setConfirmDel(true))}>
              {confirmDel ? 'Confirmar exclusão' : 'Excluir'}
            </button>
          )}
          <button className="btn ghost" onClick={onClose}>Cancelar</button>
          <button className="btn primary" onClick={submit} disabled={!name.trim()}>Salvar</button>
        </div>
      </div>
    </div>
  )
}
