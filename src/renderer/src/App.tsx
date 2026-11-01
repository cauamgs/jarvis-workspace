import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { NavRequest, SessionInfo, Workspace } from '@shared/types'
import { BootScreen } from './components/BootScreen'
import { ChatView } from './components/ChatView'
import { ArcReactor } from './components/ArcReactor'
import { SessionHeader } from './components/SessionHeader'
import { SessionList } from './components/SessionList'
import { Sidebar, type View } from './components/Sidebar'
import { TerminalView } from './components/TerminalView'
import { TopBar } from './components/TopBar'
import { WorkspaceModal } from './components/WorkspaceModal'
import { chatStore, useActiveChats } from './chatStore'
import { inWorkspace, uuid } from './lib'

interface TermSpec {
  cwd: string
  resumeId?: string
  newSessionId?: string
}

type Tab = 'chat' | 'terminal'

export default function App(): React.JSX.Element {
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [version, setVersion] = useState(0)
  const [view, setView] = useState<View>({ kind: 'all' })
  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('chat')
  const [terminals, setTerminals] = useState<Map<string, TermSpec>>(new Map())
  const [pending, setPending] = useState<Map<string, SessionInfo>>(new Map())
  const [modal, setModal] = useState<{ ws?: Workspace } | null>(null)
  const [liveWarn, setLiveWarn] = useState<string | null>(null)
  const activeChats = useActiveChats()
  /** Sessões com algo rodando dentro do Jarvis (terminal ou chat). */
  const inJarvis = useMemo(() => new Set([...terminals.keys(), ...activeChats]), [terminals, activeChats])

  const reload = useCallback(async () => {
    const list = await window.jarvis.listSessions()
    setSessions(list)
    setVersion((v) => v + 1)
  }, [])

  useEffect(() => {
    void reload()
    window.jarvis.listWorkspaces().then(setWorkspaces)
    // Reanexa terminais que sobreviveram a um reload da janela.
    window.jarvis.ptyActive().then((keys) => {
      if (keys.length) setTerminals(new Map(keys.map((k) => [k, { cwd: '' }])))
    })
    return window.jarvis.onSessionsChanged(() => void reload())
  }, [reload])

  // Sessão nova que ainda não apareceu no índice → some da lista de "pendentes" quando aparecer.
  useEffect(() => {
    if (!sessions || !pending.size) return
    const ids = new Set(sessions.map((s) => s.id))
    if ([...pending.keys()].some((k) => ids.has(k)))
      setPending((p) => new Map([...p].filter(([k]) => !ids.has(k))))
  }, [sessions, pending])

  const all = useMemo(() => {
    const indexed = sessions ?? []
    const ids = new Set(indexed.map((s) => s.id))
    // Uma sessão pendente some assim que o índice a encontra no disco.
    return [...[...pending.values()].filter((p) => !ids.has(p.id)), ...indexed]
  }, [sessions, pending])
  const active = useMemo(() => all.filter((s) => !s.archived), [all])

  const counts = useMemo(() => {
    const ws: Record<string, number> = {}
    for (const w of workspaces) ws[w.id] = active.filter((s) => inWorkspace(w, s)).length
    return {
      all: active.length,
      live: all.filter((s) => s.live || inJarvis.has(s.id)).length,
      unassigned: active.filter((s) => !workspaces.some((w) => inWorkspace(w, s))).length,
      ws
    }
  }, [all, active, workspaces, inJarvis])

  const currentWs = view.kind === 'ws' ? workspaces.find((w) => w.id === view.id) : undefined

  const visible = useMemo(() => {
    let list = view.kind === 'live' ? all.filter((s) => s.live || inJarvis.has(s.id)) : showArchived ? all : active
    if (view.kind === 'unassigned') list = list.filter((s) => !workspaces.some((w) => inWorkspace(w, s)))
    if (currentWs) list = list.filter((s) => inWorkspace(currentWs, s))
    const q = query.trim().toLowerCase()
    if (q)
      list = list.filter((s) =>
        [s.title, s.projectName, s.branch, s.firstPrompt, s.lastPrompt].some((f) => f?.toLowerCase().includes(q))
      )
    return list
  }, [view, all, active, showArchived, workspaces, currentWs, query, inJarvis])

  const selected = all.find((s) => s.id === selectedId) ?? null
  const projectPaths = useMemo(() => [...new Set((sessions ?? []).map((s) => s.projectPath))].sort(), [sessions])

  const listTitle =
    view.kind === 'all' ? 'Todas as sessões'
    : view.kind === 'live' ? 'Em execução'
    : view.kind === 'unassigned' ? 'Sem workspace'
    : currentWs?.name ?? ''

  function select(id: string): void {
    setSelectedId(id)
    setLiveWarn(null)
    setTab(terminals.has(id) ? 'terminal' : 'chat')
  }

  function openTerminal(s: SessionInfo, force = false): void {
    if (s.live && !inJarvis.has(s.id) && !force) {
      setLiveWarn(s.id)
      return
    }
    setLiveWarn(null)
    setTerminals((t) => new Map(t).set(s.id, { cwd: s.cwd || s.projectPath, resumeId: s.id }))
    setTab('terminal')
  }

  function closeTerminal(key: string): void {
    window.jarvis.ptyKill(key)
    setTerminals((t) => {
      const n = new Map(t)
      n.delete(key)
      return n
    })
    setTab('chat')
    void reload()
  }

  async function newSession(opts: { cwd?: string; workspaceId?: string; text?: string } = {}): Promise<void> {
    const wsId = opts.workspaceId ?? currentWs?.id
    const cwd =
      opts.cwd ??
      (currentWs?.autoPaths.length === 1 ? currentWs.autoPaths[0] : await window.jarvis.pickDirectory())
    if (!cwd) return
    const id = uuid()
    if (wsId) setWorkspaces(await window.jarvis.assignSession(wsId, id, true))
    const session: SessionInfo = {
      id,
      title: opts.text ? opts.text.slice(0, 80) : 'Nova sessão',
      source: 'cli',
      cwd,
      projectPath: cwd,
      projectName: cwd.split('/').pop() || cwd,
      messageCount: 0,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      archived: false,
      live: false,
      filePath: ''
    }
    setPending((p) => new Map(p).set(id, session))
    setSelectedId(id)
    setTab('chat')
    if (opts.text) await sendChat(session, opts.text)
  }

  /** Envia uma mensagem para o chat de uma sessão (usado pela busca rápida). */
  async function sendChat(s: SessionInfo, text: string): Promise<void> {
    const slot = chatStore.get(s.id)
    await window.jarvis.chatSend({
      key: s.id,
      cwd: s.cwd || s.projectPath,
      text,
      resumeId: s.filePath ? s.id : undefined,
      newSessionId: s.filePath ? undefined : s.id,
      permissionMode: slot.permissionMode,
      model: slot.model
    })
  }

  // Pedidos vindos da busca rápida, da barra de menu e das notificações.
  const visibleRef = useRef(visible)
  visibleRef.current = visible
  const allRef = useRef(all)
  allRef.current = all
  const navRef = useRef<(req: NavRequest) => Promise<void>>(async () => {})
  navRef.current = async (req) => {
    switch (req.type) {
      case 'show':
        return
      case 'workspace':
        setQuery('')
        setView({ kind: 'ws', id: req.id })
        return
      case 'new':
        if (req.workspaceId) setView({ kind: 'ws', id: req.workspaceId })
        await newSession({ cwd: req.cwd, workspaceId: req.workspaceId, text: req.text })
        return
      case 'session': {
        let s = allRef.current.find((x) => x.id === req.id)
        if (!s) s = (await window.jarvis.listSessions()).find((x) => x.id === req.id)
        if (!s) return
        if (!visibleRef.current.some((x) => x.id === req.id)) {
          setQuery('')
          setView({ kind: 'all' })
          if (s.archived) setShowArchived(true)
        }
        select(req.id)
        if (req.send) {
          if (terminals.has(req.id)) return
          setTab('chat')
          await sendChat(s, req.send)
        }
      }
    }
  }
  useEffect(() => window.jarvis.onNav((req) => void navRef.current(req)), [])

  async function assign(wsId: string, sessionId: string, assigned: boolean): Promise<void> {
    setWorkspaces(await window.jarvis.assignSession(wsId, sessionId, assigned))
  }

  const liveCount = all.filter((s) => s.live).length

  return (
    <>
      <div className="hud-bg" />
      <div className="app">
        <TopBar total={active.length} live={liveCount} terminals={terminals.size} workspaces={workspaces.length} />
        <div className="main">
          <Sidebar
            view={view}
            onView={setView}
            workspaces={workspaces}
            counts={counts}
            onNewWorkspace={() => setModal({})}
            onEditWorkspace={(ws) => setModal({ ws })}
            onDropSession={(wsId, sid) => void assign(wsId, sid, true)}
          />
          <SessionList
            title={listTitle}
            sessions={visible}
            workspaces={workspaces}
            selectedId={selectedId}
            terminals={inJarvis}
            onSelect={select}
            query={query}
            onQuery={setQuery}
            showArchived={showArchived}
            onToggleArchived={() => setShowArchived((v) => !v)}
            onNewSession={view.kind === 'ws' || view.kind === 'all' ? () => void newSession() : undefined}
          />
          <section className="panel">
            {selected ? (
              <>
                <SessionHeader
                  session={selected}
                  workspaces={workspaces}
                  hasTerminal={terminals.has(selected.id)}
                  hasChat={activeChats.has(selected.id)}
                  onOpenTerminal={() => openTerminal(selected)}
                  onCloseTerminal={() => closeTerminal(selected.id)}
                  onCloseChat={() => void window.jarvis.chatClose(selected.id)}
                  onRename={(title) => void window.jarvis.renameSession(selected.id, title).then(reload)}
                  onFork={async () => {
                    const r = await window.jarvis.forkSession(selected.id)
                    if (r.ok && r.sessionId) {
                      await reload()
                      select(r.sessionId)
                    }
                  }}
                  onToggleWorkspace={(wsId, on) => void assign(wsId, selected.id, on)}
                />
                {liveWarn === selected.id && (
                  <div className="warn">
                    ⚠ Esta sessão já está aberta em outro lugar (Claude Desktop ou outro terminal). Continuar aqui ao mesmo
                    tempo pode gerar históricos divergentes.{' '}
                    <button className="btn sm" style={{ marginLeft: 8 }} onClick={() => openTerminal(selected, true)}>
                      Continuar mesmo assim
                    </button>
                  </div>
                )}
                {tab === 'chat' && selected.live && !inJarvis.has(selected.id) && (
                  <div className="warn">
                    ⚠ Esta sessão está aberta em outro lugar (Claude Desktop ou terminal). Enviar mensagens daqui ao mesmo
                    tempo pode gerar históricos divergentes.
                  </div>
                )}
                <div className="tabs">
                  <button className={`tab${tab === 'chat' ? ' on' : ''}`} onClick={() => setTab('chat')}>
                    Chat
                    {activeChats.has(selected.id) && <span className="live-dot term" style={{ marginTop: 0 }} />}
                  </button>
                  <button
                    className={`tab${tab === 'terminal' ? ' on' : ''}`}
                    onClick={() => (terminals.has(selected.id) ? setTab('terminal') : openTerminal(selected))}
                  >
                    Terminal
                    {terminals.has(selected.id) && <span className="live-dot term" style={{ marginTop: 0 }} />}
                  </button>
                </div>
                {tab === 'chat' &&
                  (terminals.has(selected.id) ? (
                    <div className="empty">Sessão aberta no terminal do Jarvis — encerre o terminal para usar o chat</div>
                  ) : (
                    <ChatView
                      session={selected}
                      version={version}
                      onOpenSession={(id) => void reload().then(() => select(id))}
                    />
                  ))}
              </>
            ) : (
              <div className="idle">
                <div>
                  <ArcReactor size={180} />
                  <h2>AGUARDANDO INSTRUÇÕES</h2>
                  <p>Selecione uma sessão ou arraste-a para um workspace.</p>
                </div>
              </div>
            )}
            {[...terminals].map(([key, spec]) => (
              <TerminalView
                key={key}
                termKey={key}
                cwd={spec.cwd}
                resumeId={spec.resumeId}
                newSessionId={spec.newSessionId}
                visible={selected?.id === key && tab === 'terminal'}
                onClose={() => closeTerminal(key)}
              />
            ))}
          </section>
        </div>
        <footer className="statusbar">
          <span className="ok">● SISTEMAS NOMINAIS</span>
          <span>Fontes: Claude Desktop + Claude Code CLI</span>
          <span className="marquee">Índice somente leitura · ~/.claude/projects</span>
          <span>v0.1.0</span>
        </footer>
      </div>

      {modal && (
        <WorkspaceModal
          initial={modal.ws}
          projectPaths={projectPaths}
          onClose={() => setModal(null)}
          onSave={async (ws) => {
            setWorkspaces(await window.jarvis.saveWorkspace(ws))
            setModal(null)
            if (!modal.ws) setView({ kind: 'ws', id: ws.id })
          }}
          onDelete={async (id) => {
            setWorkspaces(await window.jarvis.deleteWorkspace(id))
            setModal(null)
            if (view.kind === 'ws' && view.id === id) setView({ kind: 'all' })
          }}
        />
      )}
      <BootScreen ready={sessions !== null} />
    </>
  )
}
