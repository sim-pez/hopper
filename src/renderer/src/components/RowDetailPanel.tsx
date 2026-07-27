import type { ColumnMeta } from '@shared/types'
import { displayValue, isNull } from '../utils'
import { showToast } from '../toast'
import { Copy, PanelRight, X } from '../icons'
import { EmptyState } from './EmptyState'

interface Props {
  columns: ColumnMeta[]
  /** The selected row, or null when nothing is selected. */
  row: unknown[] | null
  onClose: () => void
}

/** Pretty-print JSON so a jsonb column is readable — whether the driver handed
 *  back a parsed object (Postgres) or the raw text (MySQL). */
function formatValue(v: unknown): string {
  if (typeof v === 'object' && v !== null && !(v instanceof Date)) return JSON.stringify(v, null, 2)
  const text = displayValue(v)
  const looksJson = /^\s*[[{]/.test(text)
  if (looksJson) {
    try {
      return JSON.stringify(JSON.parse(text), null, 2)
    } catch {
      /* not JSON after all */
    }
  }
  return text
}

/** The selected row shown one column per line — the way to read a long text or
 *  JSON cell that a grid row can only ever truncate. */
export function RowDetailPanel({ columns, row, onClose }: Props): JSX.Element {
  const copyJson = () => {
    if (!row) return
    const obj = Object.fromEntries(columns.map((c, i) => [c.name, row[i] ?? null]))
    void navigator.clipboard
      .writeText(JSON.stringify(obj, null, 2))
      .then(() => showToast('Row copied as JSON'))
      .catch(() => showToast('Could not write to the clipboard', 'error'))
  }

  return (
    <aside className="rail">
      <div className="rail-header">
        <span className="rail-title">Row detail</span>
        {row && (
          <button className="icon-btn" onClick={copyJson} title="Copy row as JSON" aria-label="Copy row as JSON">
            <Copy size={13} />
          </button>
        )}
        <button className="icon-btn" onClick={onClose} title="Close" aria-label="Close row detail">
          <X size={14} />
        </button>
      </div>
      {row ? (
        <div className="rail-body">
          <dl className="detail-list">
            {columns.map((col, i) => (
              <div key={col.name} className="detail-item">
                <dt title={col.dataType}>{col.name}</dt>
                <dd>
                  {isNull(row[i]) ? (
                    <span className="null">NULL</span>
                  ) : (
                    <pre className="detail-value mono">{formatValue(row[i])}</pre>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : (
        <EmptyState
          small
          icon={<PanelRight size={24} />}
          title="No row selected"
          hint="Click a cell to inspect its row."
        />
      )}
    </aside>
  )
}
