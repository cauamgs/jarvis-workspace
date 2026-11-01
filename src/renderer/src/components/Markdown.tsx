import { memo } from 'react'
import DOMPurify from 'dompurify'
import { marked } from 'marked'

marked.setOptions({ gfm: true, breaks: false })
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

/** Markdown sanitizado (respostas do Claude, planos, resultados de subagentes). */
export const Markdown = memo(function Markdown({ text }: { text: string }): React.JSX.Element {
  const html = DOMPurify.sanitize(marked.parse(text, { async: false }) as string)
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />
})
