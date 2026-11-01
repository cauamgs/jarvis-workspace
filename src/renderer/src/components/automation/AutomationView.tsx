import { useEffect, useState } from 'react'
import type { AppEntry, AutoAction, AutoActionType, AutoResult, Routine } from '@shared/types'
import { uuid } from '../../lib'

const STEP_TYPES: { value: AutoActionType; label: string; placeholder: string }[] = [
  { value: 'app', label: 'Abrir app', placeholder: 'Nome do app' },
  { value: 'quit', label: 'Fechar app', placeholder: 'Nome do app' },
  { value: 'url', label: 'Abrir site', placeholder: 'https://…' },
  { value: 'folder', label: 'Abrir pasta', placeholder: '~/Documents/projects' },
  { value: 'shortcut', label: 'Rodar atalho', placeholder: 'Nome do atalho do macOS' },
  { value: 'volume', label: 'Volume', placeholder: '0–100' },
  { value: 'darkmode', label: 'Aparência', placeholder: 'on, off ou toggle' },
  { value: 'sleep-display', label: 'Dormir a tela', placeholder: '' },
  { value: 'wait', label: 'Esperar', placeholder: 'segundos' },
  { value: 'shell', label: 'Comando de terminal', placeholder: 'ex.: docker compose up -d' }
]

const ICONS = ['⚡', '◉', '☾', '☀', '⚙', '▶', '✦', '◈', '⌘', '♫']

const EXAMPLE: Omit<Routine, 'id'> = {
  name: 'Modo foco',
  icon: '◉',
  triggers: ['foco', 'hora de trabalhar'],
  steps: [
    { type: 'darkmode', target: 'on' },
    { type: 'volume', target: '20' },
    { type: 'app', target: 'Visual Studio Code' },
    { type: 'app', target: 'Terminal' }
  ]
}

function describe(a: AutoAction): string {
  const t = STEP_TYPES.find((x) => x.value === a.type)?.label ?? a.type
  if (a.type === 'darkmode') return `${t}: ${a.target === 'on' ? 'escuro' : a.target === 'off' ? 'claro' : 'alternar'}`
  if (a.type === 'volume') return `${t}: ${a.target}%`
  if (a.type === 'sleep-display') return t
  if (a.type === 'wait') return `${t} ${a.target}s`
  return `${t}: ${a.target.split('/').pop()?.replace(/\.app$/, '')}`
}

