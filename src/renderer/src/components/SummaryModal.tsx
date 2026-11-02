import { useEffect, useState } from 'react'
import type { SessionInfo, SessionSummary } from '@shared/types'
import { Markdown } from './Markdown'
import { Overlay } from './Overlay'

interface Props {
  session: SessionInfo
  onClose: () => void
  /** Abre uma sessão nova na mesma pasta, começando pelo resumo. */
  onContinue: (text: string) => void
}

/** Resumo de passagem: o que foi feito, decisões, estado e próximos passos de uma sessão. */
export function SummaryModal({ session, onClose, onContinue }: Props): React.JSX.Element {
  const [summary, setSummary] = useState<SessionSummary | null>(null)
  const [count, setCount] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [copied, setCopied] = useState(false)

  async function generate(): Promise<void> {
    setBusy(true)
    setError(null)
    const r = await window.jarvis.summaryGenerate(session.id)
    setBusy(false)
    if (r.ok && r.summary) {
      setSummary(r.summary)
      setCount(r.summary.messageCount)
    } else setError(r.error ?? 'Falhou.')
  }

  useEffect(() => {
    void window.jarvis.summaryGet(session.id).then((r) => {
      setSummary(r.summary)
      setCount(r.messageCount)
      setLoaded(true)
      if (r.running) void generate()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id])

  const stale = summary && count > summary.messageCount

  return (
    <Overlay onClose={onClose}>
      <div className="panel modal summary-modal">
        <div className="panel-header">
          Resumo de passagem
          <span className="count">
            {summary ? `${new Date(summary.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` : ''}
          </span>
        </div>
        <div className="body summary-body">
          <div className="summary-title">{session.title}</div>
          {error && <div className="warn" style={{ margin: 0 }}>✕ {error}</div>}
          {busy && (
            <div className="summary-busy">
              <span className="live-dot" /> Lendo a conversa e escrevendo o resumo… (pode levar até um minuto)
            </div>
          )}
          {!busy && summary && (
            <>
              {stale && (
                <div className="warn" style={{ margin: 0 }}>
                  A sessão teve {count - summary.messageCount} mensagens novas depois deste resumo.
                </div>
              )}
              <div className="summary-text">
                <Markdown text={summary.text} />
              </div>
            </>
          )}
          {!busy && loaded && !summary && !error && (
            <p className="summary-intro">
              Gera um resumo com o objetivo, o que foi feito, as decisões, o estado atual e os próximos passos desta sessão.
              Serve para continuar o trabalho numa sessão nova e limpa, sem arrastar o contexto inteiro, e fica disponível para
              outras sessões pela ferramenta <code>ler_conversa</code>.
            </p>
          )}
        </div>
        <div className="foot">
          <button className="btn ghost left" onClick={onClose}>Fechar</button>
          {summary && !busy && (
            <button
              className="btn"
              onClick={() => {
                void navigator.clipboard.writeText(summary.text)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              }}
            >
              {copied ? '✓ Copiado' : '⧉ Copiar'}
            </button>
          )}
          <button className="btn" disabled={busy} onClick={() => void generate()}>
            {summary ? '↻ Gerar de novo' : '✦ Gerar resumo'}
          </button>
          {summary && !busy && (
            <button
              className="btn primary"
              onClick={() =>
                onContinue(
                  `Estou continuando o trabalho da sessão anterior "${session.title}". Resumo de passagem:\n\n${summary.text}\n\n` +
                    'Antes de mudar qualquer coisa, confira o estado atual do código e me diga em poucas linhas o que entendeu e qual é o próximo passo.'
                )
              }
            >
              ▶ Continuar em nova sessão
            </button>
          )}
        </div>
      </div>
    </Overlay>
  )
}
