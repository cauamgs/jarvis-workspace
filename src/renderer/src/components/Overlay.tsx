import { createPortal } from 'react-dom'

/**
 * Modal renderizado direto no <body>. Necessário porque os painéis usam clip-path
 * (cantos chanfrados), que recorta até descendentes com position: fixed.
 */
export function Overlay({ onClose, children }: { onClose: () => void; children: React.ReactNode }): React.JSX.Element {
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      {children}
    </div>,
    document.body
  )
}
