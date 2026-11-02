import type { AppEntry, AutoAction, NavRequest, Routine, SessionInfo, Workspace } from '@shared/types'

/** Fala um texto com uma voz pt-BR do macOS (Luciana, se existir). */
export function speak(text: string): void {
  const synth = window.speechSynthesis
  if (!synth) return
  const clean = stripMarkdown(text).slice(0, 700)
  if (!clean) return
  synth.cancel()
  const u = new SpeechSynthesisUtterance(clean)
  const voices = synth.getVoices()
  u.voice = voices.find((v) => v.name.startsWith('Luciana')) ?? voices.find((v) => v.lang.replace('_', '-') === 'pt-BR') ?? null
  u.lang = 'pt-BR'
  u.rate = 1.05
  synth.speak(u)
}

export function stopSpeaking(): void {
  window.speechSynthesis?.cancel()
}

function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' (trecho de código) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/[*_~>|]/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Remove o vocativo ("Jarvis, ...") e pontuação final. */
export function cleanUtterance(text: string): string {
  return text.replace(/^\s*(ok\s+|ei\s+|hey\s+)?jarvis[\s,.:!-]*/i, '').replace(/[.!?]+$/, '').trim()
}

export type Command = { say: string } & ({ req: NavRequest } | { auto: AutoAction } | { routine: Routine })

export interface CommandContext {
  sessions: SessionInfo[]
  workspaces: Workspace[]
  apps?: AppEntry[]
  routines?: Routine[]
  shortcuts?: string[]
}

/**
 * Comandos locais (falados ou digitados) — executados direto, sem passar pelo Claude:
 *   rotinas pelo nome ou gatilho ("modo foco") · "volume 30" · "modo escuro" · "dormir a tela"
 *   "rodar atalho <nome>" · "abrir sistema|projetos|sessões|memória" · "abrir sessão|workspace <nome>"
 *   "buscar <termos>" (nas conversas)
 *   "abrir <app>"
 * Retorna null quando a frase é um pedido para o Claude (fica na busca para confirmar).
 */
