import type { SessionInfo, Workspace } from '@shared/types'

export const WS_COLORS = ['#00e5ff', '#3dffb0', '#ffb627', '#ff3b5c', '#b98bff', '#4d8dff', '#ff7ad9', '#e8f0f2']
export const WS_ICONS = ['◆', '⬢', '▲', '●', '✦', '⌘', '⚡', '☢', '⚙', '✪', '◈', '⟁']

export function inWorkspace(ws: Workspace, s: SessionInfo): boolean {
  return ws.sessionIds.includes(s.id) || ws.autoPaths.some((p) => s.projectPath === p || s.projectPath.startsWith(p + '/'))
}

export function timeAgo(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 60) return 'agora'
  if (s < 3600) return `${Math.floor(s / 60)} min`
  if (s < 86400) return `${Math.floor(s / 3600)} h`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d`
  return new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

export function dayGroup(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = (today.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000
  if (diff <= 0) return 'HOJE'
  if (diff === 1) return 'ONTEM'
  if (diff < 7) return 'ESTA SEMANA'
  if (diff < 31) return 'ESTE MÊS'
  return 'ANTERIORES'
}

export function shortPath(p: string, home: string): string {
  return p.startsWith(home) ? '~' + p.slice(home.length) : p
}

export function uuid(): string {
  return crypto.randomUUID()
}
