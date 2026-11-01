import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { cpus, loadavg, totalmem, uptime } from 'node:os'
import type { ContainerInfo, DockerState, ListeningPort, ProcessInfo, SystemSnapshot } from '@shared/types'
import { loginShellEnv } from './shellEnv'

/**
 * Coleta de métricas do macOS para o painel do sistema. Usa só ferramentas nativas
 * (vm_stat, pmset, netstat, lsof, ps) e o CLI do docker (OrbStack/Docker Desktop).
 */

function run(cmd: string, args: string[], timeout = 8000): Promise<string> {
  return loginShellEnv().then(
    ({ env }) =>
      new Promise((resolve) => {
        execFile(cmd, args, { env, timeout, maxBuffer: 8 * 1024 * 1024 }, (_err, stdout) => resolve(stdout ?? ''))
      })
  )
}

function runResult(cmd: string, args: string[], timeout = 20000): Promise<{ ok: boolean; out: string }> {
  return loginShellEnv().then(
    ({ env }) =>
      new Promise((resolve) => {
        execFile(cmd, args, { env, timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) =>
          resolve({ ok: !err, out: (stdout || stderr || String(err ?? '')).trim() })
        )
      })
  )
}

// ---------- CPU (delta entre amostras) ----------

let prevCpu: { idle: number; total: number }[] | null = null

function sampleCpu(): { total: number; cores: number[] } {
  const now = cpus().map((c) => {
    const t = c.times
    return { idle: t.idle, total: t.user + t.nice + t.sys + t.irq + t.idle }
  })
  const prev = prevCpu ?? now.map(() => ({ idle: 0, total: 0 }))
  prevCpu = now
  const cores = now.map((c, i) => {
    const dt = c.total - prev[i].total
    return dt > 0 ? Math.round((1 - (c.idle - prev[i].idle) / dt) * 100) : 0
  })
  return { total: Math.round(cores.reduce((a, b) => a + b, 0) / Math.max(1, cores.length)), cores }
}

// ---------- memória (vm_stat, como o Monitor de Atividade) ----------

async function sampleMemory(): Promise<{ used: number; total: number; compressed: number; pressure: number }> {
  const out = await run('vm_stat', [])
  const pageSize = Number(/page size of (\d+)/.exec(out)?.[1] ?? 16384)
  const pages = (label: string): number => Number(new RegExp(`${label}:\\s+(\\d+)`).exec(out)?.[1] ?? 0)
  const anonymous = pages('Anonymous pages')
  const purgeable = pages('Pages purgeable')
  const wired = pages('Pages wired down')
  const compressed = pages('Pages occupied by compressor')
  // Memória usada = memória de apps + wired + comprimida.
  const app = Math.max(0, (anonymous || pages('Pages active')) - purgeable)
  const total = totalmem()
  const used = Math.min(total, (app + wired + compressed) * pageSize)
  return { used, total, compressed: compressed * pageSize, pressure: Math.round((used / total) * 100) }
}

// ---------- disco ----------

async function sampleDisk(): Promise<{ used: number; total: number }> {
  try {
    // No macOS os dados do usuário ficam no volume Data.
    const s = await fs.statfs('/System/Volumes/Data').catch(() => fs.statfs('/'))
    const total = s.blocks * s.bsize
    return { used: total - s.bavail * s.bsize, total }
  } catch {
    return { used: 0, total: 0 }
  }
}

// ---------- bateria ----------

async function sampleBattery(): Promise<SystemSnapshot['battery']> {
  const out = await run('pmset', ['-g', 'batt'])
  const m = /(\d+)%;\s*([^;]+);\s*([^\s]+)?/.exec(out)
  if (!m) return null
  const state = m[2].trim()
  return {
    percent: Number(m[1]),
    charging: state === 'charging' || state === 'charged' || state === 'finishing charge',
    source: out.includes("'AC Power'") ? 'ac' : 'battery',
    remaining: m[3] && /^\d+:\d+$/.test(m[3]) ? m[3] : undefined
  }
}

// ---------- rede (bytes da interface principal, em taxa) ----------

let prevNet: { at: number; rx: number; tx: number } | null = null

async function sampleNetwork(): Promise<{ rxPerSec: number; txPerSec: number }> {
  const out = await run('netstat', ['-ib'])
  let rx = 0
  let tx = 0
  const seen = new Set<string>()
  for (const line of out.split('\n').slice(1)) {
    const c = line.trim().split(/\s+/)
    // Só a linha <Link#> de cada interface física/ativa (en*), para não contar duas vezes.
    if (c.length < 11 || !/^en\d/.test(c[0]) || !c[2].startsWith('<Link') || seen.has(c[0])) continue
    seen.add(c[0])
    rx += Number(c[6]) || 0
    tx += Number(c[9]) || 0
  }
  const now = Date.now()
  const prev = prevNet
  prevNet = { at: now, rx, tx }
  if (!prev || now <= prev.at) return { rxPerSec: 0, txPerSec: 0 }
  const dt = (now - prev.at) / 1000
  return { rxPerSec: Math.max(0, (rx - prev.rx) / dt), txPerSec: Math.max(0, (tx - prev.tx) / dt) }
}

export async function snapshot(): Promise<SystemSnapshot> {
  const [memory, disk, battery, network] = await Promise.all([sampleMemory(), sampleDisk(), sampleBattery(), sampleNetwork()])
  return {
    at: Date.now(),
    cpu: { ...sampleCpu(), load: loadavg().map((l) => Math.round(l * 100) / 100), model: cpus()[0]?.model ?? '' },
    memory,
    disk,
    battery,
    network,
    uptime: uptime()
  }
}

