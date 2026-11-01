import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Notification, shell } from 'electron'
import { mkdirSync, promises as fsp, watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { ChatManager, forkSession, renameSession } from './chat'
import { DESKTOP_DIR, PROJECTS_DIR, readTranscript, SessionIndexer } from './indexer'
import { Palette } from './palette'
import { PtyManager } from './pty'
import { WorkspaceStore } from './store'
import * as system from './system'
import * as projects from './projects'
import { JarvisTray } from './tray'
import type {
  ChatEvent,
  ChatImage,
  ChatSendOptions,
  EffortLevel,
  NavRequest,
  PermissionMode,
  PermissionResponse,
  SessionInfo,
  Workspace
} from '@shared/types'

let win: BrowserWindow | null = null
let quitting = false
// A versão de desenvolvimento usa dados e atalho próprios para rodar ao lado do app instalado.
if (!app.isPackaged) app.setPath('userData', app.getPath('userData') + ' (dev)')
const SHORTCUT = app.isPackaged ? 'CommandOrControl+Shift+J' : 'CommandOrControl+Alt+Shift+J'
const SHORTCUT_LABEL = app.isPackaged ? '⇧⌘J' : '⌥⇧⌘J'
let shortcutOk = false

const userData = app.getPath('userData')
mkdirSync(userData, { recursive: true })
const indexer = new SessionIndexer(join(userData, 'session-index.json'))
const store = new WorkspaceStore(join(userData, 'workspaces.json'))
const ptys = new PtyManager(
  (key, data) => win?.webContents.send('pty:data', key, data),
  (key, code) => win?.webContents.send('pty:exit', key, code)
)
const chats = new ChatManager(onChatEvent)
const palette = new Palette(() => !!win?.isVisible())
const tray = new JarvisTray({
  state: () => ({
    sessions,
    workspaces: store.list(),
    inJarvis: new Set([...chats.active(), ...ptys.keys()]),
    pending: new Map([...pending].map(([k, ids]) => [k, ids.size])),
    shortcut: SHORTCUT_LABEL,
    shortcutOk
  }),
  showMain,
  showPalette: () => palette.show(),
  nav
})
const watchers: FSWatcher[] = []

/** Último índice conhecido — alimenta a barra de menu e os títulos das notificações. */
let sessions: SessionInfo[] = []
/** Pedidos de permissão em aberto, por sessão. */
const pending = new Map<string, Set<string>>()

async function refreshSessions(): Promise<SessionInfo[]> {
  const titles = store.titles()
  sessions = (await indexer.listSessions()).map((s) => (titles[s.id] ? { ...s, title: titles[s.id] } : s))
  return sessions
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 680,
    backgroundColor: '#02070d',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })
  win.once('ready-to-show', () => win?.show())
  // Links (ex.: no Markdown do chat) abrem no navegador, nunca dentro do app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win?.webContents.getURL()) {
      e.preventDefault()
      if (/^https?:/.test(url)) void shell.openExternal(url)
    }
  })
  // Fechar só esconde: chats e terminais continuam rodando; o Jarvis fica na barra de menu.
  win.on('close', (e) => {
    if (quitting) return
    e.preventDefault()
    win?.hide()
  })
  win.on('closed', () => (win = null))
  win.on('focus', () => updateAttention())

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

function showMain(): void {
  if (!win) createWindow()
  if (win!.isMinimized()) win!.restore()
  win!.show()
  win!.focus()
  app.focus({ steal: true })
}

/** Abre a janela principal e pede para ela navegar (sessão, workspace, nova sessão). */
function nav(req: NavRequest): void {
  showMain()
  if (req.type === 'show') return
  const send = (): void => win?.webContents.send('nav', req)
  if (win!.webContents.isLoading()) win!.webContents.once('did-finish-load', send)
  else send()
}

function titleOf(key: string): string {
  return sessions.find((s) => s.id === key)?.title ?? 'Nova sessão'
}

function notify(title: string, body: string, key: string): void {
  if (!Notification.isSupported()) return
  const n = new Notification({ title, body, silent: false })
  n.on('click', () => nav({ type: 'session', id: key }))
  n.show()
}

