/**
 * Reator arc animado — a "assinatura" visual do Jarvis.
 * Cada anel é uma camada HTML própria que gira inteira: a GPU só move uma textura pronta.
 * (Girar elementos dentro de um único SVG obrigava o navegador a redesenhá-lo a cada quadro.)
 */
export function ArcReactor({ size = 56 }: { size?: number }): React.JSX.Element {
  const ticks = Array.from({ length: 36 }, (_, i) => i * 10)
  const segs = Array.from({ length: 10 }, (_, i) => i * 36)
  const layer = (cls: string, children: React.ReactNode): React.JSX.Element => (
    <div className={`reactor-layer ${cls}`}>
      <svg viewBox="0 0 100 100" fill="none" stroke="#00e5ff">
        {children}
      </svg>
    </div>
  )
  return (
    <div className="reactor" style={{ width: size, height: size }}>
      {layer(
        'spin',
        ticks.map((a) => (
          <line
            key={a}
            x1="50"
            y1="3"
            x2="50"
            y2={a % 30 === 0 ? 9 : 6}
            strokeWidth={a % 30 === 0 ? 1.4 : 0.7}
            opacity={0.75}
            transform={`rotate(${a} 50 50)`}
          />
        ))
      )}
      {layer(
        'spin-rev',
        segs.map((a) => (
          <path key={a} d="M50 14 A36 36 0 0 1 69 19.4" strokeWidth="3.2" opacity="0.85" transform={`rotate(${a} 50 50)`} />
        ))
      )}
      {layer('spin-fast', <circle cx="50" cy="50" r="27" strokeWidth="1" strokeDasharray="4 6" opacity="0.8" />)}
      {layer(
        'static',
        <>
          <circle cx="50" cy="50" r="40" strokeWidth="0.6" opacity="0.5" />
          <circle cx="50" cy="50" r="20" strokeWidth="1.6" />
          <polygon points="50,36 62,57 38,57" strokeWidth="1.4" opacity="0.9" />
        </>
      )}
      <div className="reactor-core" />
    </div>
  )
}
