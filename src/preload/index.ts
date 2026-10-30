import { contextBridge, ipcRenderer } from 'electron'
import { homedir } from 'node:os'
import type { JarvisApi } from '@shared/types'

function subscribe<T extends unknown[]>(channel: string, cb: (...args: T) => void): () => void {
  const listener = (_e: unknown, ...args: unknown[]): void => cb(...(args as T))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: JarvisApi = {
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  getTranscript: (id) => ipcRenderer.invoke('sessions:transcript', id),
  onSessionsChanged: (cb) => subscribe('sessions:changed', cb),

  listWorkspaces: () => ipcRenderer.invoke('ws:list'),
  saveWorkspace: (ws) => ipcRenderer.invoke('ws:save', ws),
  deleteWorkspace: (id) => ipcRenderer.invoke('ws:delete', id),
  assignSession: (wsId, sId, assigned) => ipcRenderer.invoke('ws:assign', wsId, sId, assigned),

  ptyStart: (o) => ipcRenderer.invoke('pty:start', o),
  ptyActive: () => ipcRenderer.invoke('pty:active'),
  ptyWrite: (k, d) => ipcRenderer.send('pty:write', k, d),
  ptyResize: (k, c, r) => ipcRenderer.send('pty:resize', k, c, r),
  ptyKill: (k) => ipcRenderer.send('pty:kill', k),
  onPtyData: (cb) => subscribe('pty:data', cb),
  onPtyExit: (cb) => subscribe('pty:exit', cb),

  chatSend: (o) => ipcRenderer.invoke('chat:send', o),
  chatInterrupt: (k) => ipcRenderer.invoke('chat:interrupt', k),
  chatClose: (k) => ipcRenderer.invoke('chat:close', k),
  chatSetPermissionMode: (k, m) => ipcRenderer.invoke('chat:setPermissionMode', k, m),
  chatSetModel: (k, m) => ipcRenderer.invoke('chat:setModel', k, m),
  chatRespondPermission: (k, id, d) => ipcRenderer.send('chat:permission', k, id, d),
  chatActive: () => ipcRenderer.invoke('chat:active'),
  chatInfo: (k) => ipcRenderer.invoke('chat:info', k),
  onChatEvent: (cb) => subscribe('chat:event', cb),

  onNav: (cb) => subscribe('nav', cb),
  navigate: (req) => ipcRenderer.send('nav:request', req),
  hidePalette: () => ipcRenderer.send('palette:hide'),
  showPalette: () => ipcRenderer.send('palette:show'),
  onPaletteShown: (cb) => subscribe('palette:shown', cb),
  shortcutLabel: ipcRenderer.sendSync('sys:shortcutLabel'),

  pickDirectory: () => ipcRenderer.invoke('sys:pickDirectory'),
  openInFinder: (p) => ipcRenderer.send('sys:openInFinder', p),
  homeDir: homedir()
}

contextBridge.exposeInMainWorld('jarvis', api)
