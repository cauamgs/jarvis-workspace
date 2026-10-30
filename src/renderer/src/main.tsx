import { createRoot } from 'react-dom/client'
import '@fontsource/orbitron/400.css'
import '@fontsource/orbitron/500.css'
import '@fontsource/orbitron/700.css'
import '@fontsource/rajdhani/500.css'
import '@fontsource/rajdhani/600.css'
import '@fontsource/share-tech-mono/400.css'
import '@xterm/xterm/css/xterm.css'
import './styles/hud.css'

// A mesma página serve a janela principal e a busca rápida (#palette).
const root = createRoot(document.getElementById('root')!)
if (location.hash === '#palette') {
  document.documentElement.classList.add('palette-mode')
  import('./Palette').then(({ Palette }) => root.render(<Palette />))
} else {
  import('./App').then(({ default: App }) => root.render(<App />))
}
