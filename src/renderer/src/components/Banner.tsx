import type { ReactNode } from 'react'
import { AlertTriangle, Info, X } from '../icons'

export type BannerKind = 'error' | 'warn' | 'info'

interface Props {
  message: ReactNode
  kind?: BannerKind
  /** Optional retry affordance, e.g. re-running a failed load. */
  onRetry?: () => void
  onDismiss?: () => void
  className?: string
}

/**
 * The one inline failure surface. Anything that fails *in place* (a load, a
 * connection, a parse) renders a Banner where the content would be; transient
 * outcomes of a write go to a toast instead. Replaces the old `.error-bar`,
 * `.conn-error` and ad-hoc inline `<small>` errors.
 */
export function Banner({ message, kind = 'error', onRetry, onDismiss, className }: Props): JSX.Element {
  const Glyph = kind === 'info' ? Info : AlertTriangle
  return (
    <div className={`banner banner-${kind}${className ? ` ${className}` : ''}`} role="alert">
      <Glyph className="banner-icon" />
      <span className="banner-msg">{message}</span>
      {onRetry && (
        <button className="banner-action" onClick={onRetry}>
          Retry
        </button>
      )}
      {onDismiss && (
        <button className="banner-close" onClick={onDismiss} title="Dismiss" aria-label="Dismiss">
          <X size={12} />
        </button>
      )}
    </div>
  )
}