/** Encaminha eventos do chat para a interface e avisa o usuário quando ele não está olhando. */
function onChatEvent(key: string, ev: ChatEvent): void {
  win?.webContents.send('chat:event', key, ev)
  const away = !win?.isVisible() || !win.isFocused()
  if (ev.type === 'permission') {
    pending.set(key, (pending.get(key) ?? new Set()).add(ev.request.id))
    updateAttention()
    if (away) notify('Claude precisa de permissão', `${titleOf(key)} — ${ev.request.title}`, key)
  } else if (ev.type === 'permission-done') {
    pending.get(key)?.delete(ev.id)
    if (!pending.get(key)?.size) pending.delete(key)
    updateAttention()
  } else if (ev.type === 'state' && ev.state !== 'running' && ev.state !== 'starting' && !chats.has(key)) {
    // Processo encerrado: nenhuma permissão pode continuar pendente.
    if (pending.delete(key)) updateAttention()
  } else if (ev.type === 'result' && away) {
    notify(ev.isError ? 'Claude encontrou um erro' : 'Claude concluiu', titleOf(key), key)
  }
}

/** Contador de permissões pendentes na barra de menu e no Dock. */
function updateAttention(): void {
  let total = 0
  for (const ids of pending.values()) total += ids.size
  tray.setPending(total)
  app.dock?.setBadge(total ? String(total) : '')
}

function watchSessions(): void {
  let timer: NodeJS.Timeout | null = null
  const changed = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      win?.webContents.send('sessions:changed')
      void refreshSessions()
    }, 1500)
  }
  for (const dir of [PROJECTS_DIR, DESKTOP_DIR, join(PROJECTS_DIR, '..', 'sessions')]) {
    try {
      watchers.push(watch(dir, { recursive: true }, changed))
    } catch {
      /* diretório ainda não existe */
    }
  }
}

