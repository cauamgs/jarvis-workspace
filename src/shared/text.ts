/** Utilitários de texto compartilhados entre o processo principal e a interface. */

const FOLD: Record<string, string> = {
  a: 'aáàâãä',
  e: 'eéèêë',
  i: 'iíìîï',
  o: 'oóòôõö',
  u: 'uúùûü',
  c: 'cç',
  n: 'nñ'
}

const strip = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Padrão de regex que casa o termo ignorando acentos ("sessao" encontra "sessão"). */
export function foldPattern(term: string): string {
  return [...strip(term.toLowerCase())]
    .map((ch) => (FOLD[ch] ? `[${FOLD[ch]}]` : ch.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&')))
    .join('')
}

/** Divide a consulta em termos; trechos entre aspas viram uma frase exata. */
export function queryTerms(q: string): string[] {
  const terms: string[] = []
  const re = /"([^"]+)"|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(q))) {
    const t = (m[1] ?? m[2]).trim()
    if (t.length >= 2) terms.push(t)
  }
  return terms
}

/** Regex (global, sem diferenciar maiúsculas e acentos) que destaca qualquer um dos termos. */
export function highlightRegex(terms: string[]): RegExp | null {
  if (!terms.length) return null
  return new RegExp(terms.map((t) => foldPattern(t).replace(/ +/g, '\\s+')).join('|'), 'gi')
}
