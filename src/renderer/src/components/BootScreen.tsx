import { useEffect, useState } from 'react'
import { ArcReactor } from './ArcReactor'

const STEPS = [
  'INICIALIZANDO NÚCLEO',
  'CONECTANDO AO CLAUDE CODE',
  'INDEXANDO SESSÕES',
  'CARREGANDO WORKSPACES',
  'SISTEMAS ONLINE'
]

/** Sequência de boot — some quando `ready` e a animação mínima terminam. */
export function BootScreen({ ready }: { ready: boolean }): React.JSX.Element | null {
  const [step, setStep] = useState(0)
  const [gone, setGone] = useState(false)
  const last = STEPS.length - 1
  const done = ready && step >= last

  useEffect(() => {
    if (step >= last) return
    // Segura no passo de indexação até os dados chegarem.
    if (step === 2 && !ready) return
    const t = setTimeout(() => setStep((s) => s + 1), 320)
    return () => clearTimeout(t)
  }, [step, ready, last])

  useEffect(() => {
    if (!done) return
    const t = setTimeout(() => setGone(true), 900)
    return () => clearTimeout(t)
  }, [done])

  if (gone) return null
  return (
    <div className={`boot${done ? ' done' : ''}`}>
      <div className="inner">
        <ArcReactor size={150} />
        <h1>J.A.R.V.I.S.</h1>
        <div className="sub">JUST A RATHER VERY INTELLIGENT SYSTEM</div>
        <div className="bar">
          <i style={{ width: `${(step / last) * 100}%` }} />
        </div>
        <div className="log">{STEPS[step]}…</div>
      </div>
    </div>
  )
}
