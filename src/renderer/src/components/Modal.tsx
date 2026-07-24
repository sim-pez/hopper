import { useEffect, useRef } from 'react'

interface Props {
  onClose: () => void
  children: React.ReactNode
  /** Width variant class, e.g. "insert-modal". */
  className?: string
  /** When false, Escape and backdrop-click do nothing (must be dismissed via an in-content action). */
  dismissible?: boolean
}

const FOCUSABLE = 'input, textarea, select, button, [tabindex]:not([tabindex="-1"])'

/** Accessible modal shell: ARIA dialog semantics, Escape-to-close, a Tab focus
 *  trap scoped to the panel, and focus-in-on-mount / focus-restore-on-unmount. */
export function Modal({ onClose, children, className, dismissible = true }: Props): JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? panelRef.current)?.focus()
    return () => {
      previouslyFocused?.focus?.()
    }
  }, [])

  useEffect(() => {
    if (!dismissible) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [dismissible, onClose])

  const onPanelKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !panelRef.current) return
    const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => !el.hasAttribute('disabled')
    )
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="modal-backdrop" onClick={dismissible ? onClose : undefined}>
      <div
        ref={panelRef}
        className={`modal ${className ?? ''}`}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onPanelKeyDown}
      >
        {children}
      </div>
    </div>
  )
}
