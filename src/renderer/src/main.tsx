import { createRoot } from 'react-dom/client'
import '@fontsource/orbitron/400.css'
import '@fontsource/orbitron/500.css'
import '@fontsource/orbitron/700.css'
import '@fontsource/rajdhani/500.css'
import '@fontsource/rajdhani/600.css'
import '@fontsource/share-tech-mono/400.css'
import '@xterm/xterm/css/xterm.css'
import './styles/hud.css'
import App from './App'

createRoot(document.getElementById('root')!).render(<App />)
