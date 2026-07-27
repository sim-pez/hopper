import { useEffect, useRef, type ReactNode } from 'react'
import { X } from '../icons'

interface Props {
  onClose: () => void
  children: ReactNode
  /** Heading rendered in the modal header. */
  title?: ReactNode
  /** Action row pinned below the scrollable body. */
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /** When false, Escape and backdrop-click do nothing (must be dismissed via an in-content action). */
  dismissible?: boolean
}

const FOCUSABLE = 'input, textarea, select, button, [tabindex]:not([tabindex="-1"])'

/** Accessible modal shell: ARIA dialog semantics, Escape-to-close, a Tab focus
 *  trap scoped to the panel, and focus-in-on-mount / focus-restore-on-unmount.
 *  Layout is header / scrolling body / pinned footer. */
export function Modal({
  onClose,
  children,
  title,
  footer,
  size = 'md',
  dismissible = true
}: Props): JSX.Element {
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

  const showHeader = title != null || dismissible

  return (
    <div className="modal-backdrop" onClick={dismissible ? onClose : undefined}>
      <div
        ref={panelRef}
        className={`modal is-${size}`}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onPanelKeyDown}
      >
        {showHeader && (
          <div className="modal-header">
            <h3 className="modal-title">{title}</h3>
            {dismissible && (
              <button className="icon-btn" onClick={onClose} title="Close" aria-label="Close">
                <X size={15} />
              </button>
            )}
          </div>
        )}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  )
}
