import { useEffect, useMemo, useRef, useState } from 'react'
import type { NavRequest, SessionInfo, Workspace } from '@shared/types'
import { ArcReactor } from './components/ArcReactor'
import { inWorkspace, timeAgo } from './lib'

type Item =
  | { kind: 'open' }
  | { kind: 'session'; s: SessionInfo; running: boolean }
  | { kind: 'ws'; ws: Workspace }
  | { kind: 'new'; label: string; cwd: string; workspaceId?: string; color?: string }

interface Group {
  title: string
  items: Item[]
}

/** Busca rápida (⇧⌘J): encontra sessões, workspaces ou começa uma sessão nova com o pedido digitado. */
export function Palette(): React.JSX.Element {
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [active, setActive] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  async function refresh(): Promise<void> {
    const [s, w, a] = await Promise.all([
      window.jarvis.listSessions(),
      window.jarvis.listWorkspaces(),
      window.jarvis.chatActive()
    ])
    setSessions(s)
    setWorkspaces(w)
    setActive(new Set(a))
  }

  useEffect(() => {
    void refresh()
    return window.jarvis.onPaletteShown(() => {
      setQuery('')
      setIndex(0)
      void refresh()
      requestAnimationFrame(() => input.current?.focus())
    })
  }, [])

  const groups = useMemo<Group[]>(() => {
    const q = query.trim().toLowerCase()
    const visible = sessions.filter((s) => !s.archived)
    const isRunning = (s: SessionInfo): boolean => s.live || active.has(s.id)
    const toItem = (s: SessionInfo): Item => ({ kind: 'session', s, running: isRunning(s) })

    if (!q) {
      const running = visible.filter(isRunning)
      const recent = visible.filter((s) => !isRunning(s)).slice(0, 6)
      const groups: Group[] = [
        { title: 'AÇÕES', items: [{ kind: 'open' }] },
        { title: 'EM EXECUÇÃO', items: running.slice(0, 6).map(toItem) },
        { title: 'RECENTES', items: recent.map(toItem) },
        { title: 'WORKSPACES', items: workspaces.map((ws) => ({ kind: 'ws', ws }) as Item) }
      ]
      return groups.filter((g) => g.items.length)
    }

    const words = q.split(/\s+/)
    const matches = (text: string): boolean => words.every((w) => text.includes(w))
    const found = visible
      .filter((s) => {
        const wsNames = workspaces.filter((w) => inWorkspace(w, s)).map((w) => w.name)
        return matches([s.title, s.projectName, s.branch ?? '', ...wsNames].join(' ').toLowerCase())
      })
      .slice(0, 7)

    // "Nova sessão com este pedido": workspaces com pasta vinculada + projetos recentes.
    const targets: Item[] = []
    const seen = new Set<string>()
    for (const ws of workspaces) {
      const cwd = ws.autoPaths[0]
      if (!cwd || seen.has(cwd)) continue
      seen.add(cwd)
      targets.push({ kind: 'new', label: ws.name, cwd, workspaceId: ws.id, color: ws.color })
    }
    for (const s of sessions) {
      if (targets.length >= 5) break
      if (seen.has(s.projectPath)) continue
      seen.add(s.projectPath)
      targets.push({ kind: 'new', label: s.projectName, cwd: s.projectPath })
    }

    return [
      { title: 'SESSÕES', items: found.map(toItem) },
      { title: 'WORKSPACES', items: workspaces.filter((w) => matches(w.name.toLowerCase())).map((ws) => ({ kind: 'ws', ws }) as Item) },
      { title: 'NOVA SESSÃO COM ESTE PEDIDO', items: targets }
    ].filter((g) => g.items.length)
  }, [query, sessions, workspaces, active])

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups])
  const current = flat[Math.min(index, flat.length - 1)]

  useEffect(() => setIndex(0), [query])
  useEffect(() => {
    list.current?.querySelector('.p-item.on')?.scrollIntoView({ block: 'nearest' })
  }, [index])

  function run(item: Item | undefined, sendText: boolean): void {
    if (!item) return
    const text = query.trim()
    let req: NavRequest
    switch (item.kind) {
      case 'open':
        req = { type: 'show' }
        break
      case 'session':
        req = { type: 'session', id: item.s.id, send: sendText && text ? text : undefined }
        break
      case 'ws':
        req = { type: 'workspace', id: item.ws.id }
        break
      case 'new':
        req = { type: 'new', cwd: item.cwd, workspaceId: item.workspaceId, text: text || undefined }
        break
    }
    window.jarvis.navigate(req)
  }

  function onKey(e: React.KeyboardEvent): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex((i) => Math.min(i + 1, flat.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run(current, e.metaKey)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (query) setQuery('')
      else window.jarvis.hidePalette()
    }
  }

  let n = -1
  return (
    <div className="palette-root" onMouseDown={(e) => e.target === e.currentTarget && window.jarvis.hidePalette()}>
      <div className="panel palette">
        <div className="p-input">
          <ArcReactor size={34} />
          <input
            ref={input}
            autoFocus
            value={query}
            placeholder="Às suas ordens. Buscar sessão ou descrever uma tarefa…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
          />
          <span className="p-shortcut">{window.jarvis.shortcutLabel}</span>
        </div>
        <div className="p-list" ref={list}>
          {groups.map((g) => (
            <div key={g.title}>
              <div className="p-group">{g.title}</div>
              {g.items.map((item) => {
                n++
                const i = n
                return (
                  <div
                    key={i}
                    className={`p-item${current === item ? ' on' : ''}`}
                    onMouseMove={() => setIndex(i)}
                    onClick={(e) => run(item, e.metaKey)}
                  >
                    <ItemView item={item} hasText={!!query.trim()} />
                  </div>
                )
              })}
            </div>
          ))}
          {!flat.length && <div className="empty">Nada encontrado</div>}
        </div>
        <div className="p-foot">
          <span><b>↑↓</b> navegar</span>
          <span><b>↵</b> {current?.kind === 'new' ? 'criar e enviar' : 'abrir'}</span>
          {current?.kind === 'session' && query.trim() && <span><b>⌘↵</b> enviar pedido para esta sessão</span>}
          <span className="right"><b>esc</b> fechar</span>
        </div>
      </div>
    </div>
  )
}

function ItemView({ item, hasText }: { item: Item; hasText: boolean }): React.JSX.Element {
  switch (item.kind) {
    case 'open':
      return (
        <>
          <span className="p-glyph">◎</span>
          <span className="p-title">Abrir Jarvis WorkSpace</span>
        </>
      )
    case 'session':
      return (
        <>
          <span className="p-glyph">{item.running ? <i className="live-dot" /> : '◇'}</span>
          <span className="p-title">{item.s.title}</span>
          <span className="p-meta">
            {item.s.projectName} · {timeAgo(item.s.lastActivityAt)}
          </span>
        </>
      )
    case 'ws':
      return (
        <>
          <span className="p-glyph" style={{ color: item.ws.color }}>{item.ws.icon}</span>
          <span className="p-title">{item.ws.name}</span>
          <span className="p-meta">workspace</span>
        </>
      )
    case 'new':
      return (
        <>
          <span className="p-glyph" style={{ color: item.color ?? 'var(--amber)' }}>+</span>
          <span className="p-title">
            Nova sessão em <b>{item.label}</b>
          </span>
          <span className="p-meta">{hasText ? 'envia o pedido' : ''}</span>
        </>
      )
  }
}
