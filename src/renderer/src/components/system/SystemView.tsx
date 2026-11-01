import { useEffect, useMemo, useRef, useState } from 'react'
import type { ContainerInfo, DockerState, ListeningPort, ProcessInfo, SystemSnapshot } from '@shared/types'
import { fmtBytes, fmtRate, levelOf, RingGauge, Sparkline } from './Gauges'

const HISTORY = 60
/** Processos do macOS que escutam portas mas não interessam no dia a dia. */
const SYSTEM_LISTENERS = new Set(['ControlCenter', 'rapportd', 'sharingd', 'identityservicesd', 'remoted', 'launchd', 'AirPlayUIAgent'])

function usePoll<T>(fn: () => Promise<T>, ms: number): [T | null, () => void] {
  const [data, setData] = useState<T | null>(null)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const tick = useRef<() => void>(() => {})
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const run = async (): Promise<void> => {
      clearTimeout(timer)
      try {
        const v = await fnRef.current()
        if (alive) setData(v)
      } finally {
        if (alive) timer = setTimeout(run, ms)
      }
    }
    tick.current = () => void run()
    void run()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [ms])
  return [data, () => tick.current()]
}

function fmtUptime(s: number): string {
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}min` : `${m}min`
}

export function SystemView(): React.JSX.Element {
  const [snap] = usePoll(() => window.jarvis.sysSnapshot(), 2000)
  const [ports, refreshPorts] = usePoll(() => window.jarvis.sysPorts(), 3000)
  const [procs, refreshProcs] = usePoll(() => window.jarvis.sysProcesses(), 3000)
  const [docker, refreshDocker] = usePoll(() => window.jarvis.sysDocker(), 5000)
  const [hist, setHist] = useState<{ cpu: number[]; mem: number[]; rx: number[]; tx: number[] }>({ cpu: [], mem: [], rx: [], tx: [] })
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    if (!snap) return
    const push = (a: number[], v: number): number[] => [...a, v].slice(-HISTORY)
    setHist((h) => ({
      cpu: push(h.cpu, snap.cpu.total),
      mem: push(h.mem, snap.memory.pressure),
      rx: push(h.rx, snap.network.rxPerSec),
      tx: push(h.tx, snap.network.txPerSec)
    }))
  }, [snap])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  async function kill(pid: number, name: string, force: boolean): Promise<void> {
    const r = await window.jarvis.sysKill(pid, force)
    setToast(r.ok ? { ok: true, text: `${name} (${pid}) ${force ? 'forçado a encerrar' : 'encerrado'}.` } : { ok: false, text: r.error ?? 'Falha' })
    setTimeout(() => {
      refreshPorts()
      refreshProcs()
    }, 600)
  }

  return (
    <div className="sysview">
      <Gauges snap={snap} hist={hist} />
      <div className="sys-grid">
        <PortsPanel ports={ports} onKill={kill} />
        <DockerPanel docker={docker} refresh={refreshDocker} onToast={setToast} />
      </div>
      <ProcessesPanel procs={procs} onKill={kill} />
      {toast && <div className={`sys-toast ${toast.ok ? 'ok' : 'err'}`}>{toast.ok ? '✓' : '✕'} {toast.text}</div>}
    </div>
  )
}

function Gauges({ snap, hist }: { snap: SystemSnapshot | null; hist: { cpu: number[]; mem: number[]; rx: number[]; tx: number[] } }): React.JSX.Element {
  if (!snap) return <div className="sys-gauges panel"><div className="empty">Coletando telemetria…</div></div>
  const memPct = snap.memory.pressure
  const diskPct = snap.disk.total ? Math.round((snap.disk.used / snap.disk.total) * 100) : 0
  const bat = snap.battery
  return (
    <div className="sys-gauges">
      <div className="panel tile">
        <RingGauge label="CPU" value={snap.cpu.total} display={`${snap.cpu.total}%`} sub={`${snap.cpu.cores.length} núcleos`} level={levelOf(snap.cpu.total, 75, 92)} />
        <Sparkline values={hist.cpu} max={100} format={(v) => `${Math.round(v)}%`} />
        <div className="tile-foot">
          <span>CARGA</span> {snap.cpu.load.join(' · ')}
        </div>
      </div>
      <div className="panel tile">
        <RingGauge label="Memória" value={memPct} display={`${memPct}%`} sub={`${fmtBytes(snap.memory.used)} / ${fmtBytes(snap.memory.total, 0)}`} level={levelOf(memPct, 80, 92)} />
        <Sparkline values={hist.mem} max={100} format={(v) => `${Math.round(v)}%`} />
        <div className="tile-foot">
          <span>COMPRIMIDA</span> {fmtBytes(snap.memory.compressed)}
        </div>
      </div>
      <div className="panel tile">
        <RingGauge label="Disco" value={diskPct} display={`${diskPct}%`} sub={`${fmtBytes(snap.disk.total - snap.disk.used, 0)} livres`} level={levelOf(diskPct, 85, 95)} />
        <div className="tile-foot spacer-foot">
          <span>USADO</span> {fmtBytes(snap.disk.used, 0)} de {fmtBytes(snap.disk.total, 0)}
        </div>
      </div>
      <div className="panel tile">
        {bat ? (
          <RingGauge
            label={bat.charging ? 'Bateria · carregando' : bat.source === 'ac' ? 'Bateria · na tomada' : 'Bateria'}
            value={bat.percent}
            display={`${bat.percent}%`}
            sub={bat.remaining ? `${bat.remaining} restantes` : bat.charging ? '⚡' : ''}
            level={bat.charging ? 'ok' : bat.percent <= 10 ? 'crit' : bat.percent <= 20 ? 'warn' : 'ok'}
          />
        ) : (
          <div className="empty">Sem bateria</div>
        )}
        <div className="tile-foot spacer-foot">
          <span>LIGADO HÁ</span> {fmtUptime(snap.uptime)}
        </div>
      </div>
      <div className="panel tile net">
        <div className="net-head">REDE</div>
        <div className="net-row">
          <span className="net-dir">↓</span>
          <b>{fmtRate(snap.network.rxPerSec)}</b>
        </div>
        <Sparkline values={hist.rx} format={fmtRate} height={38} />
        <div className="net-row">
          <span className="net-dir">↑</span>
          <b>{fmtRate(snap.network.txPerSec)}</b>
        </div>
        <Sparkline values={hist.tx} format={fmtRate} height={38} />
      </div>
    </div>
  )
}

/** Botão de encerrar com confirmação em dois cliques (Shift = forçar). */
function KillButton({ onKill }: { onKill: (force: boolean) => void }): React.JSX.Element {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(t)
  }, [armed])
  return (
    <button
      className={`row-btn danger${armed ? ' armed' : ''}`}
      title="Encerrar (Shift+clique força o encerramento)"
      onClick={(e) => {
        if (!armed) return setArmed(true)
        setArmed(false)
        onKill(e.shiftKey)
      }}
    >
      {armed ? 'Confirmar?' : 'Encerrar'}
    </button>
  )
}

function PortsPanel({ ports, onKill }: { ports: ListeningPort[] | null; onKill: (pid: number, name: string, force: boolean) => void }): React.JSX.Element {
  const [hideSystem, setHideSystem] = useState(true)
  const shown = (ports ?? []).filter((p) => !hideSystem || (!SYSTEM_LISTENERS.has(p.command) && p.port < 49152))
  return (
    <section className="panel sys-panel">
      <div className="panel-header">
        Portas em uso
        <span className="count">{String(shown.length).padStart(2, '0')}</span>
        <button className={`chip${hideSystem ? ' on' : ''}`} onClick={() => setHideSystem((v) => !v)} title="Esconde portas do macOS e portas efêmeras">
          Só desenvolvimento
        </button>
      </div>
      <div className="panel-body">
        <table className="sys-table">
          <thead>
            <tr>
              <th>Porta</th>
              <th>Processo</th>
              <th>PID</th>
              <th>Endereço</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr key={`${p.pid}:${p.port}`} title={p.args}>
                <td className="mono strong">{p.port}</td>
                <td>
                  {p.command}
                  {p.args && <small className="args">{p.args.replace(/^\S*\//, '').slice(0, 70)}</small>}
                </td>
                <td className="mono dim">{p.pid}</td>
                <td className="mono dim">{p.address}</td>
                <td className="row-actions">
                  <button className="row-btn" onClick={() => window.jarvis.openExternal(`http://localhost:${p.port}`)} title="Abrir no navegador">
                    Abrir
                  </button>
                  <KillButton onKill={(force) => onKill(p.pid, p.command, force)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {ports && !shown.length && <div className="empty">Nenhuma porta de desenvolvimento aberta</div>}
      </div>
    </section>
  )
}

