import { useEffect, useRef, useState } from 'react'
import type { TranscriptMessage } from '@shared/types'

export function Transcript({ sessionId, version }: { sessionId: string; version: number }): React.JSX.Element {
  const [msgs, setMsgs] = useState<TranscriptMessage[] | null>(null)
  const [showTools, setShowTools] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)
  const prevSession = useRef<string | null>(null)

  useEffect(() => {
    let alive = true
    const switched = prevSession.current !== sessionId
    prevSession.current = sessionId
    if (switched) setMsgs(null)
    window.jarvis.getTranscript(sessionId).then((m) => {
      if (!alive) return
      setMsgs(m)
      if (switched) requestAnimationFrame(() => bottom.current?.scrollIntoView())
    })
    return () => {
      alive = false
    }
  }, [sessionId, version])

  if (!msgs) return <div className="empty">Carregando transcrição…</div>
  if (!msgs.length) return <div className="empty">Transcrição vazia ou indisponível</div>

  return (
    <div className="transcript">
      <div className="load-note" style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
        Exibindo as últimas {msgs.length} mensagens
        <button className={`chip${showTools ? ' on' : ''}`} onClick={() => setShowTools((v) => !v)}>
          Ferramentas
        </button>
      </div>
      {msgs.map((m) => (
        <Message key={m.uuid} m={m} showTools={showTools} />
      ))}
      <div ref={bottom} />
    </div>
  )
}

function Message({ m, showTools }: { m: TranscriptMessage; showTools: boolean }): React.JSX.Element | null {
  if (m.role === 'system') return <div className="msg system">{m.blocks[0]?.kind === 'text' ? m.blocks[0].text.toUpperCase() : ''}</div>
  const visible = m.blocks.filter((b) => showTools || b.kind === 'text')
  if (!visible.length) return null
  const time = m.timestamp ? new Date(m.timestamp).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''
  return (
    <div className={`msg ${m.role}`}>
      <div className="who">
        {m.role === 'user' ? '▸ VOCÊ' : '◆ CLAUDE'}
        <time>{time}</time>
      </div>
      {visible.map((b, i) => {
        switch (b.kind) {
          case 'text':
            return <div key={i} className="text">{b.text}</div>
          case 'thinking':
            return <div key={i} className="thinking">{b.text}</div>
          case 'tool_use':
            return <div key={i} className="tool"><b>{b.name}</b>{b.input}</div>
          case 'tool_result':
            return <div key={i} className={`tool${b.isError ? ' err' : ''}`}><b>↳</b>{b.text.split('\n')[0]}</div>
        }
      })}
    </div>
  )
}
