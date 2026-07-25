import type { ReactNode } from 'react'

interface Props {
  icon?: ReactNode
  title: string
  hint?: ReactNode
  /** Optional primary action rendered under the hint. */
  action?: ReactNode
  /** Compact variant for empty states inside panels and lists. */
  small?: boolean
}

/** The single "there is nothing here yet" surface: icon, one line, one hint. */
export function EmptyState({ icon, title, hint, action, small }: Props): JSX.Element {
  return (
    <div className={small ? 'empty-state is-small' : 'empty-state'}>
      {icon && <div className="empty-state-icon">{icon}</div>}
      <h2>{title}</h2>
      {hint && <p>{hint}</p>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  )
}
