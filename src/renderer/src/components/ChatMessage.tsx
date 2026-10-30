import { memo } from 'react'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import type { TranscriptMessage } from '@shared/types'

marked.setOptions({ gfm: true, breaks: false })
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

export function Markdown({ text }: { text: string }): React.JSX.Element {
  const html = DOMPurify.sanitize(marked.parse(text, { async: false }) as string)
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />
}

interface Props {
  m: TranscriptMessage
  showDetails: boolean
}

/** Uma mensagem da conversa — usada tanto no histórico quanto nas mensagens ao vivo. */
export const ChatMessage = memo(function ChatMessage({ m, showDetails }: Props): React.JSX.Element | null {
  if (m.role === 'system') {
    const t = m.blocks[0]?.kind === 'text' ? m.blocks[0].text : ''
    return <div className="msg system">{t.toUpperCase()}</div>
  }
  const visible = m.blocks.filter(
    (b) =>
      b.kind === 'text' ||
      (b.kind === 'tool_use') ||
      (b.kind === 'tool_result' && (showDetails || b.isError)) ||
      (b.kind === 'thinking' && showDetails && b.text)
  )
  if (!visible.length) return null
  // Mensagens "user" que só carregam resultados de ferramentas não são falas do usuário.
  const onlyTools = visible.every((b) => b.kind === 'tool_result')
  const role = m.role === 'user' && !onlyTools ? 'user' : 'assistant'
  const time = m.timestamp ? new Date(m.timestamp).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''
  return (
    <div className={`msg ${role}${onlyTools ? ' tools-only' : ''}`}>
      {!onlyTools && (
        <div className="who">
          {role === 'user' ? '▸ VOCÊ' : '◆ CLAUDE'}
          <time>{time}</time>
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
})
