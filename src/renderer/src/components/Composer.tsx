import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChatImage, EffortLevel, McpServerInfo, PermissionMode } from '@shared/types'
import { chatStore, useChat, useChatGlobal } from '../chatStore'

const MODES: { value: PermissionMode; label: string }[] = [
  { value: 'default', label: 'Perguntar sempre' },
  { value: 'acceptEdits', label: 'Aceitar edições' },
  { value: 'plan', label: 'Modo plano' },
  { value: 'auto', label: 'Automático' },
  { value: 'bypassPermissions', label: '⚠ Sem permissões' }
]

const EFFORTS: { value: EffortLevel | ''; label: string }[] = [
  { value: '', label: 'Esforço padrão' },
  { value: 'low', label: 'Esforço baixo' },
  { value: 'medium', label: 'Esforço médio' },
  { value: 'high', label: 'Esforço alto' },
  { value: 'xhigh', label: 'Esforço muito alto' },
  { value: 'max', label: 'Esforço máximo' }
]

const MAX_IMAGE_BYTES = 5 * 1024 * 1024

interface Props {
  sessionKey: string
  showDetails: boolean
  onToggleDetails: () => void
  onSend: (text: string, images: ChatImage[]) => Promise<boolean>
}

export function readImageFile(file: File): Promise<ChatImage | null> {
  return new Promise((resolve) => {
    if (!file.type.startsWith('image/') || file.size > MAX_IMAGE_BYTES) return resolve(null)
    const reader = new FileReader()
    reader.onload = () => resolve({ mediaType: file.type, data: String(reader.result).split(',')[1], name: file.name })
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })
}

