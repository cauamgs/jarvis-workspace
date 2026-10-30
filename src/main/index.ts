import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { mkdirSync, watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { ChatManager } from './chat'
import { DESKTOP_DIR, PROJECTS_DIR, readTranscript, SessionIndexer } from './indexer'
import { PtyManager } from './pty'
import { WorkspaceStore } from './store'
import type { ChatSendOptions, PermissionMode, Workspace } from '@shared/types'

let win: BrowserWindow | null = null
// A versão de desenvolvimento usa dados próprios para rodar ao lado do app instalado.
if (!app.isPackaged) app.setPath('userData', app.getPath('userData') + ' (dev)')
const userData = app.getPath('userData')
mkdirSync(userData, { recursive: true })
const indexer = new SessionIndexer(join(userData, 'session-index.json'))
const store = new WorkspaceStore(join(userData, 'workspaces.json'))
const ptys = new PtyManager(
  (key, data) => win?.webContents.send('pty:data', key, data),
  (key, code) => win?.webContents.send('pty:exit', key, code)
)
const chats = new ChatManager((key, ev) => win?.webContents.send('chat:event', key, ev))
const watchers: FSWatcher[] = []

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
  win.on('closed', () => (win = null))

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

function watchSessions(): void {
  let timer: NodeJS.Timeout | null = null
  const notify = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => win?.webContents.send('sessions:changed'), 1500)
  }
  for (const dir of [PROJECTS_DIR, DESKTOP_DIR, join(PROJECTS_DIR, '..', 'sessions')]) {
    try {
      watchers.push(watch(dir, { recursive: true }, notify))
    } catch {
      /* diretório ainda não existe */
    }
  }
}

function registerIpc(): void {
  let sessionsCache = new Map<string, string>()

  ipcMain.handle('sessions:list', async () => {
    const list = await indexer.listSessions()
    sessionsCache = new Map(list.map((s) => [s.id, s.filePath]))
    return list
  })
  ipcMain.handle('sessions:transcript', async (_e, id: string) => {
    const file = sessionsCache.get(id)
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

  ipcMain.handle('sys:pickDirectory', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.on('sys:openInFinder', (_e, p: string) => shell.openPath(p))
}

// Abrir o app de novo só traz a janela existente para frente.
if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.focus()
})

app.whenReady().then(async () => {
  app.setName('Jarvis WorkSpace')
  await Promise.all([indexer.load(), store.load()])
  registerIpc()
  createWindow()
  watchSessions()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  ptys.killAll()
  chats.closeAll()
  watchers.forEach((w) => w.close())
  void indexer.persist()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
