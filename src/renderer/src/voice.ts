import type { NavRequest, SessionInfo, Workspace } from '@shared/types'

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

/**
 * Comandos locais falados — executados direto, sem passar pelo Claude:
 *   "abrir sistema" · "mostrar projetos" · "ir para sessões"
 *   "abrir sessão <nome>" · "abrir workspace <nome>"
 * Retorna null quando a frase é um pedido para o Claude (fica na busca para confirmar).
 */
export function parseCommand(
  text: string,
  sessions: SessionInfo[],
  workspaces: Workspace[]
): { req: NavRequest; say: string } | null {
  const t = norm(cleanUtterance(text))
  const open = /^(abr(a|ir|e)|mostr(a|ar|e)|ir (para|pra)|va (para|pra)|exib(a|ir))\s+(o |a |os |as )?/
  const m = open.exec(t)
  if (!m) return null
  const rest = t.slice(m[0].length)

  if (/^(painel (do )?)?sistema|^monitor/.test(rest)) return { req: { type: 'module', id: 'system' }, say: 'Abrindo o painel do sistema.' }
  if (/^(central (de )?)?projetos$/.test(rest)) return { req: { type: 'module', id: 'projects' }, say: 'Abrindo a central de projetos.' }
  if (/^sessoes$/.test(rest)) return { req: { type: 'module', id: 'sessions' }, say: 'Abrindo as sessões.' }

  const target = /^(sessao|conversa|chat)\s+(.+)$/.exec(rest)
  if (target) {
    const s = bestMatch(target[2], sessions.filter((x) => !x.archived), (x) => `${x.title} ${x.projectName}`)
    if (s) return { req: { type: 'session', id: s.id }, say: `Abrindo ${s.title}.` }
  }
  const ws = /^(workspace|espaco)\s+(.+)$/.exec(rest)
  if (ws) {
    const w = bestMatch(ws[2], workspaces, (x) => x.name)
    if (w) return { req: { type: 'workspace', id: w.id }, say: `Abrindo o workspace ${w.name}.` }
  }
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
