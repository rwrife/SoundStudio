import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

export function Dialog({ title, eyebrow, drawer = false, onClose, children }: {
  title: string; eyebrow: string; drawer?: boolean; onClose: () => void; children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    const trigger = document.activeElement
    dialog?.showModal()
    return () => {
      dialog?.close()
      if (trigger instanceof HTMLElement) trigger.focus()
    }
  }, [])

  return <dialog ref={ref} className={drawer ? 'dialog drawer' : 'dialog'} aria-labelledby="dialog-title"
    onCancel={event => { event.preventDefault(); onClose() }}
    onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="dialog-content">
      <header className="dialog-header">
        <div><p className="eyebrow">{eyebrow}</p><h2 id="dialog-title">{title}</h2></div>
        <button className="icon-button" aria-label={`Close ${title}`} onClick={onClose} autoFocus><X size={20} /></button>
      </header>
      {children}
    </div>
  </dialog>
}
