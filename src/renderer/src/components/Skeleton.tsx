interface Props {
  /** Number of placeholder lines. */
  rows?: number
  className?: string
}

/**
 * Placeholder shown while content loads for the *first* time. Once data is on
 * screen a refetch uses `LoadingOverlay` instead, so the layout never collapses
 * back to a skeleton.
 */
export function Skeleton({ rows = 4, className }: Props): JSX.Element {
  return (
    <div className={`skeleton${className ? ` ${className}` : ''}`} aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-row" style={{ width: `${92 - (i % 3) * 14}%` }} />
      ))}
    </div>
  )
}
