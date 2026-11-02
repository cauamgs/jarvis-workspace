import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'

interface Props {
  termKey: string
  cwd: string
  resumeId?: string
  newSessionId?: string
  visible: boolean
  onClose: () => void
}

/** Terminal embutido rodando o `claude`. Fica montado (escondido) enquanto o processo viver. */
export function TerminalView(p: Props): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const fit = useRef<FitAddon | null>(null)
  const term = useRef<Terminal | null>(null)
  const [exitCode, setExitCode] = useState<number | null>(null)

  useEffect(() => {
    const t = new Terminal({
      fontFamily: '"SF Mono", Menlo, Monaco, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 10000,
      macOptionIsMeta: true,
      theme: {
        background: '#00000000',
        foreground: '#e6e7e9',
        cursor: '#00e5ff',
        cursorAccent: '#0c0c0d',
        selectionBackground: 'rgba(0, 229, 255, 0.22)',
        black: '#1a1a1c',
        brightBlack: '#63666c',
        blue: '#4d8dff',
        brightBlue: '#7fb0ff',
        cyan: '#00e5ff',
        brightCyan: '#7ff6ff',
        green: '#3dffb0',
        brightGreen: '#8affd0',
        yellow: '#ffb627',
        brightYellow: '#ffd27a',
        red: '#ff3b5c',
        brightRed: '#ff8ea1',
        magenta: '#b98bff',
        brightMagenta: '#d6b9ff',
        white: '#e6e7e9',
        brightWhite: '#ffffff'
      }
    })
    const f = new FitAddon()
    t.loadAddon(f)
    t.loadAddon(new WebLinksAddon())
    t.open(host.current!)
    term.current = t
    fit.current = f

    const offData = window.jarvis.onPtyData((key, data) => key === p.termKey && t.write(data))
    const offExit = window.jarvis.onPtyExit((key, code) => key === p.termKey && setExitCode(code))
    t.onData((d) => window.jarvis.ptyWrite(p.termKey, d))
    t.onResize(({ cols, rows }) => window.jarvis.ptyResize(p.termKey, cols, rows))

    window.jarvis
      .ptyStart({ key: p.termKey, cwd: p.cwd, resumeId: p.resumeId, newSessionId: p.newSessionId })
      .then((r) => {
        if (!r.ok) t.write(`\r\n\x1b[31mFalha ao iniciar terminal: ${r.error}\x1b[0m\r\n`)
        if (r.replay) t.write(r.replay)
        safeFit()
        window.jarvis.ptyResize(p.termKey, t.cols, t.rows)
      })

    function safeFit(): void {
      try {
        if (host.current && host.current.offsetWidth > 0) f.fit()
      } catch {
        /* ainda não visível */
      }
    }
    const ro = new ResizeObserver(() => safeFit())
    ro.observe(host.current!)

    return () => {
      ro.disconnect()
      offData()
      offExit()
      t.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.termKey])

  useEffect(() => {
    if (!p.visible) return
    requestAnimationFrame(() => {
      try {
        fit.current?.fit()
      } catch {
        /* ignore */
      }
      term.current?.focus()
    })
  }, [p.visible])

  return (
    <div className="term-wrap" style={{ display: p.visible ? 'block' : 'none' }}>
      <div className="term-host" ref={host} />
      {exitCode !== null && (
        <div className="term-exit">
          PROCESSO ENCERRADO (CÓDIGO {exitCode})
          <button className="btn sm" onClick={p.onClose}>Fechar</button>
        </div>
      )}
    </div>
  )
}