export function parseCommand(text: string, ctx: CommandContext): Command | null {
  const t = norm(cleanUtterance(text))
  if (!t) return null

  // Rotinas do usuário primeiro: o gatilho dele vence as frases embutidas.
  const routineQuery = t.replace(/^(executar?|rodar?|iniciar?|ativar?)\s+(a\s+)?(rotina\s+)?/, '')
  const routine = (ctx.routines ?? []).find((r) =>
    [r.name, ...r.triggers].some((g) => norm(g) && (norm(g) === routineQuery || norm(g) === t))
  )
  if (routine) return { routine, say: `Executando ${routine.name}.` }

  const vol = /^(volume|som)\s+(?:em\s+|para\s+|no\s+)?(\d{1,3}|maximo|minimo|zero)(?:\s*%| por cento)?$/.exec(t)
  if (vol) {
    const v = vol[2] === 'maximo' ? 100 : vol[2] === 'minimo' || vol[2] === 'zero' ? 0 : Number(vol[2])
    return { auto: { type: 'volume', target: String(v) }, say: `Volume em ${v} por cento.` }
  }
  if (/^(silenciar|mudo|sem som)$/.test(t)) return { auto: { type: 'volume', target: '0' }, say: 'Som desligado.' }
  if (/^(ativar\s+|ligar\s+)?modo escuro$/.test(t)) return { auto: { type: 'darkmode', target: 'on' }, say: 'Modo escuro ativado.' }
  if (/^(ativar\s+|ligar\s+)?modo claro$|^desativar modo escuro$/.test(t)) return { auto: { type: 'darkmode', target: 'off' }, say: 'Modo claro ativado.' }
  if (/^(dormir|apagar|desligar)\s+(a\s+)?tela$/.test(t)) return { auto: { type: 'sleep-display', target: '' }, say: 'Apagando a tela.' }

  const find = /^(buscar|procurar|pesquisar)\s+(nas conversas\s+|na memoria\s+)?(por\s+|sobre\s+)?(.+)$/.exec(t)
  if (find) {
    // Usa o texto original (com acentos e aspas) — a busca já ignora acentos.
    const original = cleanUtterance(text).replace(/^\S+\s+(nas conversas\s+|na mem[oó]ria\s+)?(por\s+|sobre\s+)?/i, '')
    return { req: { type: 'search', query: original || find[4] }, say: `Buscando ${find[4]} nas conversas.` }
  }

  const sc = /^(rodar|executar)\s+(o\s+)?atalho\s+(.+)$/.exec(t)
  if (sc) {
    const name = bestMatch(sc[3], ctx.shortcuts ?? [], (x) => x)
    if (name) return { auto: { type: 'shortcut', target: name }, say: `Rodando o atalho ${name}.` }
  }

  const open = /^(abr(a|ir|e)|mostr(a|ar|e)|ir (para|pra)|va (para|pra)|exib(a|ir)|inici(a|ar|e))\s+(o |a |os |as )?/
  const m = open.exec(t)
  if (!m) return null
  const rest = t.slice(m[0].length)

  if (/^(painel (do )?)?sistema|^monitor/.test(rest)) return { req: { type: 'module', id: 'system' }, say: 'Abrindo o painel do sistema.' }
  if (/^(central (de )?)?projetos$/.test(rest)) return { req: { type: 'module', id: 'projects' }, say: 'Abrindo a central de projetos.' }
  if (/^sessoes$/.test(rest)) return { req: { type: 'module', id: 'sessions' }, say: 'Abrindo as sessões.' }
  if (/^(o )?(lab|laboratorio)( mcp)?$|^mcp$/.test(rest)) return { req: { type: 'module', id: 'lab' }, say: 'Abrindo o laboratório MCP.' }
  if (/^(a )?memoria$/.test(rest)) return { req: { type: 'module', id: 'memory' }, say: 'Abrindo a memória.' }
  if (/^(automac(ao|oes)|rotinas)$/.test(rest)) return { req: { type: 'module', id: 'automation' }, say: 'Abrindo a automação.' }

  const target = /^(sessao|conversa|chat)\s+(.+)$/.exec(rest)
  if (target) {
    const s = bestMatch(target[2], ctx.sessions.filter((x) => !x.archived), (x) => `${x.title} ${x.projectName}`)
    if (s) return { req: { type: 'session', id: s.id }, say: `Abrindo ${s.title}.` }
  }
  const ws = /^(workspace|espaco)\s+(.+)$/.exec(rest)
  if (ws) {
    const w = bestMatch(ws[2], ctx.workspaces, (x) => x.name)
    if (w) return { req: { type: 'workspace', id: w.id }, say: `Abrindo o workspace ${w.name}.` }
  }

  // "abrir <app>": nome exato primeiro, depois o app cujo nome começa com o pedido.
  const q = rest.replace(/^(app|aplicativo|programa)\s+/, '')
  const apps = ctx.apps ?? []
  const app = apps.find((a) => norm(a.name) === q) ?? apps.find((a) => norm(a.name).startsWith(q) && q.length >= 3)
  if (app) return { auto: { type: 'app', target: app.path }, say: `Abrindo ${app.name}.` }
  return null
}

/** Item cujo texto contém mais palavras da busca (desempata pelo primeiro da lista = mais recente). */
function bestMatch<T>(query: string, items: T[], text: (x: T) => string): T | undefined {
  const words = norm(query).split(' ').filter((w) => w.length > 1)
  let best: T | undefined
  let bestScore = 0
  for (const it of items) {
    const hay = norm(text(it))
    const score = words.filter((w) => hay.includes(w)).length
    if (score > bestScore) {
      best = it
      bestScore = score
    }
  }
  return bestScore > 0 ? best : undefined
}
