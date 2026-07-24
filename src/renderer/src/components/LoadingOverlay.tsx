export function LoadingOverlay({ show }: { show: boolean }): JSX.Element | null {
  if (!show) return null
  return (
    <div className="loading-overlay">
      <div className="spinner" />
    </div>
  )
}
