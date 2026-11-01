import { app, BrowserWindow, screen } from 'electron'
import { join } from 'node:path'

const WIDTH = 720
const HEIGHT = 500

/**
 * Busca rápida flutuante (estilo Spotlight), aberta pelo atalho global.
 * É um NSPanel: aparece por cima de apps em tela cheia sem trazer a janela principal junto.
 */
export class Palette {
  private win: BrowserWindow | null = null

  constructor(private isMainVisible: () => boolean) {}

  create(): void {
    const win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      type: 'panel',
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        contextIsolation: true
      }
    })
    win.setAlwaysOnTop(true, 'pop-up-menu')
    // skipTransformProcessType: sem isso o Electron transforma o app inteiro em "UIElement"
    // (sem ícone no Dock, sem menu, fora do ⌘Tab) para a janela aparecer sobre apps em tela cheia.
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
    win.on('blur', () => this.hide())
    win.on('closed', () => (this.win = null))

    if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL + '#palette')
    else win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'palette' })
    this.win = win
  }

  toggle(): void {
    if (this.win?.isVisible()) this.hide()
    else this.show()
  }

  show(): void {
    if (!this.win) this.create()
    const win = this.win!
    // Abre na tela onde está o cursor, no terço superior.
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    win.setPosition(
      Math.round(workArea.x + (workArea.width - WIDTH) / 2),
      Math.round(workArea.y + workArea.height * 0.18)
    )
    win.webContents.send('palette:shown')
    win.show()
    win.focus()
  }

  hide(): void {
    if (!this.win?.isVisible()) return
    this.win.hide()
    // Sem a janela principal à vista, devolve o foco ao app que o usuário estava usando.
    if (!this.isMainVisible()) app.hide()
  }
}
