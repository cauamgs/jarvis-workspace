import { useState } from 'react'
import type { TranscriptBlock, TranscriptMessage } from '@shared/types'
import { Markdown } from './Markdown'

type ToolUse = Extract<TranscriptBlock, { kind: 'tool_use' }>
type ToolResult = Extract<TranscriptBlock, { kind: 'tool_result' }>

interface Props {
  tool: ToolUse
  result?: ToolResult
  /** O turno ainda está rodando (ferramenta sem resultado = em execução). */
  running: boolean
  subagent?: TranscriptMessage[]
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v === undefined ? '' : JSON.stringify(v, null, 2))
const base = (p: string): string => p.split('/').pop() || p

/** Ícone, rótulo e resumo de cada ferramenta conhecida. */
function describe(t: ToolUse): { icon: string; label: string; summary: string } {
  const r = t.raw ?? {}
  if (t.name.startsWith('mcp__')) {
    const [, server, ...rest] = t.name.split('__')
    return { icon: '⚙', label: `${server.replace(/_/g, ' ')} · ${rest.join('__')}`, summary: t.input }
  }
  switch (t.name) {
    case 'Bash':
      return { icon: '❯', label: 'Terminal', summary: str(r.description) || str(r.command) }
    case 'Monitor':
      return { icon: '◔', label: 'Monitor', summary: str(r.description) || str(r.command) }
    case 'Edit':
    case 'MultiEdit':
      return { icon: '✎', label: 'Editar', summary: base(str(r.file_path)) }
    case 'Write':
      return { icon: '✚', label: 'Criar arquivo', summary: base(str(r.file_path)) }
    case 'Read':
      return { icon: '◉', label: 'Ler', summary: base(str(r.file_path)) }
    case 'NotebookEdit':
      return { icon: '✎', label: 'Notebook', summary: base(str(r.notebook_path)) }
    case 'Grep':
      return { icon: '⌕', label: 'Buscar texto', summary: str(r.pattern) }
    case 'Glob':
      return { icon: '⌕', label: 'Buscar arquivos', summary: str(r.pattern) }
    case 'WebFetch':
      return { icon: '◍', label: 'Abrir página', summary: str(r.url) }
    case 'WebSearch':
      return { icon: '◍', label: 'Pesquisar na web', summary: str(r.query) }
    case 'Agent':
    case 'Task':
      return { icon: '◈', label: `Subagente${r.subagent_type ? ` · ${str(r.subagent_type)}` : ''}`, summary: str(r.description) }
    case 'Skill':
      return { icon: '✦', label: 'Skill', summary: str(r.skill) }
    case 'TaskCreate':
      return { icon: '☐', label: 'Nova tarefa', summary: str(r.subject) }
    case 'TaskUpdate':
      return { icon: '☑', label: 'Tarefa', summary: `#${str(r.taskId)} → ${statusLabel(str(r.status))}` }
    case 'TodoWrite':
      return { icon: '☑', label: 'Plano', summary: `${Array.isArray(r.todos) ? r.todos.length : 0} itens` }
    case 'AskUserQuestion':
      return { icon: '?', label: 'Pergunta', summary: '' }
    case 'ExitPlanMode':
      return { icon: '▤', label: 'Plano', summary: 'pronto para revisão' }
    case 'ToolSearch':
      return { icon: '⌕', label: 'Carregar ferramentas', summary: str(r.query) }
    default:
      return { icon: '▸', label: t.name, summary: t.input }
  }
}

export function statusLabel(s: string): string {
  return { pending: 'pendente', in_progress: 'em andamento', completed: 'concluída', deleted: 'removida' }[s] ?? s
}

/** Ferramentas de "bastidor" que viram uma linha discreta (o painel de plano já mostra o essencial). */
const QUIET = new Set(['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TodoWrite', 'ToolSearch', 'AskUserQuestion', 'ExitPlanMode'])

export function ToolCard({ tool, result, running, subagent }: Props): React.JSX.Element {
  const d = describe(tool)
  const diff = tool.name === 'Edit' ? lineDiff(str(tool.raw?.old_string), str(tool.raw?.new_string)) : null
  const [open, setOpen] = useState(() => (diff ? diff.length <= 24 : false) || !!result?.isError)
  const status = result ? (result.isError ? 'err' : 'ok') : running ? 'run' : 'stop'

  if (QUIET.has(tool.name)) {
    return (
      <div className={`tool-line ${status}`}>
        <span className="tl-icon">{d.icon}</span>
        <span className="tl-label">{d.label}</span>
        <span className="tl-sum">{d.summary}</span>
      </div>
    )
  }

  const stats = diff && {
    add: diff.filter((l) => l.t === '+').length,
    del: diff.filter((l) => l.t === '-').length
  }

  return (
    <div className={`tcard ${status}`}>
      <button className="tc-head" onClick={() => setOpen((o) => !o)}>
        <span className="tc-icon">{d.icon}</span>
        <span className="tc-label">{d.label}</span>
        <span className="tc-sum">{d.summary}</span>
        {stats && (
          <span className="tc-stats">
            <i className="add">+{stats.add}</i> <i className="del">−{stats.del}</i>
          </span>
        )}
        <span className={`tc-status ${status}`}>
          {status === 'run' ? <span className="pulse-ring sm" /> : status === 'ok' ? '✓' : status === 'err' ? '✕' : '—'}
        </span>
        <span className="tc-caret">{open ? '▾' : '▸'}</span>
      </button>
      {(open || (subagent && status === 'run')) && (
        <div className="tc-body">
          <ToolBody tool={tool} result={result} diff={diff} subagent={subagent} open={open} />
        </div>
      )}
    </div>
  )
}

