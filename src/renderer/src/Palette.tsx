import { useEffect, useMemo, useRef, useState } from 'react'
import type { AppEntry, AutoAction, NavRequest, Routine, SessionInfo, Workspace } from '@shared/types'
import { ArcReactor } from './components/ArcReactor'
import { inWorkspace, timeAgo } from './lib'
import { cleanUtterance, parseCommand, speak, type Command } from './voice'

type Item =
  | { kind: 'open' }
  | { kind: 'cmd'; cmd: Command }
  | { kind: 'app'; app: AppEntry }
  | { kind: 'shortcut'; name: string }
  | { kind: 'routine'; routine: Routine }
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
  const [apps, setApps] = useState<AppEntry[]>([])
  const [shortcuts, setShortcuts] = useState<string[]>([])
  const [routines, setRoutines] = useState<Routine[]>([])
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  // Voz: escutando, nível do microfone, erro, e se o texto atual veio de voz (resposta será falada).
  const [listening, setListening] = useState(false)
  const [level, setLevel] = useState(0)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [fromVoice, setFromVoice] = useState(false)
  /** Só processa a escuta que a própria busca iniciou (o ditado do chat usa o mesmo microfone). */
  const ownsVoice = useRef(false)
  const dataRef = useRef({ sessions, workspaces, apps, shortcuts, routines })
  dataRef.current = { sessions, workspaces, apps, shortcuts, routines }

  async function refresh(): Promise<void> {
    const [s, w, a, ap, sc, r] = await Promise.all([
      window.jarvis.listSessions(),
      window.jarvis.listWorkspaces(),
      window.jarvis.chatActive(),
      window.jarvis.autoApps(),
      window.jarvis.autoShortcuts(),
      window.jarvis.autoRoutines()
    ])
    setSessions(s)
    setWorkspaces(w)
    setActive(new Set(a))
    setApps(ap)
    setShortcuts(sc)
    setRoutines(r)
  }

  async function startVoice(): Promise<void> {
    setVoiceError(null)
    setQuery('')
    ownsVoice.current = true
    const r = await window.jarvis.voiceStart()
    if (!r.ok) {
      ownsVoice.current = false
      setVoiceError(r.error ?? 'Falha ao iniciar a escuta')
    }
  }

  useEffect(() => {
    void refresh()
    const offShown = window.jarvis.onPaletteShown(() => {
      setQuery('')
      setIndex(0)
      setFromVoice(false)
      setVoiceError(null)
      void refresh()
      requestAnimationFrame(() => input.current?.focus())
    })
    const offVoiceOpen = window.jarvis.onPaletteVoice(() => void startVoice())
    const offVoice = window.jarvis.onVoiceEvent((ev) => {
      if (!ownsVoice.current) return
      if (ev.type === 'state') {
        setListening(ev.listening)
        if (!ev.listening) {
          setLevel(0)
          ownsVoice.current = false
        }
      } else if (ev.type === 'level') setLevel(ev.value)
      else if (ev.type === 'partial') {
        setQuery(ev.text)
        setFromVoice(true)
      } else if (ev.type === 'final') {
        const text = cleanUtterance(ev.text)
        setQuery(text)
        setFromVoice(true)
        // Comandos locais executam na hora; pedidos para o Claude esperam confirmação (Enter).
        const cmd = text && parseCommand(text, dataRef.current)
        if (cmd) void execute(cmd, true)
        requestAnimationFrame(() => input.current?.focus())
      } else if (ev.type === 'error') setVoiceError(ev.message)
    })
    return () => {
      offShown()
      offVoiceOpen()
      offVoice()
    }
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
        { title: 'ROTINAS', items: routines.map((routine) => ({ kind: 'routine', routine }) as Item) },
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

    const cmd = parseCommand(query, { sessions, workspaces, apps, shortcuts, routines })
    const nq = q.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    const plain = (x: string): string => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    const appHits = apps.filter((a) => plain(a.name).includes(nq)).sort((a, b) => Number(!plain(a.name).startsWith(nq)) - Number(!plain(b.name).startsWith(nq))).slice(0, 5)
    const routineHits = routines.filter((r) => [r.name, ...r.triggers].some((g) => plain(g).includes(nq)))
    const shortcutHits = shortcuts.filter((x) => plain(x).includes(nq)).slice(0, 4)
    return [
      ...(cmd ? [{ title: 'COMANDO', items: [{ kind: 'cmd', cmd } as Item] }] : []),
      { title: 'ROTINAS', items: routineHits.map((routine) => ({ kind: 'routine', routine }) as Item) },
      { title: 'APPS', items: appHits.map((app) => ({ kind: 'app', app }) as Item) },
      { title: 'ATALHOS DO MACOS', items: shortcutHits.map((name) => ({ kind: 'shortcut', name }) as Item) },
      { title: 'SESSÕES', items: found.map(toItem) },
      { title: 'WORKSPACES', items: workspaces.filter((w) => matches(w.name.toLowerCase())).map((ws) => ({ kind: 'ws', ws }) as Item) },
      { title: 'NOVA SESSÃO COM ESTE PEDIDO', items: targets }
    ].filter((g) => g.items.length)
  }, [query, sessions, workspaces, active, apps, shortcuts, routines])

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
      case 'cmd':
        return void execute(item.cmd, fromVoice)
      case 'app':
        return void execute({ auto: { type: 'app', target: item.app.path }, say: `Abrindo ${item.app.name}.` }, fromVoice)
      case 'shortcut':
        return void execute({ auto: { type: 'shortcut', target: item.name }, say: `Rodando ${item.name}.` }, fromVoice)
      case 'routine':
        return void execute({ routine: item.routine, say: `Executando ${item.routine.name}.` }, fromVoice)
      case 'session':
        req = { type: 'session', id: item.s.id, send: sendText && text ? text : undefined, voice: fromVoice }
        break
      case 'ws':
        req = { type: 'workspace', id: item.ws.id }
        break
      case 'new':
        req = { type: 'new', cwd: item.cwd, workspaceId: item.workspaceId, text: text || undefined, voice: fromVoice }
        break
    }
    window.jarvis.navigate(req)
  }

  /** Executa um comando local: navegação, ação do Mac ou rotina. */
  async function execute(cmd: Command, spoken: boolean): Promise<void> {
    if (spoken) speak(cmd.say)
    if ('req' in cmd) return window.jarvis.navigate(cmd.req)
    window.jarvis.hidePalette()
    const results = 'routine' in cmd ? await window.jarvis.autoRunRoutine(cmd.routine.id) : [await window.jarvis.autoRun(cmd.auto as AutoAction)]
    const failed = results.find((r) => !r.ok)
    if (failed && spoken) speak('Não consegui concluir: ' + failed.output.slice(0, 120))
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
      if (listening) window.jarvis.voiceCancel()
      else if (query) setQuery('')
      else window.jarvis.hidePalette()
    }
  }

  let n = -1
  return (
    <div className="palette-root" onMouseDown={(e) => e.target === e.currentTarget && window.jarvis.hidePalette()}>
      <div className="panel palette">
        <div className={`p-input${listening ? ' listening' : ''}`}>
          <div className="p-reactor" style={{ transform: `scale(${1 + level * 0.35})` }}>
            <ArcReactor size={34} />
          </div>
          <input
            ref={input}
            autoFocus
            value={query}
            placeholder="Às suas ordens. Buscar sessão ou descrever uma tarefa…"
            onChange={(e) => {
              setQuery(e.target.value)
              setFromVoice(false)
            }}
            onKeyDown={onKey}
          />
          <button
            className={`p-mic${listening ? ' on' : ''}`}
            title={`Falar com o Jarvis (${window.jarvis.voiceShortcutLabel})`}
            onClick={() => (listening ? window.jarvis.voiceStop() : void startVoice())}
          >
            🎙
          </button>
          <span className="p-shortcut">{window.jarvis.shortcutLabel}</span>
        </div>
        {(listening || voiceError) && (
          <div className={`p-voice${voiceError ? ' err' : ''}`}>
            {voiceError ? (
              <>✕ {voiceError}</>
            ) : (
              <>
                <span className="p-wave">
                  {Array.from({ length: 24 }, (_, i) => (
                    <i key={i} style={{ height: `${4 + Math.abs(Math.sin(i * 1.7 + level * 9)) * level * 26}px` }} />
                  ))}
                </span>
                OUVINDO… <small>fale e pause para terminar · {window.jarvis.voiceShortcutLabel} encerra</small>
              </>
            )}
          </div>
        )}
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

/** A frase falada ("Abrindo X.") vira o rótulo da ação na lista ("Abrir X"). */
function actionLabel(say: string): string {
  return say
    .replace(/\.$/, '')
    .replace(/^Abrindo /, 'Abrir ')
    .replace(/^Executando /, 'Executar ')
    .replace(/^Rodando /, 'Rodar ')
    .replace(/^Apagando /, 'Apagar ')
    .replace(/^Volume em (\d+) por cento$/, 'Volume em $1%')
    .replace(/^Modo (escuro|claro) ativado$/, 'Ativar modo $1')
    .replace(/^Som desligado$/, 'Silenciar')
}

function ItemView({ item, hasText }: { item: Item; hasText: boolean }): React.JSX.Element {
  switch (item.kind) {
    case 'cmd':
      return (
        <>
          <span className="p-glyph">⚡</span>
          <span className="p-title">{actionLabel(item.cmd.say)}</span>
          <span className="p-meta">comando</span>
        </>
      )
    case 'app':
      return (
        <>
          <span className="p-glyph">▣</span>
          <span className="p-title">Abrir <b>{item.app.name}</b></span>
          <span className="p-meta">app</span>
        </>
      )
    case 'shortcut':
      return (
        <>
          <span className="p-glyph">⌘</span>
          <span className="p-title">Rodar atalho <b>{item.name}</b></span>
          <span className="p-meta">atalhos</span>
        </>
      )
    case 'routine':
      return (
        <>
          <span className="p-glyph">{item.routine.icon}</span>
          <span className="p-title">{item.routine.name}</span>
          <span className="p-meta">{item.routine.steps.length} passos</span>
        </>
      )
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
