import { useEffect, useState } from 'react'
import { useChatGlobal } from '../chatStore'

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
      <button className="btn ghost sm search-btn" onClick={() => window.jarvis.showPalette()} title="Busca rápida">
        ⌕ Busca rápida <span>{window.jarvis.shortcutLabel}</span>
      </button>
      <div className="spacer" />
      <UsageStat />
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

const LIMIT_LABEL: Record<string, string> = {
  five_hour: 'Limite 5h',
  seven_day: 'Limite semanal',
  seven_day_opus: 'Semanal Opus',
  seven_day_sonnet: 'Semanal Sonnet',
  overage: 'Uso extra'
}

/** Limite de uso do plano do Claude, informado pelo próprio CLI a cada turno. */
function UsageStat(): React.JSX.Element | null {
  const { rateLimit: r, account } = useChatGlobal()
  if (!r) return null
  const pct = r.utilization === undefined ? undefined : Math.round(r.utilization <= 1 ? r.utilization * 100 : r.utilization)
  const resets = r.resetsAt ? new Date(r.resetsAt * (r.resetsAt < 1e12 ? 1000 : 1)) : undefined
  const tip = [
    account?.subscriptionType && `Plano: ${account.subscriptionType}`,
    resets && `Renova ${resets.toLocaleString('pt-BR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <>
      <div className={`stat usage ${r.status}`} title={tip}>
        <b>{pct !== undefined ? `${pct}%` : r.status === 'rejected' ? 'LIM' : 'OK'}</b>
        <span>{LIMIT_LABEL[r.type ?? ''] ?? 'Uso do plano'}</span>
      </div>
      <div className="divider-v" />
    </>
  )
}
