import { useEffect, useMemo, useState } from 'react'
import type { QueryHistoryEntry } from '@shared/types'
import { Modal } from './Modal'
import { ConfirmDialog } from './ConfirmDialog'
import { NameQueryDialog } from './NameQueryDialog'
import { Skeleton } from './Skeleton'
import { EmptyState } from './EmptyState'
import { Clock, Copy, CornerDownLeft, Pencil, Search, Star, StarFilled } from '../icons'
import { showToast } from '../toast'

interface Props {
  /** History bucket to show — see `historyKey()` in utils. */
  bucket: string
  title: string
  onClose: () => void
  /** When given, an entry can be loaded back into the editor it came from. */
  onSelect?: (sql: string) => void
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

/** Modal listing the statements run against a connection. Entries can be pinned
 *  to the top, and a pinned entry can be given a name. */
export function HistoryPanel({ bucket, title, onClose, onSelect }: Props): JSX.Element {
  const [entries, setEntries] = useState<QueryHistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [naming, setNaming] = useState<QueryHistoryEntry | null>(null)

  useEffect(() => {
    window.api.history
      .list(bucket)
      .then(setEntries)
      .finally(() => setLoading(false))
  }, [bucket])

  const clear = async () => {
    setConfirmingClear(false)
    await window.api.history.clear(bucket)
    setEntries(await window.api.history.list(bucket))
  }

  // Pinning an unnamed entry asks for a name straight away — that is the only
  // way to label a query now that saved queries are gone.
  const togglePin = async (e: QueryHistoryEntry) => {
    setEntries(await window.api.history.togglePin(bucket, e.id))
    if (!e.pinned) setNaming({ ...e, pinned: true })
  }

  const rename = async (name: string) => {
    const target = naming
    setNaming(null)
    if (target) setEntries(await window.api.history.rename(bucket, target.id, name))
  }

  const copy = (sql: string) => {
    void navigator.clipboard?.writeText(sql)
    showToast('SQL copied', 'success')
  }

  const visible = useMemo(() => {
    if (!filter.trim()) return entries
    const q = filter.toLowerCase()
    return entries.filter((e) => e.sql.toLowerCase().includes(q) || e.name?.toLowerCase().includes(q))
  }, [entries, filter])

  const pinned = visible.filter((e) => e.pinned)
  const recent = visible.filter((e) => !e.pinned)
  const unpinnedCount = entries.filter((e) => !e.pinned).length

  const item = (e: QueryHistoryEntry): JSX.Element => (
    <div key={e.id} className="history-item">
      <div className="history-meta">
        <button
          className={`icon-btn-sm ${e.pinned ? 'is-on' : ''}`}
          title={e.pinned ? 'Unpin' : 'Pin to top'}
          aria-label={e.pinned ? 'Unpin query' : 'Pin query'}
          onClick={() => togglePin(e)}
        >
          {e.pinned ? <StarFilled /> : <Star />}
        </button>
        {e.name ? (
          <strong className="history-name">{e.name}</strong>
        ) : (
          <span className="history-time" title={new Date(e.ts).toLocaleString()}>
            <Clock size={11} />
            {formatTs(e.ts)}
          </span>
        )}
        <span className="spacer" />
        {e.pinned && (
          <button
            className="icon-btn-sm"
            title={e.name ? 'Rename' : 'Name this query'}
            aria-label="Name query"
            onClick={() => setNaming(e)}
          >
            <Pencil />
          </button>
        )}
        <button className="icon-btn-sm" title="Copy SQL" aria-label="Copy SQL" onClick={() => copy(e.sql)}>
          <Copy />
        </button>
        {onSelect && (
          <button
            className="icon-btn-sm"
            title="Load into editor"
            aria-label="Load into editor"
            onClick={() => {
              onSelect(e.sql)
              onClose()
            }}
          >
            <CornerDownLeft />
          </button>
        )}
      </div>
      <pre className="generated-script mono">{e.sql}</pre>
    </div>
  )

  return (
    <>
      <Modal
        onClose={onClose}
        size="xl"
        title={`History · ${title}`}
        footer={
          <>
            <button
              className="mini danger"
              onClick={() => setConfirmingClear(true)}
              disabled={loading || unpinnedCount === 0}
            >
              Clear history
            </button>
            <div className="spacer" />
            <span className="muted">
              {entries.length} statement{entries.length === 1 ? '' : 's'}
            </span>
            <button className="mini" onClick={onClose}>
              Close
            </button>
          </>
        }
      >
        {entries.length > 5 && (
          <input
            className="history-filter"
            placeholder="Filter statements…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            autoFocus
          />
        )}

        {loading ? (
          <Skeleton rows={4} />
        ) : entries.length === 0 ? (
          <EmptyState
            small
            icon={<Clock size={24} />}
            title="No history yet"
            hint="Statements you run here are recorded, and can be pinned for reuse."
          />
        ) : visible.length === 0 ? (
          <EmptyState small icon={<Search size={24} />} title="No matches" hint={`Nothing matches "${filter}".`} />
        ) : (
          <div className="history-list">
            {pinned.length > 0 && (
              <>
                <div className="history-section">Pinned</div>
                {pinned.map(item)}
              </>
            )}
            {recent.length > 0 && (
              <>
                {pinned.length > 0 && <div className="history-section">Recent</div>}
                {recent.map(item)}
              </>
            )}
          </div>
        )}
      </Modal>
      {confirmingClear && (
        <ConfirmDialog
          title="Clear history"
          message="Clear query history? Pinned queries are kept."
          confirmLabel="Clear"
          onCancel={() => setConfirmingClear(false)}
          onConfirm={clear}
        />
      )}
      {naming && (
        <NameQueryDialog initial={naming.name ?? ''} onCancel={() => setNaming(null)} onSave={rename} />
      )}
    </>
  )
}
