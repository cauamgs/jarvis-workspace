import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PermissionMode, SessionInfo, TranscriptMessage } from '@shared/types'
import { chatStore, useChat } from '../chatStore'
import { ChatMessage, Markdown } from './ChatMessage'

const MODES: { value: PermissionMode; label: string }[] = [
  { value: 'default', label: 'Perguntar sempre' },
  { value: 'acceptEdits', label: 'Aceitar edições' },
  { value: 'plan', label: 'Modo plano' },
  { value: 'auto', label: 'Automático' },
  { value: 'bypassPermissions', label: '⚠ Sem permissões' }
]

interface Props {
  session: SessionInfo
  /** Muda quando o índice de sessões é atualizado (transcript cresceu). */
  version: number
}

export function ChatView({ session: s, version }: Props): React.JSX.Element {
  const chat = useChat(s.id)
  const [history, setHistory] = useState<TranscriptMessage[] | null>(null)
  const [text, setText] = useState('')
  const [showDetails, setShowDetails] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const input = useRef<HTMLTextAreaElement>(null)
  const busy = chat.state === 'running' || chat.state === 'starting'

  useEffect(() => {
    let alive = true
    if (!s.filePath) {
      setHistory([])
      return
    }
    window.jarvis.getTranscript(s.id).then((m) => alive && setHistory(m))
    return () => {
      alive = false
    }
  }, [s.id, s.filePath, version])

  useEffect(() => {
    stick.current = true
    setSendError(null)
    input.current?.focus()
  }, [s.id])

  // Histórico do disco + mensagens ao vivo que o disco ainda não tem.
  const messages = useMemo(() => {
    const h = history ?? []
    const ids = new Set(h.map((m) => m.uuid))
    const recentUserTexts = new Set(
      h.slice(-50).filter((m) => m.role === 'user').map((m) => (m.blocks[0]?.kind === 'text' ? m.blocks[0].text : ''))
    )
    const live = chat.live.filter((m) => {
      if (ids.has(m.uuid)) return false
      // O CLI pode gravar a mensagem do usuário com outro uuid — compara pelo texto.
      if (m.role === 'user' && m.blocks[0]?.kind === 'text' && recentUserTexts.has(m.blocks[0].text)) return false
      return true
    })
    return [...h, ...live]
  }, [history, chat.live])

  useLayoutEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [messages, chat.draft, chat.permissions, history === null])

  async function send(): Promise<void> {
    const t = text.trim()
    if (!t) return
    setText('')
    setSendError(null)
    stick.current = true
    const r = await window.jarvis.chatSend({
      key: s.id,
      cwd: s.cwd || s.projectPath,
      text: t,
      // Já existe no disco → retoma; sessão nova do Jarvis → cria com o ID reservado.
      resumeId: s.filePath ? s.id : undefined,
      newSessionId: s.filePath ? undefined : s.id,
      permissionMode: chat.permissionMode,
      model: chat.model
    })
    if (!r.ok) {
      setSendError(r.error ?? 'Falha ao enviar')
      setText(t)
    }
  }

  return (
    <div className="chat">
      <div
        className="chat-scroll"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
        }}
      >
        <div className="transcript">
          {history === null && <div className="load-note">Carregando histórico…</div>}
          {history !== null && messages.length === 0 && (
            <div className="chat-empty">
              <h2>NOVA SESSÃO</h2>
              <p>
                Diretório: <code>{s.cwd || s.projectPath}</code>
              </p>
            </div>
          )}
          {history !== null && history.length >= 400 && (
            <div className="load-note">Exibindo as últimas 400 mensagens do histórico</div>
          )}
          {messages.map((m) => (
            <ChatMessage key={m.uuid} m={m} showDetails={showDetails} />
          ))}
          {chat.draft && chat.draft.text && (chat.draft.kind === 'text' || showDetails) && (
            <div className="msg assistant streaming">
              <div className="who">◆ CLAUDE</div>
              {chat.draft.kind === 'text' ? (
                <div className="text"><Markdown text={chat.draft.text} /></div>
              ) : (
                <div className="thinking">{chat.draft.text}</div>
              )}
            </div>
          )}
          {chat.permissions.map((p) => (
            <div key={p.id} className="perm">
              <div className="perm-title">⚠ {p.title}</div>
              {p.description && <div className="perm-desc">{p.description}</div>}
              <pre className="perm-detail">{p.detail}</pre>
              <div className="actions">
                <button className="btn primary" onClick={() => window.jarvis.chatRespondPermission(s.id, p.id, 'allow')}>
                  Permitir
                </button>
                {p.canAlwaysAllow && (
                  <button className="btn" onClick={() => window.jarvis.chatRespondPermission(s.id, p.id, 'always')}>
                    Sempre permitir
                  </button>
                )}
                <button className="btn danger" onClick={() => window.jarvis.chatRespondPermission(s.id, p.id, 'deny')}>
                  Negar
                </button>
              </div>
            </div>
          ))}
          {busy && !chat.draft && chat.permissions.length === 0 && (
            <div className="thinking-indicator">
              <span className="pulse-ring" />
              {chat.state === 'starting' ? 'INICIALIZANDO SESSÃO…' : 'PROCESSANDO…'}
            </div>
          )}
          {(chat.error || sendError) && <div className="warn">✕ {sendError ?? chat.error}</div>}
          {chat.lastResult?.isError && chat.lastResult.error && <div className="warn">✕ {chat.lastResult.error}</div>}
        </div>
      </div>

      <div className="composer">
        <textarea
          ref={input}
          className="input"
          rows={Math.min(8, Math.max(2, text.split('\n').length))}
          placeholder={busy ? 'Enviar mais instruções (entra na fila)…' : 'Instruções para o Claude…  (Enter envia · Shift+Enter quebra linha)'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void send()
            } else if (e.key === 'Escape' && busy) {
              void window.jarvis.chatInterrupt(s.id)
            }
          }}
        />
        <div className="composer-bar">
          <select
            className="select"
            value={chat.permissionMode}
            onChange={(e) => chatStore.setMode(s.id, e.target.value as PermissionMode)}
            title="Modo de permissão"
          >
            {MODES.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
          {chat.models.length > 0 && (
            <select
              className="select"
              value={chat.models.find((m) => m.value === chat.model) ? chat.model : ''}
              onChange={(e) => chatStore.setModel(s.id, e.target.value)}
              title="Modelo"
            >
              {!chat.models.some((m) => m.value === chat.model) && <option value="">{chat.model ?? 'Modelo'}</option>}
              {chat.models.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          )}
          <button className={`chip${showDetails ? ' on' : ''}`} onClick={() => setShowDetails((v) => !v)}>
            Detalhes
          </button>
          <span className="composer-status">
            {chat.lastResult && !busy && (
              <>
                {(chat.lastResult.durationMs / 1000).toFixed(1)}s
                {chat.lastResult.costUsd !== undefined && ` · ~US$ ${chat.lastResult.costUsd.toFixed(3)}`}
              </>
            )}
          </span>
          {busy ? (
            <button className="btn danger" onClick={() => void window.jarvis.chatInterrupt(s.id)} title="Esc">
              ■ Parar
            </button>
          ) : (
            <button className="btn primary" onClick={() => void send()} disabled={!text.trim()}>
              ▶ Enviar
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
