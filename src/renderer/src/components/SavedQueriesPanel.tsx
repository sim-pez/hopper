import { useEffect, useState } from 'react'
import type { SavedQuery } from '@shared/types'

interface Props {
  connectionId: string
  title: string
  onClose: () => void
  /** Load a saved query's SQL back into the editor. */
  onSelect: (sql: string) => void
}

/** Modal listing named/pinned queries saved against a connection. */
export function SavedQueriesPanel({ connectionId, title, onClose, onSelect }: Props): JSX.Element {
  const [entries, setEntries] = useState<SavedQuery[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = () => window.api.savedQueries.list(connectionId).then(setEntries)

  useEffect(() => {
    refresh()
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId])

  const togglePin = async (id: string) => {
    await window.api.savedQueries.togglePin(id)
    refresh()
  }

  const remove = async (q: SavedQuery) => {
    if (!confirm(`Delete saved query "${q.name}"?`)) return
    await window.api.savedQueries.delete(q.id)
    refresh()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Saved queries · {title}</h3>
        <p className="hint">{entries.length} saved quer{entries.length === 1 ? 'y' : 'ies'}.</p>

        <div className="history-list">
          {loading && <div className="hint">Loading…</div>}
          {!loading && entries.length === 0 && (
            <div className="hint">No saved queries yet. Use "Save" to pin one for reuse.</div>
          )}
          {entries.map((q) => (
            <div key={q.id} className="history-item">
              <div className="history-meta">
                <button
                  className="icon-btn-sm"
                  title={q.pinned ? 'Unpin' : 'Pin'}
                  onClick={() => togglePin(q.id)}
                >
                  {q.pinned ? '★' : '☆'}
                </button>
                <strong className="saved-query-name">{q.name}</strong>
                <span className="spacer" />
                <button
                  className="icon-btn-sm"
                  title="Copy SQL"
                  onClick={() => navigator.clipboard?.writeText(q.sql)}
                >
                  ⧉
                </button>
                <button
                  className="icon-btn-sm"
                  title="Load into editor"
                  onClick={() => {
                    onSelect(q.sql)
                    onClose()
                  }}
                >
                  ↩
                </button>
                <button className="icon-btn-sm danger" title="Delete" onClick={() => remove(q)}>
                  ✕
                </button>
              </div>
              <pre className="generated-script mono">{q.sql}</pre>
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <div className="spacer" />
          <button className="mini" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