function DockerPanel({
  docker,
  refresh,
  onToast
}: {
  docker: DockerState | null
  refresh: () => void
  onToast: (t: { ok: boolean; text: string }) => void
}): React.JSX.Element {
  const [busy, setBusy] = useState<string | null>(null)
  const [logs, setLogs] = useState<{ name: string; text: string } | null>(null)

  async function act(c: ContainerInfo, action: 'start' | 'stop' | 'restart'): Promise<void> {
    setBusy(c.id)
    const r = await window.jarvis.sysDockerAction(c.id, action)
    setBusy(null)
    onToast(r.ok ? { ok: true, text: `${c.name}: ${{ start: 'iniciado', stop: 'parado', restart: 'reiniciado' }[action]}.` } : { ok: false, text: r.error ?? 'Falha' })
    refresh()
  }

  const groups = useMemo(() => {
    const map = new Map<string, ContainerInfo[]>()
    for (const c of docker?.containers ?? []) {
      const k = c.project ?? '—'
      map.set(k, [...(map.get(k) ?? []), c])
    }
    return [...map.entries()].sort(([a], [b]) => (a === '—' ? 1 : b === '—' ? -1 : a.localeCompare(b)))
  }, [docker])

  const running = docker?.containers.filter((c) => c.state === 'running').length ?? 0

  return (
    <section className="panel sys-panel">
      <div className="panel-header">
        Containers
        <span className="count">
          {running}/{docker?.containers.length ?? 0}
        </span>
      </div>
      <div className="panel-body">
        {docker === null && <div className="empty">Verificando Docker…</div>}
        {docker?.status === 'missing' && <div className="empty">Docker/OrbStack não instalado</div>}
        {docker?.status === 'stopped' && (
          <div className="docker-off">
            <div className="docker-off-title">MOTOR DE CONTAINERS DESLIGADO</div>
            <p>O OrbStack (ou Docker Desktop) não está rodando.</p>
            <button
              className="btn primary"
              disabled={busy === 'engine'}
              onClick={async () => {
                setBusy('engine')
                const r = await window.jarvis.sysStartDocker()
                setBusy(null)
                onToast(r.ok ? { ok: true, text: 'Motor de containers iniciado.' } : { ok: false, text: r.error ?? 'Falha ao iniciar' })
                refresh()
              }}
            >
              {busy === 'engine' ? 'Iniciando…' : '▶ Iniciar OrbStack'}
            </button>
          </div>
        )}
        {docker?.status === 'running' && !docker.containers.length && <div className="empty">Nenhum container</div>}
        {groups.map(([project, list]) => (
          <div key={project}>
            <div className="group-label">{project === '—' ? 'AVULSOS' : project.toUpperCase()}</div>
            {list.map((c) => (
              <div key={c.id} className={`ctr ${c.state}`}>
                <i className="ctr-dot" title={c.state} />
                <div className="ctr-main">
                  <div className="ctr-name">{c.name}</div>
                  <div className="ctr-meta">
                    {c.image} · {c.status}
                    {c.ports && <span className="ctr-ports"> · {c.ports.replace(/0\.0\.0\.0:|\[::\]:/g, '').split(', ').filter((v, i, a) => a.indexOf(v) === i).join(', ')}</span>}
                  </div>
                </div>
                {c.state === 'running' && (
                  <div className="ctr-stats">
                    {c.cpu !== undefined && <span>{c.cpu.toFixed(1)}%</span>}
                    {c.mem && <span>{c.mem}</span>}
                  </div>
                )}
                <div className="row-actions">
                  {c.state === 'running' ? (
                    <>
                      <button className="row-btn" disabled={busy === c.id} onClick={() => void act(c, 'restart')}>Reiniciar</button>
                      <button className="row-btn danger" disabled={busy === c.id} onClick={() => void act(c, 'stop')}>Parar</button>
                    </>
                  ) : (
                    <button className="row-btn" disabled={busy === c.id} onClick={() => void act(c, 'start')}>Iniciar</button>
                  )}
                  <button className="row-btn" onClick={async () => setLogs({ name: c.name, text: await window.jarvis.sysDockerLogs(c.id) })}>
                    Logs
                  </button>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
      {logs && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setLogs(null)}>
          <div className="panel modal logs-modal">
            <div className="panel-header">
              Logs · {logs.name}
              <button className="btn sm ghost" style={{ marginLeft: 'auto' }} onClick={() => setLogs(null)}>Fechar</button>
            </div>
            <pre className="logs-body">{logs.text || '(sem logs)'}</pre>
          </div>
        </div>
      )}
    </section>
  )
}

function ProcessesPanel({ procs, onKill }: { procs: ProcessInfo[] | null; onKill: (pid: number, name: string, force: boolean) => void }): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'cpu' | 'mem'>('cpu')
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (procs ?? [])
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q) || String(p.pid) === q)
      .sort((a, b) => (sort === 'cpu' ? b.cpu - a.cpu : b.rss - a.rss))
      .slice(0, 40)
  }, [procs, query, sort])
  return (
    <section className="panel sys-panel procs">
      <div className="panel-header">
        Processos
        <span className="count">{procs?.length ?? 0}</span>
        <input className="input proc-search" placeholder="Filtrar por nome ou PID…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className={`chip${sort === 'cpu' ? ' on' : ''}`} onClick={() => setSort('cpu')}>CPU</button>
        <button className={`chip${sort === 'mem' ? ' on' : ''}`} onClick={() => setSort('mem')}>Memória</button>
      </div>
      <div className="panel-body">
        <table className="sys-table">
          <thead>
            <tr>
              <th>Processo</th>
              <th>PID</th>
              <th className="num">CPU</th>
              <th className="num">Memória</th>
              <th>Tempo</th>
              <th>Usuário</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.pid} title={p.path}>
                <td>
                  {p.name}
                  {/claude/i.test(p.name) && <span className="badge desktop" style={{ marginLeft: 8 }}>CLAUDE</span>}
                </td>
                <td className="mono dim">{p.pid}</td>
                <td className="num mono">
                  <span className="bar-cell"><i style={{ width: `${Math.min(100, p.cpu)}%` }} /></span>
                  {p.cpu.toFixed(1)}%
                </td>
                <td className="num mono">{fmtBytes(p.rss)}</td>
                <td className="mono dim">{p.elapsed}</td>
                <td className="mono dim">{p.user}</td>
                <td className="row-actions">
                  <KillButton onKill={(force) => onKill(p.pid, p.name, force)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
