import { useEffect, useState } from 'react'
import type { DeliveredFile } from '@shared/types'

const size = (n: number): string =>
  n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(0)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`

/** Arquivos entregues pelo Claude (SendUserFile / enviar_arquivo), com prévia conforme o tipo. */
export function FileCards({ paths, caption }: { paths: string[]; caption?: string }): React.JSX.Element {
  const [files, setFiles] = useState<DeliveredFile[] | null>(null)
  const key = paths.join('\n')

  useEffect(() => {
    void window.jarvis.fileInfo(paths).then(setFiles)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return (
    <div className="deliv">
      {caption && <div className="deliv-caption">{caption}</div>}
      {(files ?? paths.map((p) => ({ path: p }) as DeliveredFile)).map((f) => (
        <FileCard key={f.path} f={f} loading={!files} />
      ))}
    </div>
  )
}

function FileCard({ f, loading }: { f: DeliveredFile; loading: boolean }): React.JSX.Element {
  const url = window.jarvis.fileUrl(f.path)
  const missing = !loading && !f.exists
  const [failed, setFailed] = useState(false)

  const head = (
    <div className="deliv-head">
      <span className="deliv-ext">{(f.ext || '?').toUpperCase()}</span>
      <span className="deliv-name" title={f.path}>{f.name ?? f.path.split('/').pop()}</span>
      {!loading && f.exists && <span className="deliv-size">{size(f.size)}</span>}
      {missing && <span className="deliv-size" style={{ color: 'var(--amber)' }}>não encontrado</span>}
      <span style={{ flex: 1 }} />
      {!missing && !loading && (
        <>
          <button className="row-btn" onClick={() => window.jarvis.fileOpen(f.path)}>Abrir</button>
          <button className="row-btn" onClick={() => window.jarvis.fileReveal(f.path)}>Finder</button>
        </>
      )}
    </div>
  )

  if (loading || missing || failed) return <div className="deliv-card compact">{head}</div>

  switch (f.kind) {
    case 'image':
      return (
        <div className="deliv-card">
          {head}
          <img className="deliv-media" src={url} alt={f.name} onError={() => setFailed(true)} onClick={() => window.jarvis.fileOpen(f.path)} />
        </div>
      )
    case 'video':
      return (
        <div className="deliv-card">
          {head}
          <video className="deliv-media" src={url} controls preload="metadata" onError={() => setFailed(true)} />
        </div>
      )
    case 'audio':
      return (
        <div className="deliv-card">
          {head}
          <audio className="deliv-audio" src={url} controls preload="metadata" onError={() => setFailed(true)} />
        </div>
      )
    case 'pdf':
      return (
        <div className="deliv-card">
          {head}
          <iframe className="deliv-pdf" src={url + '#toolbar=0&view=FitH'} title={f.name} />
        </div>
      )
    case 'text':
      return <TextCard f={f} head={head} />
    default:
      return <div className="deliv-card compact">{head}</div>
  }
}

function TextCard({ f, head }: { f: DeliveredFile; head: React.ReactNode }): React.JSX.Element {
  const [text, setText] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    void window.jarvis.fileText(f.path).then(setText)
  }, [f.path])
  const lines = (text ?? '').split('\n')
  const shown = open ? lines : lines.slice(0, 14)
  return (
    <div className="deliv-card">
      {head}
      <pre className="deliv-text">{shown.join('\n')}</pre>
      {lines.length > 14 && (
        <button className="deliv-more" onClick={() => setOpen((o) => !o)}>
          {open ? 'Mostrar menos' : `Mostrar mais ${lines.length - 14} linhas${f.size > 16000 ? ' (início do arquivo)' : ''}`}
        </button>
      )}
    </div>
  )
}
