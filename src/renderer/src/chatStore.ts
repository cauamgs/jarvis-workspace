import { useSyncExternalStore } from 'react'
import type {
  BackgroundTask,
  ChatEvent,
  ChatPermissionRequest,
  ChatState,
  ContextUsage,
  EffortLevel,
  PermissionMode,
  RateLimitInfo,
  SlashCommandInfo,
  TranscriptMessage
} from '@shared/types'
import { speak } from './voice'

export interface ChatSlot {
  state: ChatState
  error?: string
  live: TranscriptMessage[]
  draft: { kind: 'text' | 'thinking'; text: string } | null
  permissions: ChatPermissionRequest[]
  model?: string
  models: { value: string; label: string }[]
  permissionMode: PermissionMode
  effort: EffortLevel | ''
  lastResult?: { costUsd?: number; durationMs: number; isError: boolean; error?: string }
  /** Atividade dos subagentes, por id da ferramenta Agent que os criou. */
  subagents: Record<string, TranscriptMessage[]>
  tasks: BackgroundTask[]
  suggestion?: string
  context?: ContextUsage
}

/** Estado que não pertence a uma sessão: conta, limites de uso e comandos disponíveis. */
export interface ChatGlobal {
  rateLimit?: RateLimitInfo
  account?: { email?: string; subscriptionType?: string }
  commands: SlashCommandInfo[]
}

const MODE_KEY = 'jarvis.permissionMode'
const EFFORT_KEY = 'jarvis.effort'
const COMMANDS_KEY = 'jarvis.commands'
const MAX_SUBAGENT_MESSAGES = 60

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v === null ? fallback : (JSON.parse(v) as T)
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* armazenamento indisponível */
  }
}

function safeDefaultMode(): PermissionMode {
  const m = read<PermissionMode>(MODE_KEY, 'default')
  return m === 'plan' || m === 'bypassPermissions' ? 'default' : m
}

/** Estado dos chats por sessão — vive fora dos componentes para sobreviver à troca de sessão. */
class ChatStore {
  private slots = new Map<string, ChatSlot>()
  private listeners = new Set<() => void>()
  private version = 0
  /** Substituído (nunca mutado) a cada mudança, para o React perceber. */
  private activeKeys = new Set<string>()
  global: ChatGlobal = { commands: read<SlashCommandInfo[]>(COMMANDS_KEY, []) }
  /** Sessões cujo próximo resultado deve ser lido em voz alta (pedido feito por voz). */
  private speakNext = new Set<string>()

  markSpeak(key: string): void {
    this.speakNext.add(key)
  }

  constructor() {
    window.jarvis.onChatEvent((key, ev) => this.apply(key, ev))
    window.jarvis.chatActive().then((keys) => {
      this.activeKeys = new Set(keys)
      this.changed()
      // Após um reload da janela, recupera o estado das sessões que continuam vivas.
      for (const k of keys)
        window.jarvis.chatInfo(k).then((info) => {
          if (!info) return
          if (info.init) this.apply(k, info.init)
          this.update(k, {
            state: info.running ? 'running' : 'idle',
            permissions: info.permissions,
            tasks: info.tasks,
            context: info.context
          })
        })
    })
  }

  get(key: string): ChatSlot {
    let s = this.slots.get(key)
    if (!s) {
      s = {
        state: 'idle',
        live: [],
        draft: null,
        permissions: [],
        models: [],
        permissionMode: safeDefaultMode(),
        effort: read<EffortLevel | ''>(EFFORT_KEY, ''),
        subagents: {},
        tasks: []
      }
      this.slots.set(key, s)
    }
    return s
  }

  /** Sessões com processo de chat vivo no Jarvis. */
  active(): Set<string> {
    return this.activeKeys
  }

  setMode(key: string, mode: PermissionMode): void {
    this.update(key, { permissionMode: mode })
    // Plano e "sem permissões" valem só para esta sessão — nunca viram o padrão das próximas.
    if (mode !== 'plan' && mode !== 'bypassPermissions') write(MODE_KEY, mode)
    void window.jarvis.chatSetPermissionMode(key, mode)
  }

  setModel(key: string, model: string): void {
    this.update(key, { model })
    void window.jarvis.chatSetModel(key, model)
  }

