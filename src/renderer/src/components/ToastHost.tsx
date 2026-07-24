import { useEffect, useState } from 'react'
import { dismissToast, subscribeToasts, type Toast } from '../toast'

/** Fixed-position stack of dismissible toasts, mounted once at the app root. */
export function ToastHost(): JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => subscribeToasts(setToasts), [])

  return (
    <div className="toast-host">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => dismissToast(t.id)}>
          {t.message}
        </div>
      ))}
    </div>
  )
}
