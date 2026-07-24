import { useEffect, useState } from 'react'
import type { QueryHistoryEntry } from '@shared/types'

interface Props {
  /** `${connectionId}:${schema}:${table}` */
  tableKey: string
  title: string
  onClose: () => void
}

/** Modal listing the last 100 statements run against a table. */
export function HistoryPanel({ tableKey, title, onClose }: Props): JSX.Element {
  const [entries, setEntries] = useState<QueryHistoryEntry[]>([])
  const [loading, setLoading] = useState(true)

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

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>History · {title}</h3>
        <p className="hint">Last {entries.length} statement{entries.length === 1 ? '' : 's'} run on this table.</p>
        <div className="history-list">
          {loading && <div className="hint">Loading…</div>}
          {!loading && entries.length === 0 && <div className="hint">No history yet.</div>}
          {entries.map((e, i) => (
            <div key={i} className="history-item">
              <div className="history-meta">
                <span className="muted">{new Date(e.ts).toLocaleString()}</span>
                <button
                  className="mini"
                  title="Copy SQL"
                  onClick={() => navigator.clipboard?.writeText(e.sql)}
                >
                  Copy
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
