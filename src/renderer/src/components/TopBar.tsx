import { useEffect, useState } from 'react'

interface Props {
  total: number
  live: number
  terminals: number
  workspaces: number
}

export function TopBar({ total, live, terminals, workspaces }: Props): React.JSX.Element {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <header className="topbar">
      <div className="brand">
        J.A.R.V.I.S.<small>WORKSPACE</small>
      </div>
      <div className="spacer" />
      <Stat label="Workspaces" value={workspaces} />
      <Stat label="Sessões" value={total} />
      <Stat label="Ativas" value={live} live />
      <Stat label="Terminais" value={terminals} />
      <div className="divider-v" />
      <div className="clock">
        {now.toLocaleTimeString('pt-BR')}
        <small>{now.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }).toUpperCase()}</small>
      </div>
    </header>
  )
}

function Stat({ label, value, live }: { label: string; value: number; live?: boolean }): React.JSX.Element {
  return (
    <div className={`stat${live ? ' live' : ''}`}>
      <b>{String(value).padStart(2, '0')}</b>
      <span>{label}</span>
    </div>
  )
}