  setEffort(key: string, effort: EffortLevel | ''): void {
    this.update(key, { effort })
    write(EFFORT_KEY, effort)
    if (effort) void window.jarvis.chatSetEffort(key, effort)
  }

  clearSuggestion(key: string): void {
    this.update(key, { suggestion: undefined })
  }

  private apply(key: string, ev: ChatEvent): void {
    const s = this.get(key)
    switch (ev.type) {
      case 'state':
        if ((ev.state === 'starting' || ev.state === 'running') && !this.activeKeys.has(key))
          this.activeKeys = new Set([...this.activeKeys, key])
        this.update(key, {
          state: ev.state,
          error: ev.error ?? (ev.state === 'error' ? s.error : undefined),
          suggestion: ev.state === 'running' ? undefined : s.suggestion
        })
        if (ev.state === 'idle' || ev.state === 'error') {
          // "idle" chega tanto ao fim de um turno quanto ao fechar o processo; só o segundo remove das ativas.
          window.jarvis.chatActive().then((keys) => {
            if (keys.includes(key) || !this.activeKeys.has(key)) return
            this.activeKeys = new Set([...this.activeKeys].filter((k) => k !== key))
            this.changed()
          })
        }
        break
      case 'init':
        this.update(key, { model: ev.model, models: ev.models, permissionMode: ev.permissionMode })
        if (ev.commands.length) {
          write(COMMANDS_KEY, ev.commands)
          this.global = { ...this.global, commands: ev.commands }
        }
        if (ev.account) this.global = { ...this.global, account: ev.account }
        break
      case 'message':
        if (!s.live.some((m) => m.uuid === ev.message.uuid)) this.update(key, { live: [...s.live, ev.message] })
        break
      case 'draft':
        this.update(key, { draft: { kind: ev.kind, text: ev.text } })
        break
      case 'draft-clear':
        this.update(key, { draft: null })
        break
      case 'permission':
        if (!s.permissions.some((p) => p.id === ev.request.id))
          this.update(key, { permissions: [...s.permissions, ev.request] })
        break
      case 'permission-done':
        this.update(key, { permissions: s.permissions.filter((p) => p.id !== ev.id) })
        break
      case 'result':
        this.update(key, { lastResult: ev, draft: null })
        if (this.speakNext.delete(key)) {
          const last = [...s.live].reverse().find((m) => m.role === 'assistant' && m.blocks.some((b) => b.kind === 'text'))
          const text = last?.blocks.flatMap((b) => (b.kind === 'text' ? [b.text] : [])).join(' ')
          if (text) speak(ev.isError ? 'Houve um erro ao executar o pedido.' : text)
        }
        break
      case 'subagent': {
        const prev = s.subagents[ev.parentId] ?? []
        if (prev.some((m) => m.uuid === ev.message.uuid)) break
        this.update(key, {
          subagents: { ...s.subagents, [ev.parentId]: [...prev, ev.message].slice(-MAX_SUBAGENT_MESSAGES) }
        })
        break
      }
      case 'task': {
        const others = s.tasks.filter((t) => t.id !== ev.task.id)
        this.update(key, { tasks: [...others, ev.task] })
        break
      }
      case 'suggestion':
        this.update(key, { suggestion: ev.text })
        break
      case 'context':
        this.update(key, { context: ev.usage })
        break
      case 'rate-limit':
        this.global = { ...this.global, rateLimit: ev.info }
        this.changed()
        break
    }
  }

  private update(key: string, patch: Partial<ChatSlot>): void {
    this.slots.set(key, { ...this.get(key), ...patch })
    this.changed()
  }

  private changed(): void {
    this.version++
    this.listeners.forEach((l) => l())
  }

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  snapshot = (): number => this.version
}

export const chatStore = new ChatStore()

export function useChat(key: string): ChatSlot {
  useSyncExternalStore(chatStore.subscribe, chatStore.snapshot)
  return chatStore.get(key)
}

export function useChatGlobal(): ChatGlobal {
  useSyncExternalStore(chatStore.subscribe, chatStore.snapshot)
  return chatStore.global
}

export function useActiveChats(): Set<string> {
  useSyncExternalStore(chatStore.subscribe, chatStore.snapshot)
  return chatStore.active()
}
