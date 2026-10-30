// Renderiza build/icon.svg → build/icon.png (1024px, com transparência) usando o próprio Electron.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(__dirname, '../build/icon.svg'), 'utf8')
  const win = new BrowserWindow({ show: false })
  await win.loadURL('about:blank')
  const dataUrl = await win.webContents.executeJavaScript(`new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = c.height = 1024
      c.getContext('2d').drawImage(img, 0, 0, 1024, 1024)
      resolve(c.toDataURL('image/png'))
    }
    img.src = 'data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}'
  })`)
  fs.writeFileSync(path.join(__dirname, '../build/icon.png'), Buffer.from(dataUrl.split(',')[1], 'base64'))
  app.quit()
})