function registerIpc(): void {
  ipcMain.handle('sessions:list', () => refreshSessions())
  ipcMain.handle('sessions:transcript', async (_e, id: string) => {
    const file = sessions.find((s) => s.id === id)?.filePath
    return file ? readTranscript(file) : []
  })

  ipcMain.handle('ws:list', () => store.list())
  ipcMain.handle('ws:save', (_e, ws: Workspace) => store.save(ws))
  ipcMain.handle('ws:delete', (_e, id: string) => store.remove(id))
  ipcMain.handle('ws:assign', (_e, wsId: string, sessionId: string, assigned: boolean) =>
    store.assign(wsId, sessionId, assigned)
  )

  ipcMain.handle('pty:start', (_e, o: { key: string; cwd: string; resumeId?: string; newSessionId?: string }) => {
    // Chat e terminal na mesma sessão ao mesmo tempo gerariam históricos divergentes.
    chats.close(o.key)
    try {
      return { ok: true, ...ptys.start(o.key, o.cwd, o.resumeId, o.newSessionId) }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })
  ipcMain.handle('pty:active', () => ptys.keys())
  ipcMain.on('pty:write', (_e, key: string, data: string) => ptys.write(key, data))
  ipcMain.on('pty:resize', (_e, key: string, cols: number, rows: number) => ptys.resize(key, cols, rows))
  ipcMain.on('pty:kill', (_e, key: string) => ptys.kill(key))

  ipcMain.handle('chat:send', (_e, o: ChatSendOptions) => {
    if (ptys.has(o.key)) return { ok: false, error: 'Esta sessão está aberta no terminal do Jarvis. Encerre o terminal primeiro.' }
    return chats.send(o)
  })
  ipcMain.handle('chat:interrupt', (_e, key: string) => chats.interrupt(key))
  ipcMain.handle('chat:close', (_e, key: string) => chats.close(key))
  ipcMain.handle('chat:setPermissionMode', (_e, key: string, mode: PermissionMode) => chats.setPermissionMode(key, mode))
  ipcMain.handle('chat:setModel', (_e, key: string, model: string) => chats.setModel(key, model))
  ipcMain.handle('chat:active', () => chats.active())
  ipcMain.handle('chat:info', (_e, key: string) => chats.info(key))
  ipcMain.on('chat:permission', (_e, key: string, id: string, r: PermissionResponse) =>
    chats.respondPermission(key, id, r)
  )
  ipcMain.handle('chat:setEffort', (_e, key: string, effort: EffortLevel) => chats.setEffort(key, effort))
  ipcMain.handle('chat:rewind', (_e, key: string, msgId: string, dryRun: boolean) => chats.rewind(key, msgId, dryRun))
  ipcMain.handle('chat:mcpStatus', (_e, key: string) => chats.mcpStatus(key))
  ipcMain.handle('chat:mcpToggle', (_e, key: string, name: string, on: boolean) => chats.mcpToggle(key, name, on))
  ipcMain.handle('chat:mcpReconnect', (_e, key: string, name: string) => chats.mcpReconnect(key, name))

  ipcMain.handle('session:fork', async (_e, id: string, upTo?: string) => {
    const r = await forkSession(id, upTo)
    if (r.ok && r.sessionId) {
      const base = sessions.find((s) => s.id === id)
      // A cópia herda os workspaces da original.
      for (const ws of store.list()) if (ws.sessionIds.includes(id)) await store.assign(ws.id, r.sessionId, true)
      if (base) await store.setTitle(r.sessionId, `${base.title} (ramificação)`)
    }
    return r
  })
  ipcMain.handle('session:rename', async (_e, id: string, title: string) => {
    await store.setTitle(id, title)
    // Sessões do terminal também recebem o título no transcript (visível no `claude --resume`).
    if (sessions.find((s) => s.id === id)?.source === 'cli') await renameSession(id, title).catch(() => undefined)
    await refreshSessions()
    win?.webContents.send('sessions:changed')
  })

  ipcMain.handle('sys:pickImages', async (): Promise<ChatImage[]> => {
    const r = await dialog.showOpenDialog(win!, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }]
    })
    if (r.canceled) return []
    return Promise.all(
      r.filePaths.map(async (f) => {
        const ext = f.split('.').pop()!.toLowerCase()
        const mediaType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
        return { mediaType, data: (await fsp.readFile(f)).toString('base64'), name: f.split('/').pop() }
      })
    )
  })

  ipcMain.on('nav:request', (_e, req: NavRequest) => {
    nav(req)
    palette.hide()
  })
  ipcMain.on('palette:hide', () => palette.hide())
  ipcMain.on('palette:show', () => palette.show())
  ipcMain.on('sys:shortcutLabel', (e) => (e.returnValue = SHORTCUT_LABEL))

  ipcMain.handle('sys:snapshot', () => system.snapshot())
  ipcMain.handle('sys:ports', () => system.listeningPorts())
  ipcMain.handle('sys:processes', () => system.processes())
  ipcMain.handle('sys:kill', (_e, pid: number, force: boolean) => system.killProcess(pid, force))
  ipcMain.handle('sys:docker', () => system.docker())
  ipcMain.handle('sys:dockerAction', (_e, id: string, a: 'start' | 'stop' | 'restart') => system.dockerAction(id, a))
  ipcMain.handle('sys:dockerLogs', (_e, id: string) => system.dockerLogs(id))
  ipcMain.handle('sys:startDocker', () => system.startDockerEngine())
  ipcMain.on('sys:openExternal', (_e, url: string) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
  })

  // Projetos: repositórios das raízes padrão + pastas das sessões + pastas vinculadas aos workspaces.
  ipcMain.handle('proj:list', async () => {
    const extra = [...new Set([...sessions.map((s) => s.projectPath), ...store.list().flatMap((w) => w.autoPaths)])]
    return projects.listProjects(await projects.discoverRepos(projects.DEFAULT_ROOTS, extra))
  })
  ipcMain.handle('proj:detail', (_e, p: string) => projects.projectDetail(p))
  ipcMain.handle('proj:fileDiff', (_e, p: string, f: string, c: string) => projects.fileDiff(p, f, c))
  ipcMain.handle('proj:commitDiff', (_e, p: string, h: string) => projects.commitDiff(p, h))
  ipcMain.handle('proj:action', (_e, p: string, a: 'fetch' | 'pull') => projects.gitAction(p, a))
  ipcMain.handle('proj:checkout', (_e, p: string, b: string) => projects.checkout(p, b))
  ipcMain.on('proj:open', (_e, p: string, app: 'finder' | 'terminal' | 'vscode') => projects.openWith(p, app))

  ipcMain.handle('sys:pickDirectory', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.on('sys:openInFinder', (_e, p: string) => shell.openPath(p))
}

// Abrir o app de novo só traz a janela existente para frente.
if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => showMain())

app.whenReady().then(async () => {
  app.setName('Jarvis WorkSpace')
  await Promise.all([indexer.load(), store.load()])
  registerIpc()
  createWindow()
  palette.create()
  // Garante o modo normal de app: ícone no Dock, menu e ⌘Tab.
  app.setActivationPolicy('regular')
  void app.dock?.show()
  tray.create()
  shortcutOk = globalShortcut.register(SHORTCUT, () => palette.toggle())
  if (!shortcutOk) console.warn(`Atalho ${SHORTCUT} indisponível (em uso por outro app).`)
  watchSessions()
  void refreshSessions()
  app.on('activate', () => showMain())
})

app.on('before-quit', () => {
  quitting = true
  ptys.killAll()
  chats.closeAll()
  watchers.forEach((w) => w.close())
  void indexer.persist()
})

app.on('will-quit', () => globalShortcut.unregisterAll())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
