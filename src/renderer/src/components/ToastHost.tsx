import { useEffect, useState } from 'react'
import { dismissToast, subscribeToasts, type Toast } from '../toast'
import { AlertTriangle, CheckCircle, Info } from '../icons'

const ICONS = {
  error: AlertTriangle,
  success: CheckCircle,
  info: Info
} as const

/** Fixed-position stack of dismissible toasts, mounted once at the app root. */
export function ToastHost(): JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => subscribeToasts(setToasts), [])

  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toasts.map((t) => {
        const Glyph = ICONS[t.kind] ?? Info
        return (
          <div
            key={t.id}
            className={`toast toast-${t.kind}`}
            onClick={() => dismissToast(t.id)}
            title="Dismiss"
          >
            <Glyph className="toast-icon" />
            <span>{t.message}</span>
          </div>
        )
      })}
    </div>
  )
}