export function AutomationView(): React.JSX.Element {
  const [routines, setRoutines] = useState<Routine[]>([])
  const [apps, setApps] = useState<AppEntry[]>([])
  const [shortcuts, setShortcuts] = useState<string[]>([])
  const [editing, setEditing] = useState<Routine | null>(null)
  const [results, setResults] = useState<{ name: string; items: AutoResult[] } | null>(null)
  const [volume, setVolume] = useState(50)

  useEffect(() => {
    void window.jarvis.autoRoutines().then(setRoutines)
    void window.jarvis.autoApps().then(setApps)
    void window.jarvis.autoShortcuts().then(setShortcuts)
  }, [])

  async function runRoutine(r: Routine): Promise<void> {
    setResults({ name: r.name, items: [] })
    setResults({ name: r.name, items: await window.jarvis.autoRunRoutine(r.id) })
  }

  async function quick(a: AutoAction, label: string): Promise<void> {
    const r = await window.jarvis.autoRun(a)
    setResults({ name: label, items: [r] })
  }

  return (
    <div className="autoview">
      <div className="auto-col">
        <section className="panel">
          <div className="panel-header">
            Rotinas
            <span className="count">{String(routines.length).padStart(2, '0')}</span>
            <button className="btn sm" onClick={() => setEditing({ id: uuid(), name: '', icon: '⚡', triggers: [], steps: [] })}>+ Nova</button>
          </div>
          <div className="panel-body">
            {routines.length === 0 && (
              <div className="auto-empty">
                <p>Rotinas executam vários passos de uma vez — pela busca rápida ou falando o nome.</p>
                <button className="btn" onClick={() => setEditing({ ...EXAMPLE, id: uuid() })}>Começar com "Modo foco"</button>
              </div>
            )}
            {routines.map((r) => (
              <div key={r.id} className="routine">
                <span className="r-icon">{r.icon}</span>
                <div className="r-main" onClick={() => setEditing(r)}>
                  <div className="r-name">{r.name}</div>
                  <div className="r-steps">{r.steps.map(describe).join(' · ') || 'sem passos'}</div>
                  {r.triggers.length > 0 && <div className="r-triggers">“{r.triggers.join('”, “')}”</div>}
                </div>
                <button className="btn sm primary" onClick={() => void runRoutine(r)}>▶ Rodar</button>
              </div>
            ))}
          </div>
        </section>

        <section className="panel auto-quick">
          <div className="panel-header">Ações rápidas</div>
          <div className="quick-grid">
            <button className="quick" onClick={() => void quick({ type: 'darkmode', target: 'on' }, 'Modo escuro')}>☾<span>Modo escuro</span></button>
            <button className="quick" onClick={() => void quick({ type: 'darkmode', target: 'off' }, 'Modo claro')}>☀<span>Modo claro</span></button>
            <button className="quick" onClick={() => void quick({ type: 'sleep-display', target: '' }, 'Dormir a tela')}>◐<span>Dormir a tela</span></button>
            <div className="quick volume">
              ♫<span>Volume {volume}%</span>
              <input
                type="range"
                min={0}
                max={100}
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                onMouseUp={() => void quick({ type: 'volume', target: String(volume) }, `Volume ${volume}%`)}
              />
            </div>
          </div>
          {shortcuts.length > 0 && (
            <>
              <div className="group-label">ATALHOS DO MACOS</div>
              {shortcuts.map((s) => (
                <div key={s} className="shortcut-row">
                  <span>⌘ {s}</span>
                  <button className="row-btn" onClick={() => void quick({ type: 'shortcut', target: s }, s)}>Rodar</button>
                </div>
              ))}
            </>
          )}
        </section>
      </div>

      {editing ? (
        <RoutineEditor
          key={editing.id}
          initial={editing}
          apps={apps}
          shortcuts={shortcuts}
          isNew={!routines.some((r) => r.id === editing.id)}
          onSave={async (r) => {
            setRoutines(await window.jarvis.autoSaveRoutine(r))
            setEditing(r)
          }}
          onDelete={async (id) => {
            setRoutines(await window.jarvis.autoDeleteRoutine(id))
            setEditing(null)
          }}
          onRun={(r) => void runRoutine(r)}
        />
      ) : (
        <section className="panel">
          <div className="idle">
            <div>
              <h2>AUTOMAÇÃO DO MAC</h2>
              <p>Crie rotinas ou use a busca rápida: “abrir DBeaver”, “volume 30”, “modo escuro”.</p>
            </div>
          </div>
        </section>
      )}

      {results && (
        <div className="sys-toast ok auto-results" onClick={() => setResults(null)}>
          {results.items.length === 0
            ? `Executando ${results.name}…`
            : results.items.every((r) => r.ok)
              ? `✓ ${results.name} concluída`
              : `✕ ${results.name}: ${results.items.find((r) => !r.ok)?.output.slice(0, 160)}`}
        </div>
      )}
    </div>
  )
}

