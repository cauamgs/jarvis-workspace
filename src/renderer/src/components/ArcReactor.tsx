/** Reator arc animado — a "assinatura" visual do Jarvis. */
export function ArcReactor({ size = 56 }: { size?: number }): React.JSX.Element {
  const ticks = Array.from({ length: 36 }, (_, i) => i * 10)
  const segs = Array.from({ length: 10 }, (_, i) => i * 36)
  return (
    <svg className="reactor" width={size} height={size} viewBox="0 0 100 100">
      <defs>
        <radialGradient id="rc-core">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="35%" stopColor="#9ff8ff" />
          <stop offset="100%" stopColor="#00e5ff" stopOpacity="0" />
        </radialGradient>
        <filter id="rc-glow">
          <feGaussianBlur stdDeviation="1.4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g filter="url(#rc-glow)" fill="none" stroke="#00e5ff">
        <g className="spin">
          {ticks.map((a) => (
            <line
              key={a}
              x1="50" y1="3" x2="50" y2={a % 30 === 0 ? 9 : 6}
              strokeWidth={a % 30 === 0 ? 1.4 : 0.7}
              opacity={0.75}
              transform={`rotate(${a} 50 50)`}
            />
          ))}
        </g>
        <circle cx="50" cy="50" r="40" strokeWidth="0.6" opacity="0.5" />
        <g className="spin-rev">
          {segs.map((a) => (
            <path key={a} d="M50 14 A36 36 0 0 1 69 19.4" strokeWidth="3.2" opacity="0.85" transform={`rotate(${a} 50 50)`} />
          ))}
        </g>
        <g className="spin-fast">
          <circle cx="50" cy="50" r="27" strokeWidth="1" strokeDasharray="4 6" opacity="0.8" />
        </g>
        <circle cx="50" cy="50" r="20" strokeWidth="1.6" />
        <polygon points="50,36 62,57 38,57" strokeWidth="1.4" opacity="0.9" />
      </g>
      <circle className="core" cx="50" cy="50" r="16" fill="url(#rc-core)" />
    </svg>
  )
}
