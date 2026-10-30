import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Notification, shell } from 'electron'
import { mkdirSync, watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { ChatManager } from './chat'
import { DESKTOP_DIR, PROJECTS_DIR, readTranscript, SessionIndexer } from './indexer'
import { Palette } from './palette'
import { PtyManager } from './pty'
import { WorkspaceStore } from './store'
import { JarvisTray } from './tray'
import type { ChatEvent, ChatSendOptions, NavRequest, PermissionMode, SessionInfo, Workspace } from '@shared/types'

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
  sessions = await indexer.listSessions()
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
    vibrancy: 'under-window',
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
  ipcMain.on('chat:permission', (_e, key: string, id: string, decision: 'allow' | 'always' | 'deny') =>
    chats.respondPermission(key, id, decision)
  )

  ipcMain.on('nav:request', (_e, req: NavRequest) => {
    nav(req)
    palette.hide()
  })
  ipcMain.on('palette:hide', () => palette.hide())
  ipcMain.on('palette:show', () => palette.show())
  ipcMain.on('sys:shortcutLabel', (e) => (e.returnValue = SHORTCUT_LABEL))

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
