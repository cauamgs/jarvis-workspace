import { useState } from 'react'
import type { ChatPermissionRequest, PermissionResponse } from '@shared/types'
import { Markdown } from './Markdown'

interface Props {
  request: ChatPermissionRequest
  onRespond: (r: PermissionResponse) => void
}

/** Cartão para cada pedido do Claude: permissão de ferramenta, pergunta ou aprovação de plano. */
export function PermissionCard({ request, onRespond }: Props): React.JSX.Element {
  if (request.kind === 'question') return <QuestionCard request={request} onRespond={onRespond} />
  if (request.kind === 'plan') return <PlanCard request={request} onRespond={onRespond} />
  return (
    <div className="perm">
      <div className="perm-title">⚠ {request.title}</div>
      {request.description && <div className="perm-desc">{request.description}</div>}
      <pre className="perm-detail">{request.detail}</pre>
      <div className="actions">
        <button className="btn primary" onClick={() => onRespond({ decision: 'allow' })}>Permitir</button>
        {request.canAlwaysAllow && (
          <button className="btn" onClick={() => onRespond({ decision: 'always' })}>Sempre permitir</button>
        )}
        <button className="btn danger" onClick={() => onRespond({ decision: 'deny' })}>Negar</button>
      </div>
    </div>
  )
}

const OTHER = '__other__'

function QuestionCard({ request, onRespond }: Props): React.JSX.Element {
  const questions = request.questions ?? []
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [other, setOther] = useState<Record<string, string>>({})

  const toggle = (q: string, label: string, multi: boolean): void =>
    setPicked((p) => {
      const cur = p[q] ?? []
      if (!multi) return { ...p, [q]: [label] }
      return { ...p, [q]: cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label] }
    })

  const answerFor = (q: string): string =>
    (picked[q] ?? [])
      .map((l) => (l === OTHER ? other[q]?.trim() : l))
      .filter(Boolean)
      .join(', ')

  const complete = questions.every((q) => answerFor(q.question))

  return (
    <div className="perm question">
      <div className="perm-title">? {request.title}</div>
      {questions.map((q) => (
        <div key={q.question} className="q-block">
          <div className="q-header">{q.header}</div>
          <div className="q-text">{q.question}</div>
          <div className="q-options">
            {q.options.map((o) => {
              const on = (picked[q.question] ?? []).includes(o.label)
              return (
                <button key={o.label} className={`q-opt${on ? ' on' : ''}`} onClick={() => toggle(q.question, o.label, q.multiSelect)}>
                  <span className="q-mark">{q.multiSelect ? (on ? '☑' : '☐') : on ? '◉' : '○'}</span>
                  <span>
                    <b>{o.label}</b>
                    {o.description && <small>{o.description}</small>}
                  </span>
                </button>
              )
            })}
            <div className={`q-opt other${(picked[q.question] ?? []).includes(OTHER) ? ' on' : ''}`}>
              <span className="q-mark" onClick={() => toggle(q.question, OTHER, q.multiSelect)}>
                {(picked[q.question] ?? []).includes(OTHER) ? '◉' : '○'}
              </span>
              <input
                className="input"
                placeholder="Outra resposta…"
                value={other[q.question] ?? ''}
                onFocus={() => !(picked[q.question] ?? []).includes(OTHER) && toggle(q.question, OTHER, q.multiSelect)}
                onChange={(e) => setOther((o) => ({ ...o, [q.question]: e.target.value }))}
              />
            </div>
          </div>
        </div>
      ))}
      <div className="actions">
        <button
          className="btn primary"
          disabled={!complete}
          onClick={() =>
            onRespond({
              decision: 'allow',
              answers: Object.fromEntries(questions.map((q) => [q.question, answerFor(q.question)]))
            })
          }
        >
          Responder
        </button>
        <button className="btn ghost" onClick={() => onRespond({ decision: 'deny', message: 'O usuário preferiu responder no chat.' })}>
          Responder no chat
        </button>
      </div>
    </div>
  )
}

function PlanCard({ request, onRespond }: Props): React.JSX.Element {
  const [feedback, setFeedback] = useState('')
  const [revising, setRevising] = useState(false)
  return (
    <div className="perm plan">
      <div className="perm-title">▤ {request.title}</div>
      {request.plan ? (
        <div className="plan-body"><Markdown text={request.plan} /></div>
      ) : (
        <div className="perm-desc">O plano está descrito na conversa acima.</div>
      )}
      {revising ? (
        <>
          <textarea
            className="input"
            rows={3}
            autoFocus
            placeholder="O que deve mudar no plano?"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
          />
          <div className="actions">
            <button
              className="btn primary"
              disabled={!feedback.trim()}
              onClick={() => onRespond({ decision: 'deny', message: `Continue planejando. Ajustes pedidos: ${feedback.trim()}` })}
            >
              Enviar ajustes
            </button>
            <button className="btn ghost" onClick={() => setRevising(false)}>Voltar</button>
          </div>
        </>
      ) : (
        <div className="actions">
          <button className="btn primary" onClick={() => onRespond({ decision: 'allow', mode: 'acceptEdits' })}>
            Aprovar · aceitar edições
          </button>
          <button className="btn" onClick={() => onRespond({ decision: 'allow', mode: 'default' })}>
            Aprovar · perguntar a cada edição
          </button>
          <button className="btn ghost" onClick={() => setRevising(true)}>Continuar planejando</button>
        </div>
      )}
    </div>
  )
}
