import { app, Menu, nativeImage, Tray, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import type { NavRequest, SessionInfo, Workspace } from '@shared/types'

export interface TrayState {
  sessions: SessionInfo[]
  workspaces: Workspace[]
  /** Sessões com processo rodando dentro do Jarvis (chat ou terminal). */
  inJarvis: Set<string>
  /** Sessões aguardando aprovação de permissão → quantidade. */
  pending: Map<string, number>
  shortcut: string
  shortcutOk: boolean
}

interface Actions {
  state: () => TrayState
  showMain: () => void
  showPalette: () => void
  nav: (req: NavRequest) => void
}

const MAX_TITLE = 42

function label(s: SessionInfo): string {
  const t = s.title.length > MAX_TITLE ? s.title.slice(0, MAX_TITLE - 1) + '…' : s.title
  return `${t}  ·  ${s.projectName}`
}

/** Ícone do reator na barra de menu do macOS. O menu é montado na hora do clique, sempre atualizado. */
export class JarvisTray {
  private tray: Tray | null = null

  constructor(private a: Actions) {}

  create(): void {
    const dir = app.isPackaged ? process.resourcesPath : join(__dirname, '../../resources')
    const icon = nativeImage.createFromPath(join(dir, 'trayTemplate.png'))
    icon.setTemplateImage(true)
    this.tray = new Tray(icon)
    this.tray.setToolTip('Jarvis WorkSpace')
    const open = (): void => this.tray?.popUpContextMenu(this.menu())
    this.tray.on('click', open)
    this.tray.on('right-click', open)
  }

  /** Mostra quantas permissões aguardam o usuário ao lado do ícone. */
  setPending(count: number): void {
    this.tray?.setTitle(count ? ` ${count}` : '', { fontType: 'monospacedDigit' })
  }

  private menu(): Menu {
    const st = this.a.state()
    const byId = new Map(st.sessions.map((s) => [s.id, s]))
    const open = (id: string) => () => this.a.nav({ type: 'session', id })
    const items: MenuItemConstructorOptions[] = [
      { label: 'Abrir Jarvis', click: this.a.showMain },
      {
        label: st.shortcutOk ? `Busca rápida        ${st.shortcut}` : 'Busca rápida  (atalho indisponível)',
        click: this.a.showPalette
      }
    ]

    const pending = [...st.pending.keys()].map((id) => byId.get(id)).filter((s): s is SessionInfo => !!s)
    if (pending.length) {
      items.push({ type: 'separator' }, { label: 'PRECISA DE VOCÊ', enabled: false })
      for (const s of pending) items.push({ label: `⚠  ${label(s)}`, click: open(s.id) })
    }

    const running = st.sessions.filter((s) => (s.live || st.inJarvis.has(s.id)) && !st.pending.has(s.id))
    if (running.length) {
      items.push({ type: 'separator' }, { label: 'EM EXECUÇÃO', enabled: false })
      for (const s of running.slice(0, 8))
        items.push({ label: `${st.inJarvis.has(s.id) ? '◆' : '●'}  ${label(s)}`, click: open(s.id) })
    }

    const recent = st.sessions.filter((s) => !s.archived && !running.includes(s) && !st.pending.has(s.id)).slice(0, 6)
    if (recent.length) {
      items.push({ type: 'separator' }, { label: 'RECENTES', enabled: false })
      for (const s of recent) items.push({ label: label(s), click: open(s.id) })
    }

    items.push({ type: 'separator' })
    items.push({
      label: 'Workspaces',
      enabled: st.workspaces.length > 0,
      submenu: st.workspaces.map((w) => ({
        label: `${w.icon}  ${w.name}`,
        click: () => this.a.nav({ type: 'workspace', id: w.id })
      }))
    })

    items.push(
      { type: 'separator' },
      {
        label: 'Iniciar com o macOS',
        type: 'checkbox',
        enabled: app.isPackaged,
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked })
      },
      { label: 'Sair do Jarvis', accelerator: 'Command+Q', click: () => app.quit() }
    )
    return Menu.buildFromTemplate(items)
  }
}