// ---------- portas em escuta ----------

export async function listeningPorts(): Promise<ListeningPort[]> {
  const out = await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pcnL'])
  // Saída -F: linhas prefixadas (p=pid, c=comando, L=usuário, n=endereço).
  const ports = new Map<string, ListeningPort>()
  let pid = 0
  let command = ''
  let user = ''
  for (const line of out.split('\n')) {
    const tag = line[0]
    const v = line.slice(1)
    if (tag === 'p') pid = Number(v)
    else if (tag === 'c') command = v
    else if (tag === 'L') user = v
    else if (tag === 'n') {
      const m = /^(.*):(\d+)$/.exec(v)
      if (!m) continue
      const port = Number(m[2])
      const address = m[1] === '*' ? 'todas' : m[1].replace(/^\[|\]$/g, '')
      const key = `${pid}:${port}`
      if (!ports.has(key)) ports.set(key, { port, pid, command, user, address })
    }
  }
  const list = [...ports.values()]
  // Linha de comando completa ajuda a reconhecer "qual node é qual".
  const args = await processArgs(list.map((p) => p.pid))
  for (const p of list) p.args = args.get(p.pid)
  return list.sort((a, b) => a.port - b.port)
}

async function processArgs(pids: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>()
  if (!pids.length) return map
  const out = await run('ps', ['-o', 'pid=,args=', '-p', [...new Set(pids)].join(',')])
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line)
    if (m) map.set(Number(m[1]), m[2])
  }
  return map
}

// ---------- processos ----------

export async function processes(): Promise<ProcessInfo[]> {
  const out = await run('ps', ['-Ao', 'pid=,ppid=,pcpu=,pmem=,rss=,etime=,user=,comm='])
  const list: ProcessInfo[] = []
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/.exec(line)
    if (!m) continue
    const path = m[8].trim()
    list.push({
      pid: Number(m[1]),
      ppid: Number(m[2]),
      cpu: Number(m[3]),
      mem: Number(m[4]),
      rss: Number(m[5]) * 1024,
      elapsed: m[6],
      user: m[7],
      name: path.split('/').pop() || path,
      path
    })
  }
  return list
}

export function killProcess(pid: number, force: boolean): { ok: boolean; error?: string } {
  // Nunca o próprio Jarvis nem processos do sistema base.
  if (pid <= 1 || pid === process.pid || pid === process.ppid) return { ok: false, error: 'Processo protegido.' }
  try {
    process.kill(pid, force ? 'SIGKILL' : 'SIGTERM')
    return { ok: true }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    return { ok: false, error: code === 'EPERM' ? 'Sem permissão (processo de outro usuário ou do sistema).' : String(err) }
  }
}

// ---------- Docker / OrbStack ----------

export async function docker(): Promise<DockerState> {
  const { env } = await loginShellEnv()
  const hasCli = await new Promise<boolean>((r) => execFile('which', ['docker'], { env }, (e) => r(!e)))
  if (!hasCli) return { status: 'missing', containers: [] }
  const ps = await runResult('docker', ['ps', '-a', '--no-trunc', '--format', '{{json .}}'], 6000)
  if (!ps.ok) return { status: 'stopped', containers: [], error: ps.out.split('\n')[0] }

  const rows = ps.out.split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const stats = new Map<string, { cpu: number; mem: string }>()
  if (rows.some((r) => r.State === 'running')) {
    const st = await runResult('docker', ['stats', '--no-stream', '--format', '{{json .}}'], 8000)
    for (const l of st.out.split('\n').filter((x) => x.startsWith('{'))) {
      const s = JSON.parse(l)
      stats.set(s.ID, { cpu: parseFloat(s.CPUPerc) || 0, mem: String(s.MemUsage ?? '').split('/')[0].trim() })
    }
  }
  const containers: ContainerInfo[] = rows.map((r) => {
    const labels = String(r.Labels ?? '')
    const project = /com\.docker\.compose\.project=([^,]+)/.exec(labels)?.[1]
    const s = stats.get(String(r.ID).slice(0, 12)) ?? stats.get(r.ID)
    return {
      id: r.ID,
      name: r.Names,
      image: r.Image,
      state: r.State,
      status: r.Status,
      ports: r.Ports,
      project,
      cpu: s?.cpu,
      mem: s?.mem
    }
  })
  return { status: 'running', containers }
}

export async function dockerAction(id: string, action: 'start' | 'stop' | 'restart'): Promise<{ ok: boolean; error?: string }> {
  if (!/^[\w.-]+$/.test(id)) return { ok: false, error: 'ID inválido.' }
  const r = await runResult('docker', [action, id], 60000)
  return r.ok ? { ok: true } : { ok: false, error: r.out }
}

export async function dockerLogs(id: string): Promise<string> {
  if (!/^[\w.-]+$/.test(id)) return ''
  const r = await runResult('docker', ['logs', '--tail', '300', '--timestamps', id], 10000)
  return r.out
}

/** Liga o motor de containers: OrbStack se existir, senão Docker Desktop. */
export async function startDockerEngine(): Promise<{ ok: boolean; error?: string }> {
  const orb = await runResult('orb', ['start'], 60000)
  if (orb.ok) return { ok: true }
  const desktop = await runResult('open', ['-a', 'Docker'], 10000)
  return desktop.ok ? { ok: true } : { ok: false, error: orb.out || desktop.out }
}