function ToolBody({
  tool,
  result,
  diff,
  subagent,
  open
}: {
  tool: ToolUse
  result?: ToolResult
  diff: DiffLine[] | null
  subagent?: TranscriptMessage[]
  open: boolean
}): React.JSX.Element {
  const r = tool.raw ?? {}
  const out = result?.text ?? ''
  const path = str(r.file_path)

  switch (tool.name) {
    case 'Bash':
    case 'Monitor':
      return (
        <>
          <pre className="tc-cmd">$ {str(r.command)}</pre>
          {out && <pre className={`tc-out${result?.isError ? ' err' : ''}`}>{clip(out, 200)}</pre>}
        </>
      )
    case 'Edit':
      return (
        <>
          <div className="tc-path" title={path}>{path}</div>
          <DiffView lines={diff ?? []} />
          {result?.isError && <pre className="tc-out err">{out}</pre>}
        </>
      )
    case 'MultiEdit':
      return (
        <>
          <div className="tc-path" title={path}>{path}</div>
          {(Array.isArray(r.edits) ? r.edits : []).map((e: Record<string, unknown>, i: number) => (
            <DiffView key={i} lines={lineDiff(str(e.old_string), str(e.new_string))} />
          ))}
        </>
      )
    case 'Write':
      return (
        <>
          <div className="tc-path" title={path}>{path}</div>
          <pre className="tc-out file">{clip(str(r.content), 80)}</pre>
        </>
      )
    case 'Agent':
    case 'Task':
      return (
        <>
          {subagent && subagent.length > 0 && <SubagentActivity messages={subagent} live={!result} />}
          {open && r.prompt !== undefined && (
            <details className="tc-details">
              <summary>Instruções para o subagente</summary>
              <div className="md-small"><Markdown text={str(r.prompt)} /></div>
            </details>
          )}
          {open && out && (
            <div className="tc-result md-small">
              <Markdown text={clip(out, 400)} />
            </div>
          )}
        </>
      )
    case 'Read':
    case 'Grep':
    case 'Glob':
    case 'WebFetch':
    case 'WebSearch':
      return (
        <>
          {path && <div className="tc-path" title={path}>{path}</div>}
          {out && <pre className={`tc-out${result?.isError ? ' err' : ''}`}>{clip(out, 60)}</pre>}
        </>
      )
    default:
      return (
        <>
          <pre className="tc-cmd">{clip(JSON.stringify(r, null, 2), 60)}</pre>
          {out && <pre className={`tc-out${result?.isError ? ' err' : ''}`}>{clip(out, 80)}</pre>}
        </>
      )
  }
}

function SubagentActivity({ messages, live }: { messages: TranscriptMessage[]; live: boolean }): React.JSX.Element {
  const steps = messages.flatMap((m) =>
    m.blocks.flatMap((b) =>
      b.kind === 'tool_use'
        ? [{ k: `${m.uuid}-${b.id}`, icon: '▸', text: `${b.name} ${b.input}` }]
        : b.kind === 'text' && b.text.trim()
          ? [{ k: `${m.uuid}-t`, icon: '◆', text: b.text.trim().split('\n')[0] }]
          : []
    )
  )
  const shown = steps.slice(-8)
  return (
    <div className="subagent">
      <div className="sa-head">
        {live && <span className="pulse-ring sm" />} ATIVIDADE DO SUBAGENTE · {steps.length} passos
      </div>
      {shown.map((s) => (
        <div key={s.k} className="sa-step">
          <b>{s.icon}</b> {s.text}
        </div>
      ))}
    </div>
  )
}

function clip(text: string, maxLines: number): string {
  const lines = text.split('\n')
  return lines.length > maxLines ? lines.slice(0, maxLines).join('\n') + `\n… (+${lines.length - maxLines} linhas)` : text
}

// ---------- diff de linhas (LCS) ----------

interface DiffLine {
  t: ' ' | '+' | '-'
  s: string
}

function lineDiff(a: string, b: string): DiffLine[] {
  const x = a.split('\n')
  const y = b.split('\n')
  // Entradas enormes: mostra remoção + adição sem alinhar (LCS é O(n·m)).
  if (x.length * y.length > 250_000)
    return [...x.map((s) => ({ t: '-' as const, s })), ...y.map((s) => ({ t: '+' as const, s }))]
  const n = x.length
  const m = y.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      out.push({ t: ' ', s: x[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ t: '-', s: x[i++] })
    else out.push({ t: '+', s: y[j++] })
  }
  while (i < n) out.push({ t: '-', s: x[i++] })
  while (j < m) out.push({ t: '+', s: y[j++] })
  return out
}

function DiffView({ lines }: { lines: DiffLine[] }): React.JSX.Element {
  const shown = lines.slice(0, 300)
  return (
    <pre className="diff">
      {shown.map((l, i) => (
        <div key={i} className={l.t === '+' ? 'add' : l.t === '-' ? 'del' : 'ctx'}>
          <span className="sign">{l.t}</span>
          {l.s || ' '}
        </div>
      ))}
      {lines.length > shown.length && <div className="ctx">… (+{lines.length - shown.length} linhas)</div>}
    </pre>
  )
}