function RoutineEditor({
  initial,
  apps,
  shortcuts,
  isNew,
  onSave,
  onDelete,
  onRun
}: {
  initial: Routine
  apps: AppEntry[]
  shortcuts: string[]
  isNew: boolean
  onSave: (r: Routine) => void
  onDelete: (id: string) => void
  onRun: (r: Routine) => void
}): React.JSX.Element {
  const [r, setR] = useState<Routine>(initial)
  const [triggers, setTriggers] = useState(initial.triggers.join(', '))
  const [confirmDel, setConfirmDel] = useState(false)
  const setStep = (i: number, patch: Partial<AutoAction>): void =>
    setR((x) => ({ ...x, steps: x.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) }))
  const move = (i: number, d: number): void =>
    setR((x) => {
      const steps = [...x.steps]
      const j = i + d
      if (j < 0 || j >= steps.length) return x
      ;[steps[i], steps[j]] = [steps[j], steps[i]]
      return { ...x, steps }
    })
  const final = (): Routine => ({ ...r, name: r.name.trim(), triggers: triggers.split(',').map((t) => t.trim()).filter(Boolean) })
  const hasShell = r.steps.some((s) => s.type === 'shell')

  return (
    <section className="panel auto-editor">
      <div className="panel-header">{isNew ? 'Nova rotina' : 'Editar rotina'}</div>
      <div className="panel-body editor-body">
        <div className="field">
          <label>Nome</label>
          <input className="input" value={r.name} placeholder="ex.: Modo foco" onChange={(e) => setR({ ...r, name: e.target.value })} />
        </div>
        <div className="field">
          <label>Ícone</label>
          <div className="icons">
            {ICONS.map((i) => (
              <button key={i} className={`icon-opt${i === r.icon ? ' on' : ''}`} onClick={() => setR({ ...r, icon: i })}>{i}</button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Frases que disparam (voz ou busca)</label>
          <input className="input" value={triggers} placeholder="foco, hora de trabalhar" onChange={(e) => setTriggers(e.target.value)} />
          <div className="hint">Separadas por vírgula. O nome da rotina também funciona.</div>
        </div>

        <div className="field">
          <label>Passos</label>
          {r.steps.map((s, i) => {
            const meta = STEP_TYPES.find((x) => x.value === s.type)!
            return (
              <div key={i} className="step">
                <span className="step-n">{i + 1}</span>
                <select className="select" value={s.type} onChange={(e) => setStep(i, { type: e.target.value as AutoActionType, target: '' })}>
                  {STEP_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
                {s.type === 'darkmode' ? (
                  <select className="select step-target" value={s.target || 'toggle'} onChange={(e) => setStep(i, { target: e.target.value })}>
                    <option value="on">Escuro</option>
                    <option value="off">Claro</option>
                    <option value="toggle">Alternar</option>
                  </select>
                ) : s.type === 'sleep-display' ? (
                  <span className="step-target dim">—</span>
                ) : (
                  <input
                    className="input step-target"
                    list={s.type === 'app' || s.type === 'quit' ? 'jarvis-apps' : s.type === 'shortcut' ? 'jarvis-shortcuts' : undefined}
                    value={s.target}
                    placeholder={meta.placeholder}
                    onChange={(e) => setStep(i, { target: e.target.value })}
                  />
                )}
                <button className="row-btn" onClick={() => move(i, -1)} title="Subir">↑</button>
                <button className="row-btn" onClick={() => move(i, 1)} title="Descer">↓</button>
                <button className="row-btn danger" onClick={() => setR({ ...r, steps: r.steps.filter((_, j) => j !== i) })} title="Remover">✕</button>
              </div>
            )
          })}
          <button className="chip" style={{ marginTop: 6 }} onClick={() => setR({ ...r, steps: [...r.steps, { type: 'app', target: '' }] })}>
            + Adicionar passo
          </button>
          {hasShell && (
            <div className="warn" style={{ margin: '10px 0 0' }}>
              ⚠ Comandos de terminal rodam com o seu usuário, sem confirmação, toda vez que a rotina for executada.
            </div>
          )}
        </div>
        <datalist id="jarvis-apps">
          {apps.map((a) => (
            <option key={a.path} value={a.name} />
          ))}
        </datalist>
        <datalist id="jarvis-shortcuts">
          {shortcuts.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </div>
      <div className="foot editor-foot">
        {!isNew && (
          <button className="btn danger" onClick={() => (confirmDel ? onDelete(r.id) : setConfirmDel(true))}>
            {confirmDel ? 'Confirmar exclusão' : 'Excluir'}
          </button>
        )}
        <span style={{ flex: 1 }} />
        {!isNew && <button className="btn" onClick={() => onRun(final())}>▶ Rodar</button>}
        <button className="btn primary" disabled={!r.name.trim() || !r.steps.length} onClick={() => onSave(final())}>Salvar</button>
      </div>
    </section>
  )
}
