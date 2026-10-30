import { useSyncExternalStore } from 'react'
import type { ChatEvent, ChatPermissionRequest, ChatState, PermissionMode, TranscriptMessage } from '@shared/types'

export interface ChatSlot {
  state: ChatState
  error?: string
  live: TranscriptMessage[]
  draft: { kind: 'text' | 'thinking'; text: string } | null
  permissions: ChatPermissionRequest[]
  model?: string
  models: { value: string; label: string }[]
  permissionMode: PermissionMode
  lastResult?: { costUsd?: number; durationMs: number; isError: boolean; error?: string }
}

const MODE_KEY = 'jarvis.permissionMode'

function defaultMode(): PermissionMode {
  try {
    return (localStorage.getItem(MODE_KEY) as PermissionMode) || 'default'
  } catch {
    return 'default'
  }
}

/** Estado dos chats por sessão — vive fora dos componentes para sobreviver à troca de sessão. */
class ChatStore {
  private slots = new Map<string, ChatSlot>()
  private listeners = new Set<() => void>()
  private version = 0
  /** Substituído (nunca mutado) a cada mudança, para o React perceber. */
  private activeKeys = new Set<string>()

  constructor() {
    window.jarvis.onChatEvent((key, ev) => this.apply(key, ev))
    window.jarvis.chatActive().then((keys) => {
      this.activeKeys = new Set(keys)
      this.changed()
      // Após um reload da janela, recupera modelo/modo e se há um turno em andamento.
      for (const k of keys)
        window.jarvis.chatInfo(k).then((info) => {
          if (info?.init) this.apply(k, info.init)
          if (info?.running) this.update(k, { state: 'running' })
        })
    })
  }

  get(key: string): ChatSlot {
    let s = this.slots.get(key)
    if (!s) {
      s = { state: 'idle', live: [], draft: null, permissions: [], models: [], permissionMode: defaultMode() }
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
    try {
      localStorage.setItem(MODE_KEY, mode)
    } catch {
      /* armazenamento indisponível */
    }
    void window.jarvis.chatSetPermissionMode(key, mode)
  }

  setModel(key: string, model: string): void {
    this.update(key, { model })
    void window.jarvis.chatSetModel(key, model)
  }

  private apply(key: string, ev: ChatEvent): void {
    const s = this.get(key)
    switch (ev.type) {
      case 'state':
        if ((ev.state === 'starting' || ev.state === 'running') && !this.activeKeys.has(key))
          this.activeKeys = new Set([...this.activeKeys, key])
        this.update(key, { state: ev.state, error: ev.error ?? (ev.state === 'error' ? s.error : undefined) })
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
        this.update(key, { permissions: [...s.permissions, ev.request] })
        break
      case 'permission-done':
        this.update(key, { permissions: s.permissions.filter((p) => p.id !== ev.id) })
        break
      case 'result':
        this.update(key, { lastResult: ev, draft: null })
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

export function useActiveChats(): Set<string> {
  useSyncExternalStore(chatStore.subscribe, chatStore.snapshot)
  return chatStore.active()
}
