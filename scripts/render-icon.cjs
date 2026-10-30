// Renderiza os ícones SVG em PNG (com transparência) usando o próprio Electron:
//   build/icon.svg      → build/icon.png (1024px, ícone do app)
//   resources/tray.svg  → resources/trayTemplate.png (18px) e @2x (36px), ícone da barra de menu
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const jobs = [
  ['build/icon.svg', 'build/icon.png', 1024],
  ['resources/tray.svg', 'resources/trayTemplate.png', 18],
  ['resources/tray.svg', 'resources/trayTemplate@2x.png', 36]
]

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false })
  await win.loadURL('about:blank')
  for (const [src, dest, size] of jobs) {
    const svg = Buffer.from(fs.readFileSync(path.join(root, src))).toString('base64')
    const dataUrl = await win.webContents.executeJavaScript(`new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        const c = document.createElement('canvas')
        c.width = c.height = ${size}
        c.getContext('2d').drawImage(img, 0, 0, ${size}, ${size})
        resolve(c.toDataURL('image/png'))
      }
      img.src = 'data:image/svg+xml;base64,${svg}'
    })`)
    fs.writeFileSync(path.join(root, dest), Buffer.from(dataUrl.split(',')[1], 'base64'))
    console.log('✔', dest)
  }
  app.quit()
})
