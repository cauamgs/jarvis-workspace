import { memo } from 'react'
import type { TranscriptBlock, TranscriptMessage } from '@shared/types'
import { Markdown } from './Markdown'
import { ToolCard } from './ToolCard'

export { Markdown }

type ToolResult = Extract<TranscriptBlock, { kind: 'tool_result' }>

interface Props {
  m: TranscriptMessage
  showDetails: boolean
  /** Resultados de ferramentas da conversa, por id do tool_use. */
  results: Map<string, ToolResult>
  running: boolean
  subagents: Record<string, TranscriptMessage[]>
  onFork?: (uuid: string) => void
  onRewind?: (uuid: string) => void
}

/** Uma mensagem da conversa — usada tanto no histórico quanto nas mensagens ao vivo. */
export const ChatMessage = memo(function ChatMessage(p: Props): React.JSX.Element | null {
  const { m, showDetails, results } = p
  if (m.role === 'system') {
    const t = m.blocks[0]?.kind === 'text' ? m.blocks[0].text : ''
    return <div className="msg system">{t.toUpperCase()}</div>
  }
  const visible = m.blocks.filter(
    (b) =>
      b.kind === 'text' ||
      b.kind === 'tool_use' ||
      b.kind === 'image' ||
      // Resultados aparecem dentro do cartão da ferramenta; avulsos só se forem erro.
      (b.kind === 'tool_result' && !results.has(b.toolUseId) && b.isError) ||
      (b.kind === 'thinking' && showDetails && b.text)
  )
  if (!visible.length) return null
  const isUser = m.role === 'user' && visible.some((b) => b.kind === 'text' || b.kind === 'image')
  const role = isUser ? 'user' : 'assistant'
  const hasText = visible.some((b) => b.kind === 'text')
  const time = m.timestamp ? new Date(m.timestamp).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''
  const copy = (): void => {
    const text = m.blocks.flatMap((b) => (b.kind === 'text' ? [b.text] : [])).join('\n\n')
    void navigator.clipboard.writeText(text)
  }

  return (
    <div className={`msg ${role}`}>
      {hasText && (
        <div className="who">
          {role === 'user' ? '▸ VOCÊ' : '◆ CLAUDE'}
          <time>{time}</time>
          <span className="msg-actions">
            <button onClick={copy} title="Copiar texto">⧉</button>
            {p.onFork && (
              <button onClick={() => p.onFork!(m.uuid)} title="Ramificar: nova sessão com a conversa até aqui">
                ⑂ Ramificar
              </button>
            )}
            {isUser && p.onRewind && (
              <button onClick={() => p.onRewind!(m.uuid)} title="Desfazer as alterações de arquivos feitas depois desta mensagem">
                ↺ Restaurar arquivos
              </button>
            )}
          </span>
        </div>
      )}
      {visible.map((b, i) => {
        switch (b.kind) {
          case 'text':
            return role === 'user' ? (
              <div key={i} className="text">{b.text}</div>
            ) : (
              <div key={i} className="text"><Markdown text={b.text} /></div>
            )
          case 'image':
            return b.data ? (
              <img key={i} className="msg-image" src={`data:${b.mediaType};base64,${b.data}`} alt="Imagem anexada" />
            ) : (
              <div key={i} className="tool">[imagem]</div>
            )
          case 'thinking':
            return <div key={i} className="thinking">{b.text}</div>
          case 'tool_use':
            return (
              <ToolCard
                key={b.id || i}
                tool={b}
                result={results.get(b.id)}
                running={p.running}
                subagent={p.subagents[b.id]}
              />
            )
          case 'tool_result':
            return <div key={i} className="tool err"><b>↳</b>{b.text.split('\n')[0]}</div>
        }
      })}
    </div>
  )
})
