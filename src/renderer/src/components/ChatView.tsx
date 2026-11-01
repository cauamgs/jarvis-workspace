import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChatImage, RewindResult, SessionInfo, TranscriptBlock, TranscriptMessage } from '@shared/types'
import { chatStore, useChat } from '../chatStore'
import { ChatMessage, Markdown } from './ChatMessage'
import { Composer, readImageFile } from './Composer'
import { PermissionCard } from './Permissions'
import { derivePlan, PlanPanel } from './PlanPanel'

type ToolResult = Extract<TranscriptBlock, { kind: 'tool_result' }>

interface Props {
  session: SessionInfo
  /** Muda quando o índice de sessões é atualizado (transcript cresceu). */
  version: number
  /** Abre outra sessão (ex.: a ramificação recém-criada). */
  onOpenSession: (id: string) => void
}

const firstText = (m: TranscriptMessage): string | undefined => {
  const b = m.blocks.find((x) => x.kind === 'text')
  return b?.kind === 'text' ? b.text : undefined
}

export function ChatView({ session: s, version, onOpenSession }: Props): React.JSX.Element {
  const chat = useChat(s.id)
  const [history, setHistory] = useState<TranscriptMessage[] | null>(null)
  const [showDetails, setShowDetails] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; text: string } | null>(null)
  const [rewind, setRewind] = useState<{ uuid: string; preview: RewindResult } | null>(null)
  const [dragging, setDragging] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const busy = chat.state === 'running' || chat.state === 'starting'
  const active = chatStore.active().has(s.id)

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
    setNotice(null)
    setRewind(null)
  }, [s.id])

  // Histórico do disco + mensagens ao vivo que o disco ainda não tem.
  const messages = useMemo(() => {
    const h = history ?? []
    const ids = new Set(h.map((m) => m.uuid))
    const recentUserTexts = new Set(
      h.slice(-50).filter((m) => m.role === 'user').map(firstText).filter(Boolean)
    )
    const live = chat.live.filter((m) => {
      if (ids.has(m.uuid)) return false
      // O CLI pode gravar a mensagem do usuário com outro uuid — compara pelo texto.
      const t = m.role === 'user' ? firstText(m) : undefined
      return !(t && recentUserTexts.has(t))
    })
    return [...h, ...live]
  }, [history, chat.live])

  const results = useMemo(() => {
    const map = new Map<string, ToolResult>()
    for (const m of messages) for (const b of m.blocks) if (b.kind === 'tool_result') map.set(b.toolUseId, b)
    return map
  }, [messages])

  const plan = useMemo(() => derivePlan(messages, results), [messages, results])
  // Tarefas em segundo plano: todas as que rodam + as duas últimas concluídas.
  const tasks = [
    ...chat.tasks.filter((t) => t.status === 'running'),
    ...chat.tasks.filter((t) => t.status !== 'running').slice(-2)
  ]

  useLayoutEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [messages, chat.draft, chat.permissions, chat.subagents, history === null])

  async function send(text: string, images: ChatImage[]): Promise<boolean> {
    setNotice(null)
    stick.current = true
    const r = await window.jarvis.chatSend({
      key: s.id,
      cwd: s.cwd || s.projectPath,
      text,
      images,
      // Já existe no disco → retoma; sessão nova do Jarvis → cria com o ID reservado.
      resumeId: s.filePath ? s.id : undefined,
      newSessionId: s.filePath ? undefined : s.id,
      permissionMode: chat.permissionMode,
      model: chat.model,
      effort: chat.effort || undefined
    })
    if (!r.ok) setNotice({ kind: 'error', text: r.error ?? 'Falha ao enviar' })
    return r.ok
  }

  async function fork(uuid: string): Promise<void> {
    const r = await window.jarvis.forkSession(s.id, uuid)
    if (r.ok && r.sessionId) onOpenSession(r.sessionId)
    else setNotice({ kind: 'error', text: `Não foi possível ramificar: ${r.error}` })
  }

  async function startRewind(uuid: string): Promise<void> {
    const preview = await window.jarvis.chatRewind(s.id, uuid, true)
    if (!preview.canRewind) setNotice({ kind: 'error', text: preview.error ?? 'Não há checkpoint de arquivos para este ponto.' })
    else setRewind({ uuid, preview })
  }

  async function confirmRewind(withConversation: boolean): Promise<void> {
    if (!rewind) return
    const r = await window.jarvis.chatRewind(s.id, rewind.uuid, false)
    const count = (r.filesChanged ?? rewind.preview.filesChanged ?? []).length
    setRewind(null)
    if (!r.canRewind) {
      setNotice({ kind: 'error', text: r.error ?? 'Falha ao restaurar arquivos.' })
      return
    }
    if (!withConversation) {
      setNotice({ kind: 'info', text: `Arquivos restaurados: ${count} arquivo(s). O Claude não é avisado da mudança.` })
      return
    }
    // Conversa: ramifica até a mensagem anterior, para o Claude "esquecer" o que veio depois.
    const i = messages.findIndex((m) => m.uuid === rewind.uuid)
    const before = messages.slice(0, Math.max(0, i)).reverse().find((m) => m.role !== 'system')
    if (!before) {
      setNotice({ kind: 'info', text: `Arquivos restaurados (${count}). Não há conversa anterior para ramificar.` })
      return
    }
    const f = await window.jarvis.forkSession(s.id, before.uuid)
    if (f.ok && f.sessionId) onOpenSession(f.sessionId)
    else setNotice({ kind: 'error', text: `Arquivos restaurados, mas a ramificação falhou: ${f.error}` })
  }

  async function onDrop(e: React.DragEvent): Promise<void> {
    setDragging(false)
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'))
    if (!files.length) return
    e.preventDefault()
    const imgs = (await Promise.all(files.map(readImageFile))).filter((x): x is ChatImage => !!x)
    window.dispatchEvent(new CustomEvent('jarvis:images', { detail: imgs }))
  }

  return (
    <div
      className={`chat${dragging ? ' dragging' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => void onDrop(e)}
    >
      <PlanPanel key={s.id} items={plan} />
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
            <ChatMessage
              key={m.uuid}
              m={m}
              showDetails={showDetails}
              results={results}
              running={busy}
              subagents={chat.subagents}
              onFork={s.filePath ? (uuid) => void fork(uuid) : undefined}
              onRewind={active ? (uuid) => void startRewind(uuid) : undefined}
            />
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
            <PermissionCard key={p.id} request={p} onRespond={(r) => window.jarvis.chatRespondPermission(s.id, p.id, r)} />
          ))}
          {busy && !chat.draft && chat.permissions.length === 0 && (
            <div className="thinking-indicator">
              <span className="pulse-ring" />
              {chat.state === 'starting' ? 'INICIALIZANDO SESSÃO…' : 'PROCESSANDO…'}
            </div>
          )}
          {chat.error && <div className="warn">✕ {chat.error}</div>}
          {chat.lastResult?.isError && chat.lastResult.error && <div className="warn">✕ {chat.lastResult.error}</div>}
        </div>
      </div>

      {tasks.length > 0 && (
        <div className="bg-tasks">
          {tasks.map((t) => (
            <div key={t.id} className={`bg-task ${t.status}`} title={t.summary}>
              {t.status === 'running' ? <span className="pulse-ring sm" /> : <b>{t.status === 'completed' ? '✓' : '✕'}</b>}
              <span className="bt-desc">{t.description}</span>
              <span className="bt-meta">
                {t.status === 'running' ? (t.lastTool ? `${t.lastTool}…` : 'em segundo plano') : t.summary ?? t.status}
              </span>
            </div>
          ))}
        </div>
      )}

      {notice && (
        <div className={notice.kind === 'error' ? 'warn' : 'note'} onClick={() => setNotice(null)}>
          {notice.kind === 'error' ? '✕' : '✓'} {notice.text}
        </div>
      )}

      {rewind && (
        <div className="rewind-confirm">
          <div className="perm-title">↺ Restaurar arquivos para antes desta mensagem?</div>
          <div className="perm-desc">
            {rewind.preview.filesChanged?.length ?? 0} arquivo(s) · <span className="add">+{rewind.preview.insertions ?? 0}</span>{' '}
            <span className="del">−{rewind.preview.deletions ?? 0}</span> 
          </div>
          {!!rewind.preview.filesChanged?.length && (
            <pre className="perm-detail">{rewind.preview.filesChanged.join('\n')}</pre>
          )}
          <div className="actions">
            <button className="btn danger" onClick={() => void confirmRewind(false)} title="Só os arquivos voltam; a conversa segue">
              Só arquivos
            </button>
            <button
              className="btn danger"
              onClick={() => void confirmRewind(true)}
              title="Arquivos voltam e uma nova sessão continua a conversa de antes desta mensagem"
            >
              Arquivos + conversa
            </button>
            <button className="btn ghost" onClick={() => setRewind(null)}>Cancelar</button>
          </div>
        </div>
      )}

      <Composer
        sessionKey={s.id}
        showDetails={showDetails}
        onToggleDetails={() => setShowDetails((v) => !v)}
        onSend={send}
      />
      {dragging && <div className="drop-overlay">SOLTE AS IMAGENS PARA ANEXAR</div>}
    </div>
  )
}
