export type ModuleId = 'sessions' | 'system'

const MODULES: { id: ModuleId | 'projects'; icon: string; label: string; soon?: boolean }[] = [
  { id: 'sessions', icon: '◈', label: 'Sessões' },
  { id: 'system', icon: '◔', label: 'Sistema' },
  { id: 'projects', icon: '⎇', label: 'Projetos', soon: true }
]

/** Barra vertical de módulos do Jarvis — cada ferramenta nova ganha um ícone aqui. */
export function ModuleRail({ active, onChange }: { active: ModuleId; onChange: (m: ModuleId) => void }): React.JSX.Element {
  return (
    <nav className="rail">
      {MODULES.map((m) => (
        <button
          key={m.id}
          className={`rail-btn${active === m.id ? ' on' : ''}`}
          disabled={m.soon}
          title={m.soon ? `${m.label} (em breve)` : m.label}
          onClick={() => !m.soon && onChange(m.id as ModuleId)}
        >
          <span className="rail-icon">{m.icon}</span>
          <span className="rail-label">{m.label}</span>
        </button>
      ))}
    </nav>
  )
}