export function Composer({ sessionKey: key, showDetails, onToggleDetails, onSend }: Props): React.JSX.Element {
  const chat = useChat(key)
  const global = useChatGlobal()
  const [text, setText] = useState('')
  const [images, setImages] = useState<ChatImage[]>([])
  const [cmdIndex, setCmdIndex] = useState(0)
  const [mcpOpen, setMcpOpen] = useState(false)
  const [dictating, setDictating] = useState(false)
  const dictateBase = useRef('')
  const dictatingRef = useRef(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const busy = chat.state === 'running' || chat.state === 'starting'
  const active = chatStore.active().has(key)

  useEffect(() => {
    setText('')
    setImages([])
    input.current?.focus()
  }, [key])

  // Ditado: o texto falado entra na caixa (sem enviar sozinho).
  useEffect(
    () =>
      window.jarvis.onVoiceEvent((ev) => {
        if (!dictatingRef.current) return
        if (ev.type === 'partial' || ev.type === 'final') setText((dictateBase.current + ' ' + ev.text).trim())
        if (ev.type === 'state' && !ev.listening) {
          dictatingRef.current = false
          setDictating(false)
          input.current?.focus()
        }
      }),
    []
  )

  async function toggleDictation(): Promise<void> {
    if (dictating) return window.jarvis.voiceStop()
    dictateBase.current = text
    dictatingRef.current = true
    setDictating(true)
    const r = await window.jarvis.voiceStart()
    if (!r.ok) {
      dictatingRef.current = false
      setDictating(false)
      alert(r.error)
    }
  }

  // Arrastar imagens para qualquer lugar do chat chega aqui via evento.
  useEffect(() => {
    const onDrop = (e: Event): void => setImages((cur) => [...cur, ...(e as CustomEvent<ChatImage[]>).detail])
    window.addEventListener('jarvis:images', onDrop)
    return () => window.removeEventListener('jarvis:images', onDrop)
  }, [])

  // Autocompletar de comandos: "/" no início, antes do primeiro espaço.
  const slash = /^\/(\S*)$/.exec(text)
  const commands = useMemo(() => {
    if (!slash) return []
    const q = slash[1].toLowerCase()
    return global.commands
      .filter((c) => c.name.toLowerCase().startsWith(q))
      .sort((a, b) => Number(!!b.builtin) - Number(!!a.builtin) || a.name.length - b.name.length)
      .slice(0, 8)
  }, [slash?.[1], global.commands])
  useEffect(() => setCmdIndex(0), [commands.length])

  async function submit(): Promise<void> {
    const t = text.trim()
    if (!t && !images.length) return
    const sentText = t
    const sentImages = images
    setText('')
    setImages([])
    chatStore.clearSuggestion(key)
    if (!(await onSend(sentText, sentImages))) {
      setText(sentText)
      setImages(sentImages)
    }
  }

  async function onPaste(e: React.ClipboardEvent): Promise<void> {
    const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'))
    if (!files.length) return
    e.preventDefault()
    const read = (await Promise.all(files.map(readImageFile))).filter((x): x is ChatImage => !!x)
    setImages((cur) => [...cur, ...read])
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (commands.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setCmdIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : commands.length - 1)) % commands.length)
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && commands[cmdIndex]?.name !== slash?.[1])) {
        e.preventDefault()
        setText(`/${commands[cmdIndex].name} `)
        return
      }
    }
    if (e.key === 'Tab' && !text && chat.suggestion) {
      e.preventDefault()
      setText(chat.suggestion)
      return
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void submit()
    } else if (e.key === 'Escape' && busy) {
      void window.jarvis.chatInterrupt(key)
    }
  }

  const ctx = chat.context

  return (
    <div className="composer">
      {commands.length > 0 && (
        <div className="slash-menu">
          {commands.map((c, i) => (
            <div
              key={c.name}
              className={`slash-item${i === cmdIndex ? ' on' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault()
                setText(`/${c.name} `)
                input.current?.focus()
              }}
            >
              <b>/{c.name}</b>
              {c.argumentHint && <i>{c.argumentHint.length > 40 ? c.argumentHint.slice(0, 39) + '…' : c.argumentHint}</i>}
              <span>{c.description}</span>
            </div>
          ))}
        </div>
      )}

      {chat.suggestion && !text && !busy && (
        <button className="suggestion" onClick={() => setText(chat.suggestion!)} title="Tab para usar">
          ↳ {chat.suggestion} <span>TAB</span>
        </button>
      )}

      {images.length > 0 && (
        <div className="attachments">
          {images.map((img, i) => (
            <div key={i} className="thumb">
              <img src={`data:${img.mediaType};base64,${img.data}`} alt={img.name ?? 'imagem'} />
              <button onClick={() => setImages((cur) => cur.filter((_, j) => j !== i))} title="Remover">✕</button>
            </div>
          ))}
        </div>
      )}

      <textarea
        ref={input}
        className="input"
        rows={Math.min(8, Math.max(2, text.split('\n').length))}
        placeholder={
          busy
            ? 'Enviar mais instruções (entra na fila)…'
            : 'Instruções para o Claude…  (Enter envia · Shift+Enter quebra linha · / comandos · cole imagens)'
        }
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={(e) => void onPaste(e)}
      />

      <div className="composer-bar">
        <button
          className="icon-btn"
          title="Anexar imagens"
          onClick={async () => {
            const picked = await window.jarvis.pickImages()
            setImages((cur) => [...cur, ...picked])
          }}
        >
          ⊕
        </button>
        <button
          className={`icon-btn${dictating ? ' rec' : ''}`}
          title={dictating ? 'Parar ditado' : 'Ditar (voz)'}
          onClick={() => void toggleDictation()}
        >
          {dictating ? '■' : '🎙'}
        </button>
        <select
          className="select"
          value={chat.permissionMode}
          onChange={(e) => chatStore.setMode(key, e.target.value as PermissionMode)}
          title="Modo de permissão (Shift+Tab no CLI)"
        >
          {MODES.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
        {chat.models.length > 0 && (
          <select
            className="select"
            value={chat.models.find((m) => m.value === chat.model) ? chat.model : ''}
            onChange={(e) => chatStore.setModel(key, e.target.value)}
            title="Modelo"
          >
            {!chat.models.some((m) => m.value === chat.model) && <option value="">{chat.model ?? 'Modelo'}</option>}
            {chat.models.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        )}
        <select
          className="select"
          value={chat.effort}
          onChange={(e) => chatStore.setEffort(key, e.target.value as EffortLevel | '')}
          title="Esforço de raciocínio"
        >
          {EFFORTS.map((x) => (
            <option key={x.value} value={x.value}>{x.label}</option>
          ))}
        </select>
        <button className={`chip${showDetails ? ' on' : ''}`} onClick={onToggleDetails} title="Mostrar raciocínio">
          Raciocínio
        </button>
        {active && (
          <div className="mcp-wrap">
            <button className={`chip${mcpOpen ? ' on' : ''}`} onClick={() => setMcpOpen((o) => !o)}>MCP</button>
            {mcpOpen && <McpPanel sessionKey={key} onClose={() => setMcpOpen(false)} />}
          </div>
        )}

        <span className="composer-status">
          {chat.lastResult && !busy && (
            <>
              {(chat.lastResult.durationMs / 1000).toFixed(1)}s
              {chat.lastResult.costUsd !== undefined && ` · ~US$ ${chat.lastResult.costUsd.toFixed(3)}`}
            </>
          )}
        </span>
        {ctx && <ContextMeter usage={ctx} />}
        {busy ? (
          <button className="btn danger" onClick={() => void window.jarvis.chatInterrupt(key)} title="Esc">
            ■ Parar
          </button>
        ) : (
          <button className="btn primary" onClick={() => void submit()} disabled={!text.trim() && !images.length}>
            ▶ Enviar
          </button>
        )}
      </div>
    </div>
  )
}

function ContextMeter({ usage }: { usage: NonNullable<ReturnType<typeof useChat>['context']> }): React.JSX.Element {
  const pct = Math.round(usage.percentage)
  const level = pct >= 85 ? 'crit' : pct >= 65 ? 'warn' : ''
  const used = usage.categories.filter((c) => c.kind === 'used' && c.tokens > 0)
  const fmt = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(n))
  return (
    <div className={`ctx-meter ${level}`}>
      <svg width="22" height="22" viewBox="0 0 36 36">
        <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="4" />
        <circle
          cx="18"
          cy="18"
          r="15"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeDasharray={`${(pct / 100) * 94.2} 94.2`}
          transform="rotate(-90 18 18)"
        />
      </svg>
      <span>{pct}%</span>
      <div className="ctx-pop">
        <div className="ctx-title">CONTEXTO · {fmt(usage.totalTokens)} / {fmt(usage.maxTokens)} tokens</div>
        {used.map((c) => (
          <div key={c.name} className="ctx-row">
            <i style={{ background: c.color }} />
            <span>{c.name}</span>
            <b>{fmt(c.tokens)}</b>
          </div>
        ))}
        {pct >= 65 && <div className="ctx-hint">Use /compact para resumir a conversa e liberar espaço.</div>}
      </div>
    </div>
  )
}

function McpPanel({ sessionKey: key, onClose }: { sessionKey: string; onClose: () => void }): React.JSX.Element {
  const [servers, setServers] = useState<McpServerInfo[] | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const load = (): void => void window.jarvis.chatMcpStatus(key).then(setServers)

  useEffect(load, [key])
  useEffect(() => {
    const close = (e: MouseEvent): void => {
      if (!ref.current?.parentElement?.contains(e.target as Node)) onClose()
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [onClose])

  const label = { connected: 'conectado', failed: 'falhou', 'needs-auth': 'requer login', pending: 'conectando', disabled: 'desligado' }

  return (
    <div className="mcp-panel" ref={ref}>
      <div className="ctx-title">SERVIDORES MCP</div>
      {servers === null && <div className="ctx-hint">Carregando…</div>}
      {servers?.length === 0 && <div className="ctx-hint">Nenhum servidor MCP nesta sessão.</div>}
      {servers?.map((s) => (
        <div key={s.name} className="mcp-row" title={s.error}>
          <i className={`mcp-dot ${s.status}`} />
          <span className="mcp-name">{s.name}</span>
          <span className="mcp-status">{label[s.status]}</span>
          {(s.status === 'failed' || s.status === 'needs-auth') && (
            <button className="chip" onClick={() => void window.jarvis.chatMcpReconnect(key, s.name).then(load)}>Religar</button>
          )}
          <button
            className="chip"
            onClick={() => void window.jarvis.chatMcpToggle(key, s.name, s.status === 'disabled').then(load)}
          >
            {s.status === 'disabled' ? 'Ligar' : 'Desligar'}
          </button>
        </div>
      ))}
    </div>
  )
}
