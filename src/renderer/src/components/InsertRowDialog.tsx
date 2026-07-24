import { useState } from 'react'
import type { ColumnMeta } from '@shared/types'
import { parseEdit } from '../utils'
import { Modal } from './Modal'
import { showToast } from '../toast'

interface Props {
  columns: ColumnMeta[]
  onClose: () => void
  onInsert: (values: Record<string, unknown>) => Promise<void>
}

export function InsertRowDialog({ columns, onClose, onInsert }: Props): JSX.Element {
  // undefined = leave out of INSERT (use DB default); '' -> NULL via parseEdit.
  const [vals, setVals] = useState<Record<string, string | undefined>>({})
  const [include, setInclude] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    setSaving(true)
    try {
      const values: Record<string, unknown> = {}
      for (const col of columns) {
        if (include[col.name]) values[col.name] = parseEdit(vals[col.name] ?? '')
      }
      await onInsert(values)
    } catch (e) {
      showToast(`Insert failed: ${e}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  const includedCount = Object.values(include).filter(Boolean).length

  const setAll = (on: boolean) => {
    setInclude(Object.fromEntries(columns.map((c) => [c.name, on])))
  }

  return (
    <Modal onClose={onClose} className="insert-modal">
        <div className="insert-header">
          <div>
            <h3>Insert row</h3>
            <p className="hint">Flip "value" off to use the column's database default. A blank value inserts NULL.</p>
          </div>
          <div className="insert-header-actions">
            <button type="button" className="mini" onClick={() => setAll(true)}>
              All
            </button>
            <button type="button" className="mini" onClick={() => setAll(false)}>
              None
            </button>
          </div>
        </div>

        <div className="insert-grid">
          {columns.map((col) => {
            const on = !!include[col.name]
            return (
              <div key={col.name} className={`insert-field ${on ? '' : 'is-default'}`}>
                <div className="insert-field-head">
                  <span className="insert-field-name">
                    <span className="col-name">{col.name}</span>
                    {col.dataType && <span className="col-type">{col.dataType}</span>}
                  </span>
                  <label className="insert-toggle">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) => setInclude((p) => ({ ...p, [col.name]: e.target.checked }))}
                    />
                    value
                  </label>
                </div>
                <input
                  className="insert-field-input"
                  disabled={!on}
                  placeholder={on ? '' : 'database default'}
                  value={vals[col.name] ?? ''}
                  onChange={(e) => setVals((p) => ({ ...p, [col.name]: e.target.value }))}
                />
              </div>
            )
          })}
        </div>

        <div className="modal-actions">
          <span className="muted">
            {includedCount} of {columns.length} column{columns.length === 1 ? '' : 's'} set
          </span>
          <div className="spacer" />
          <button className="mini" onClick={onClose}>
            Cancel
          </button>
          <button className="mini primary" onClick={submit} disabled={saving}>
            {saving ? 'Inserting…' : 'Insert row'}
          </button>
        </div>
    </Modal>
  )
}
