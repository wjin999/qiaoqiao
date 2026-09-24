import { useEffect, useId, useRef, type ReactNode } from 'react'

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = ref.current!
    const previousFocus = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.showModal()
    return () => { dialog.close(); document.body.style.overflow = previousOverflow; previousFocus?.focus() }
  }, [])
  return (
    <dialog ref={ref} className="deck-modal" aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); onClose() }}>
      <div className="modal-heading">
        <h2 id={titleId}>{title}</h2>
        <button className="close-button" type="button" aria-label={`关闭${title}`} onClick={onClose}>×</button>
      </div>
      {children}
    </dialog>
  )
}
