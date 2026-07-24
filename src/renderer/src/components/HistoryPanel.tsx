import { useEffect, useMemo, useState } from 'react'
import type { QueryHistoryEntry } from '@shared/types'

interface Props {
  /** Opaque history bucket key, e.g. `${connectionId}:${schema}:${table}` or `${connectionId}:__query__`. */
  tableKey: string
  title: string
  onClose: () => void
}

/** Same-day entries show just the time; older ones get a short date too. */
function formatTs(ts: number): string {
  const d = new Date(ts)
  const sameDay = d.toDateString() === new Date().toDateString()
  return sameDay
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
        ' ' +
        d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** Modal listing the last 100 statements run against a table (or connection). */
export function HistoryPanel({ tableKey, title, onClose }: Props): JSX.Element {
  const [entries, setEntries] = useState<QueryHistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    window.api.history
      .list(tableKey)
      .then(setEntries)
      .finally(() => setLoading(false))
  }, [tableKey])

  const clear = async () => {
    if (!confirm('Clear query history for this table?')) return
    await window.api.history.clear(tableKey)
    setEntries([])
  }

  const visible = useMemo(() => {
    if (!filter.trim()) return entries
    const q = filter.toLowerCase()
    return entries.filter((e) => e.sql.toLowerCase().includes(q))
  }, [entries, filter])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>History · {title}</h3>
        <p className="hint">{entries.length} statement{entries.length === 1 ? '' : 's'} recorded.</p>

        {entries.length > 5 && (
          <input
            className="history-filter"
            placeholder="Filter statements…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            autoFocus
          />
        )}

        <div className="history-list">
          {loading && <div className="hint">Loading…</div>}
          {!loading && entries.length === 0 && <div className="hint">No history yet.</div>}
          {!loading && entries.length > 0 && visible.length === 0 && (
            <div className="hint">No statements match "{filter}".</div>
          )}
          {visible.map((e, i) => (
            <div key={i} className="history-item">
              <div className="history-meta">
                <span className="history-time" title={new Date(e.ts).toLocaleString()}>
                  {formatTs(e.ts)}
                </span>
                <button
                  className="icon-btn-sm"
                  title="Copy SQL"
                  onClick={() => navigator.clipboard?.writeText(e.sql)}
                >
                  ⧉
                </button>
              </div>
              <pre className="generated-script mono">{e.sql}</pre>
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button className="mini danger" onClick={clear} disabled={loading || entries.length === 0}>
            Clear history
          </button>
          <div className="spacer" />
          <button className="mini" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
