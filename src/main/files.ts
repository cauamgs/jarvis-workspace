import { createReadStream, promises as fs } from 'node:fs'
import { Readable } from 'node:stream'
import { basename, extname, isAbsolute } from 'node:path'
import type { DeliveredFile } from '@shared/types'

/**
 * Arquivos entregues pelo Claude ao usuário (SendUserFile no Claude Desktop, enviar_arquivo no Jarvis).
 * Só caminhos que apareceram numa entrega podem ser lidos pela interface — o protocolo jarvis-file://
 * e as ações de abrir/mostrar recusam qualquer outro.
 */

const allowed = new Set<string>()

/** Nomes das ferramentas que entregam arquivos. */
export const isDeliveryTool = (name: string): boolean => name === 'SendUserFile' || name.endsWith('__enviar_arquivo')

/** Caminhos de uma chamada de entrega (aceita os dois formatos de entrada). */
export function deliveryPaths(input: any): string[] {
  const v = input?.files ?? input?.arquivos
  return (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []).filter((p): p is string => typeof p === 'string')
}

export function allowFiles(paths: string[]): void {
  for (const p of paths) if (isAbsolute(p)) allowed.add(p)
}

export const isAllowed = (p: string): boolean => allowed.has(p)

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  bmp: 'image/bmp', heic: 'image/heic', avif: 'image/avif',
  mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/mp4', webm: 'video/webm',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', flac: 'audio/flac',
  pdf: 'application/pdf', html: 'text/html', htm: 'text/html'
}
const TEXT = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonl', 'yaml', 'yml', 'toml', 'xml', 'log', 'ini', 'env', 'sql',
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'cs', 'php',
  'sh', 'zsh', 'bash', 'css', 'scss', 'vue', 'svelte', 'srt', 'vtt'
])

export function kindOf(path: string): { kind: DeliveredFile['kind']; mime: string } {
  const ext = extname(path).slice(1).toLowerCase()
  const mime = MIME[ext] ?? (TEXT.has(ext) ? 'text/plain' : 'application/octet-stream')
  const kind: DeliveredFile['kind'] = mime.startsWith('image/')
    ? 'image'
    : mime.startsWith('video/')
      ? 'video'
      : mime.startsWith('audio/')
        ? 'audio'
        : ext === 'pdf'
          ? 'pdf'
          : ext === 'html' || ext === 'htm'
            ? 'html'
            : TEXT.has(ext)
              ? 'text'
              : 'other'
  return { kind, mime }
}

export async function fileInfo(paths: string[]): Promise<DeliveredFile[]> {
  return Promise.all(
    paths.map(async (path) => {
      const { kind, mime } = kindOf(path)
      const base = { path, name: basename(path), ext: extname(path).slice(1).toLowerCase(), kind, mime }
      if (!isAllowed(path)) return { ...base, exists: false, size: 0 }
      const st = await fs.stat(path).catch(() => null)
      return { ...base, exists: !!st?.isFile(), size: st?.size ?? 0, mtime: st?.mtimeMs }
    })
  )
}

/** Começo de um arquivo de texto entregue (para a prévia). */
export async function fileText(path: string, max = 16000): Promise<string> {
  if (!isAllowed(path)) return ''
  const fh = await fs.open(path, 'r').catch(() => null)
  if (!fh) return ''
  try {
    const buf = Buffer.alloc(max)
    const { bytesRead } = await fh.read(buf, 0, max, 0)
    return buf.subarray(0, bytesRead).toString('utf8')
  } finally {
    await fh.close()
  }
}

/** Valida uma entrega vinda da ferramenta enviar_arquivo do Jarvis. */
export async function validateDelivery(paths: string[]): Promise<{ ok: string[]; errors: string[] }> {
  const ok: string[] = []
  const errors: string[] = []
  for (const p of paths) {
    if (!isAbsolute(p)) {
      errors.push(`${p}: use o caminho absoluto`)
      continue
    }
    const st = await fs.stat(p).catch(() => null)
    if (!st) errors.push(`${p}: arquivo não encontrado`)
    else if (!st.isFile()) errors.push(`${p}: não é um arquivo`)
    else ok.push(p)
  }
  return { ok, errors }
}

/**
 * Resposta HTTP para o protocolo jarvis-file://, com suporte a Range (o player de vídeo
 * pede pedaços do arquivo para avançar e voltar).
 */
export async function serveFile(path: string, range: string | null): Promise<Response> {
  if (!isAllowed(path)) return new Response('Arquivo não autorizado', { status: 403 })
  const st = await fs.stat(path).catch(() => null)
  if (!st?.isFile()) return new Response('Arquivo não encontrado', { status: 404 })
  const headers: Record<string, string> = { 'Content-Type': kindOf(path).mime, 'Accept-Ranges': 'bytes' }
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim())
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : Math.max(0, st.size - Number(m[2]))
    let end = m[1] && m[2] ? Number(m[2]) : st.size - 1
    end = Math.min(end, st.size - 1)
    if (start > end || start >= st.size) {
      return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${st.size}` } })
    }
    start = Math.max(0, start)
    const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream
    return new Response(body, {
      status: 206,
      headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': String(end - start + 1) }
    })
  }
  const body = Readable.toWeb(createReadStream(path)) as ReadableStream
  return new Response(body, { status: 200, headers: { ...headers, 'Content-Length': String(st.size) } })
}
