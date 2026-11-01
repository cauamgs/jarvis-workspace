import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { VoiceEvent } from '@shared/types'

/**
 * Ponte para o `jarvis-speech` (Swift, SFSpeechRecognizer). Um reconhecimento por vez;
 * os eventos (nível de áudio, parcial, final, erro) vão para quem pediu a escuta.
 */
export class Voice {
  private proc: ChildProcess | null = null

  constructor(private emit: (ev: VoiceEvent) => void) {}

  private binary(): string {
    return app.isPackaged
      ? join(process.resourcesPath, 'bin', 'jarvis-speech')
      : join(__dirname, '../../resources/bin/jarvis-speech')
  }

  get listening(): boolean {
    return this.proc !== null
  }

  start(locale = 'pt-BR'): { ok: boolean; error?: string } {
    if (this.proc) return { ok: true }
    const bin = this.binary()
    if (!existsSync(bin)) return { ok: false, error: 'Módulo de voz não encontrado (rode o build do jarvis-speech).' }
    if (!app.isPackaged)
      return { ok: false, error: 'O comando por voz só funciona no app instalado (o macOS exige as permissões declaradas no app).' }

    const proc = spawn(bin, ['listen', locale], { stdio: ['pipe', 'pipe', 'pipe'] })
    this.proc = proc
    this.emit({ type: 'state', listening: true })
    let buf = ''
    let gotFinal = false
    proc.stdout!.setEncoding('utf8')
    proc.stdout!.on('data', (chunk: string) => {
      buf += chunk
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (!line) continue
        try {
          const ev = JSON.parse(line)
          if (ev.type === 'final') gotFinal = true
          if (ev.type === 'level' || ev.type === 'partial' || ev.type === 'final' || ev.type === 'error' || ev.type === 'ready')
            this.emit(ev)
        } catch {
          /* linha incompleta */
        }
      }
    })
    proc.on('exit', (code, signal) => {
      if (this.proc === proc) this.proc = null
      // Morte por sinal sem resultado = o macOS barrou por permissão (TCC) ou falha do helper.
      if (!gotFinal && (signal || (code !== 0 && code !== 1)))
        this.emit({ type: 'error', message: 'O reconhecimento de voz foi interrompido pelo macOS. Verifique as permissões de Microfone e Reconhecimento de Fala.' })
      this.emit({ type: 'state', listening: false })
    })
    return { ok: true }
  }

  /** Para de ouvir; o helper ainda entrega o texto final. */
  stop(): void {
    this.proc?.stdin?.write('stop\n')
  }

  cancel(): void {
    this.proc?.kill('SIGKILL')
    this.proc = null
  }
}
