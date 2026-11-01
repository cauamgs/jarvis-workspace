import { useState } from 'react'
import type { TranscriptBlock, TranscriptMessage } from '@shared/types'

type ToolResult = Extract<TranscriptBlock, { kind: 'tool_result' }>

export interface PlanItem {
  id: string
  subject: string
  status: string
  activeForm?: string
}

const s = (v: unknown): string => (typeof v === 'string' ? v : v === undefined ? '' : String(v))

/**
 * Reconstrói o plano de tarefas a partir das ferramentas usadas na conversa:
 * TodoWrite (lista completa) ou TaskCreate/TaskUpdate (incremental).
 */
export function derivePlan(messages: TranscriptMessage[], results: Map<string, ToolResult>): PlanItem[] {
  let items: PlanItem[] = []
  for (const m of messages) {
    for (const b of m.blocks) {
      if (b.kind !== 'tool_use' || !b.raw) continue
      const r = b.raw
      if (b.name === 'TodoWrite' && Array.isArray(r.todos)) {
        items = r.todos.map((t: Record<string, unknown>, i: number) => ({
          id: String(i),
          subject: s(t.content),
          status: s(t.status),
          activeForm: s(t.activeForm)
        }))
      } else if (b.name === 'TaskCreate') {
        const id = /#(\d+)/.exec(results.get(b.id)?.text ?? '')?.[1]
        if (id) items.push({ id, subject: s(r.subject), status: 'pending', activeForm: s(r.activeForm) })
      } else if (b.name === 'TaskUpdate') {
        const it = items.find((x) => x.id === s(r.taskId))
        if (!it) continue
        if (r.status === 'deleted') items = items.filter((x) => x !== it)
        else {
          if (r.status) it.status = s(r.status)
          if (r.subject) it.subject = s(r.subject)
          if (r.activeForm) it.activeForm = s(r.activeForm)
        }
      }
    }
  }
  return items
}

export function PlanPanel({ items }: { items: PlanItem[] }): React.JSX.Element | null {
  const done = items.filter((i) => i.status === 'completed').length
  // Plano concluído começa recolhido; em andamento, aberto.
  const [open, setOpen] = useState(done < items.length)
  if (!items.length) return null
  const current = items.find((i) => i.status === 'in_progress')
  return (
    <div className={`plan-panel${done === items.length ? ' complete' : ''}`}>
      <button className="pp-head" onClick={() => setOpen((o) => !o)}>
        <span className="pp-title">PLANO</span>
        <span className="pp-bar"><i style={{ width: `${(done / items.length) * 100}%` }} /></span>
        <span className="pp-count">{done}/{items.length}</span>
        {current && !open && <span className="pp-current">{current.activeForm || current.subject}</span>}
        <span className="tc-caret">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="pp-list">
          {items.map((i) => (
            <div key={i.id} className={`pp-item ${i.status}`}>
              <span className="pp-mark">{i.status === 'completed' ? '✓' : i.status === 'in_progress' ? '◉' : '○'}</span>
              <span>{i.status === 'in_progress' && i.activeForm ? i.activeForm : i.subject}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
