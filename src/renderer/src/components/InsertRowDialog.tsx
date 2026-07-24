import { useState } from 'react'
import type { ColumnMeta } from '@shared/types'
import { parseEdit } from '../utils'

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
      alert(`Insert failed: ${e}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Insert row</h3>
        <p className="hint">Unchecked columns use the database default. Empty checked columns insert NULL.</p>
        <div className="insert-grid">
          {columns.map((col) => (
            <div key={col.name} className="insert-row">
              <label className="inline">
                <input
                  type="checkbox"
                  checked={!!include[col.name]}
                  onChange={(e) => setInclude((p) => ({ ...p, [col.name]: e.target.checked }))}
                />
                <span className="col-name">{col.name}</span>
                <span className="col-type">{col.dataType}</span>
              </label>
              <input
                disabled={!include[col.name]}
                value={vals[col.name] ?? ''}
                onChange={(e) => setVals((p) => ({ ...p, [col.name]: e.target.value }))}
              />
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <div className="spacer" />
          <button className="mini" onClick={onClose}>
            Cancel
          </button>
          <button className="mini primary" onClick={submit} disabled={saving}>
            {saving ? 'Inserting…' : 'Insert'}
          </button>
        </div>
      </div>
    </div>
  )
}
