import { useEffect, useRef, useState } from 'react'
import type { ColumnMeta } from '@shared/types'
import { displayValue, isNull } from '../utils'

interface Props {
  columns: ColumnMeta[]
  rows: unknown[][]
  editable?: boolean
  /** Commit a cell edit. Return true on success (grid updates local value). */
  onCommitCell?: (rowIndex: number, colIndex: number, text: string) => Promise<boolean>
  onDeleteRow?: (rowIndex: number) => void
  /** Sort request when clicking a header (table view only). */
  onSort?: (colName: string) => void
  sortState?: { column: string; desc: boolean } | null
  /** Show a per-column search button (table view only). */
  onSearchColumn?: (colName: string) => void
  /** Whether a cell holds an unsaved edit. */
  isDirty?: (rowIndex: number, colIndex: number) => boolean
  /** Whether a row is marked for deletion. */
  isDeleted?: (rowIndex: number) => boolean
}

interface Editing {
  r: number
  c: number
  text: string
}

export function DataGrid({
  columns,
  rows,
  editable = false,
  onCommitCell,
  onDeleteRow,
  onSort,
  sortState,
  onSearchColumn,
  isDirty,
  isDeleted
}: Props): JSX.Element {
  const [sel, setSel] = useState<{ r: number; c: number } | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const startEdit = (r: number, c: number) => {
    if (!editable) return
    setEditing({ r, c, text: displayValue(rows[r][c]) })
  }

  const commit = async () => {
    if (!editing || !onCommitCell) return
    const { r, c, text } = editing
    if (text !== displayValue(rows[r][c])) {
      const ok = await onCommitCell(r, c, text)
      if (!ok) return // keep editor open on failure
    }
    setEditing(null)
  }

  const onCellKey = (e: React.KeyboardEvent, r: number, c: number) => {
    if (editing) return
    if (e.key === 'Enter' || e.key === 'F2') {
      e.preventDefault()
      startEdit(r, c)
    } else if (editable && e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      setEditing({ r, c, text: e.key })
    }
  }

  return (
    <div className="grid-wrap">
      <table className="grid">
        <thead>
          <tr>
            <th className="rownum" />
            {columns.map((col) => (
              <th key={col.name} title={col.dataType}>
                <span className="th-inner">
                  <span
                    className={onSort ? 'th-label sortable' : 'th-label'}
                    onClick={() => onSort?.(col.name)}
                  >
                    {col.name}
                    {sortState?.column === col.name && (
                      <span className="sort-ind">{sortState.desc ? ' ▼' : ' ▲'}</span>
                    )}
                  </span>
                  {onSearchColumn && (
                    <button
                      className="th-search"
                      title={`Filter ${col.name} (LIKE)`}
                      onClick={(e) => {
                        e.stopPropagation()
                        onSearchColumn(col.name)
                      }}
                    >
                      🔍
                    </button>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => {
            const deleted = isDeleted?.(r) ?? false
            return (
            <tr key={r} className={deleted ? 'row-deleted' : ''}>
              <td className="rownum">
                {onDeleteRow && editable ? (
                  <button
                    className="row-del"
                    title={deleted ? 'Undo delete' : 'Delete row'}
                    onClick={() => onDeleteRow(r)}
                  >
                    {deleted ? '↺' : '✕'}
                  </button>
                ) : (
                  r + 1
                )}
              </td>
              {columns.map((_, c) => {
                const isSel = sel?.r === r && sel?.c === c
                const isEditing = editing?.r === r && editing?.c === c
                const dirty = isDirty?.(r, c) ?? false
                const value = row[c]
                const text = displayValue(value)
                return (
                  <td
                    key={c}
                    tabIndex={0}
                    className={`cell ${isSel ? 'sel' : ''} ${editable ? 'editable' : ''} ${dirty ? 'dirty' : ''}`}
                    onClick={() => setSel({ r, c })}
                    onDoubleClick={() => startEdit(r, c)}
                    onKeyDown={(e) => onCellKey(e, r, c)}
                  >
                    {isEditing ? (
                      <input
                        ref={inputRef}
                        className="cell-input"
                        value={editing.text}
                        onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                        onBlur={commit}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            commit()
                          } else if (e.key === 'Escape') {
                            e.preventDefault()
                            setEditing(null)
                          }
                        }}
                      />
                    ) : isNull(value) ? (
                      <span className="null">NULL</span>
                    ) : (
                      <span className="cell-text" title={text}>{text}</span>
                    )}
                  </td>
                )
              })}
            </tr>
            )
          })}
          {rows.length === 0 && (
            <tr>
              <td className="rownum" />
              <td className="empty-row" colSpan={columns.length}>
                no rows
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
