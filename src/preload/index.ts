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
  chatRespondPermission: (k, id, r) => ipcRenderer.send('chat:permission', k, id, r),
  chatSetEffort: (k, e) => ipcRenderer.invoke('chat:setEffort', k, e),
  chatRewind: (k, id, dry) => ipcRenderer.invoke('chat:rewind', k, id, dry),
  chatMcpStatus: (k) => ipcRenderer.invoke('chat:mcpStatus', k),
  chatMcpToggle: (k, n, on) => ipcRenderer.invoke('chat:mcpToggle', k, n, on),
  chatMcpReconnect: (k, n) => ipcRenderer.invoke('chat:mcpReconnect', k, n),
  forkSession: (id, upTo) => ipcRenderer.invoke('session:fork', id, upTo),
  renameSession: (id, t) => ipcRenderer.invoke('session:rename', id, t),
  pickImages: () => ipcRenderer.invoke('sys:pickImages'),
  chatActive: () => ipcRenderer.invoke('chat:active'),
  chatInfo: (k) => ipcRenderer.invoke('chat:info', k),
  onChatEvent: (cb) => subscribe('chat:event', cb),

  onNav: (cb) => subscribe('nav', cb),
  navigate: (req) => ipcRenderer.send('nav:request', req),
  hidePalette: () => ipcRenderer.send('palette:hide'),
  showPalette: () => ipcRenderer.send('palette:show'),
  onPaletteShown: (cb) => subscribe('palette:shown', cb),
  shortcutLabel: ipcRenderer.sendSync('sys:shortcutLabel'),
  voiceShortcutLabel: ipcRenderer.sendSync('sys:voiceShortcutLabel'),
  voiceStart: () => ipcRenderer.invoke('voice:start'),
  voiceStop: () => ipcRenderer.send('voice:stop'),
  voiceCancel: () => ipcRenderer.send('voice:cancel'),
  onVoiceEvent: (cb) => subscribe('voice:event', cb),
  onPaletteVoice: (cb) => subscribe('palette:voice', cb),

  sysSnapshot: () => ipcRenderer.invoke('sys:snapshot'),
  sysPorts: () => ipcRenderer.invoke('sys:ports'),
  sysProcesses: () => ipcRenderer.invoke('sys:processes'),
  sysKill: (pid, force) => ipcRenderer.invoke('sys:kill', pid, force),
  sysDocker: () => ipcRenderer.invoke('sys:docker'),
  sysDockerAction: (id, a) => ipcRenderer.invoke('sys:dockerAction', id, a),
  sysDockerLogs: (id) => ipcRenderer.invoke('sys:dockerLogs', id),
  sysStartDocker: () => ipcRenderer.invoke('sys:startDocker'),
  openExternal: (url) => ipcRenderer.send('sys:openExternal', url),
  projList: () => ipcRenderer.invoke('proj:list'),
  projDetail: (p) => ipcRenderer.invoke('proj:detail', p),
  projFileDiff: (p, f, c) => ipcRenderer.invoke('proj:fileDiff', p, f, c),
  projCommitDiff: (p, h) => ipcRenderer.invoke('proj:commitDiff', p, h),
  projAction: (p, a) => ipcRenderer.invoke('proj:action', p, a),
  projCheckout: (p, b) => ipcRenderer.invoke('proj:checkout', p, b),
  projOpen: (p, app) => ipcRenderer.send('proj:open', p, app),

  autoApps: () => ipcRenderer.invoke('auto:apps'),
  autoShortcuts: () => ipcRenderer.invoke('auto:shortcuts'),
  autoRun: (a) => ipcRenderer.invoke('auto:run', a),
  autoRoutines: () => ipcRenderer.invoke('auto:routines'),
  autoSaveRoutine: (r) => ipcRenderer.invoke('auto:saveRoutine', r),
  autoDeleteRoutine: (id) => ipcRenderer.invoke('auto:deleteRoutine', id),
  autoRunRoutine: (id) => ipcRenderer.invoke('auto:runRoutine', id),

  pickDirectory: () => ipcRenderer.invoke('sys:pickDirectory'),
  openInFinder: (p) => ipcRenderer.send('sys:openInFinder', p),
  homeDir: homedir()
}

contextBridge.exposeInMainWorld('jarvis', api)
