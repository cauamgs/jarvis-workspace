import { useState } from 'react'

export type Level = 'ok' | 'warn' | 'crit'

export function levelOf(pct: number, warn = 70, crit = 90): Level {
  return pct >= crit ? 'crit' : pct >= warn ? 'warn' : 'ok'
}

const LEVEL_LABEL: Record<Level, string> = { ok: 'NORMAL', warn: 'ALTO', crit: 'CRÍTICO' }

interface GaugeProps {
  label: string
  /** 0–100 */
  value: number
  display: string
  sub?: string
  level?: Level
}

/** Medidor circular estilo HUD: arco de 270°, valor no centro, estado com rótulo (nunca só cor). */
export function RingGauge({ label, value, display, sub, level = 'ok' }: GaugeProps): React.JSX.Element {
  const r = 52
  const c = 2 * Math.PI * r
  const arc = c * 0.75
  const filled = arc * Math.min(1, Math.max(0, value / 100))
  const ticks = Array.from({ length: 28 }, (_, i) => -135 + (i * 270) / 27)
  return (
    <div className={`gauge ${level}`}>
      <svg viewBox="0 0 140 140" role="img" aria-label={`${label}: ${display}`}>
        <g transform="rotate(135 70 70)">
          <circle cx="70" cy="70" r={r} className="g-track" strokeDasharray={`${arc} ${c}`} />
          <circle cx="70" cy="70" r={r} className="g-fill" strokeDasharray={`${filled} ${c}`} />
        </g>
        {ticks.map((a, i) => (
          <line
            key={i}
            x1="70"
            y1="6"
            x2="70"
            y2={i % 3 === 0 ? 12 : 9}
            className="g-tick"
            transform={`rotate(${a} 70 70)`}
          />
        ))}
        <text x="70" y="72" className="g-value">{display}</text>
        <text x="70" y="92" className="g-sub">{sub}</text>
      </svg>
      <div className="g-label">
        {label}
        {level !== 'ok' && <span className={`g-state ${level}`}>{level === 'crit' ? '▲' : '△'} {LEVEL_LABEL[level]}</span>}
      </div>
    </div>
  )
}

interface SparkProps {
  values: number[]
  /** Escala fixa (ex.: 100 para %); sem ela, usa o máximo da série. */
  max?: number
  format: (v: number) => string
  height?: number
}

/** Linha do tempo das últimas amostras com cursor e valor ao passar o mouse. */
export function Sparkline({ values, max, format, height = 46 }: SparkProps): React.JSX.Element {
  const [hover, setHover] = useState<number | null>(null)
  const w = 240
  const top = Math.max(max ?? 0, ...values, 1)
  const pts = values.map((v, i) => [values.length < 2 ? w : (i / (values.length - 1)) * w, height - 3 - (v / top) * (height - 8)])
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  const area = pts.length ? `${line} L${w},${height} L0,${height} Z` : ''
  const hv = hover !== null ? values[hover] : undefined
  return (
    <div className="spark" onMouseLeave={() => setHover(null)}>
      <svg
        viewBox={`0 0 ${w} ${height}`}
        preserveAspectRatio="none"
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const i = Math.round(((e.clientX - rect.left) / rect.width) * (values.length - 1))
          setHover(Math.min(values.length - 1, Math.max(0, i)))
        }}
      >
        <line x1="0" y1={height - 1} x2={w} y2={height - 1} className="s-base" />
        {area && <path d={area} className="s-area" />}
        {line && <path d={line} className="s-line" vectorEffect="non-scaling-stroke" />}
        {hover !== null && pts[hover] && (
          <line x1={pts[hover][0]} y1="0" x2={pts[hover][0]} y2={height} className="s-cursor" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      {hv !== undefined && (
        <div className="s-tip" style={{ left: `${(hover! / Math.max(1, values.length - 1)) * 100}%` }}>
          {format(hv)}
          <small>há {(values.length - 1 - hover!) * 2}s</small>
        </div>
      )}
    </div>
  )
}

export function fmtBytes(n: number, digits = 1): string {
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(i === 0 ? 0 : digits)} ${u[i]}`
}

export function fmtRate(n: number): string {
  return `${fmtBytes(n)}/s`
}
