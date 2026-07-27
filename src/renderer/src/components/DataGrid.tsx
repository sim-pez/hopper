import { useCallback, useEffect, useRef, useState } from 'react'
import type { ColumnMeta } from '@shared/types'
import { displayValue, isNull } from '../utils'
import { showToast } from '../toast'
import { ArrowUpRight, ChevronDown, ChevronUp, RotateCcw, Search, X } from '../icons'

/** Where a column's foreign key points. */
export interface FkTarget {
  schema: string
  table: string
  column: string
}

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
  /** Column name -> the row it references. Those cells get a "follow" button. */
  foreignKeys?: Record<string, FkTarget>
  /** Follow the foreign key on `column` for `value`. */
  onFollowFk?: (target: FkTarget, value: unknown) => void
  /** The row the selection anchor sits on, so the parent can show its detail. */
  onAnchorChange?: (rowIndex: number | null) => void
  /** ⌘⇧E from a cell — the parent opens or closes the row detail panel. */
  onToggleDetail?: () => void
}

interface Editing {
  r: number
  c: number
  text: string
}

/** Rectangular selection: the anchor cell the drag started on, plus its far corner. */
interface Selection {
  r: number
  c: number
  r2: number
  c2: number
}

/** Arrow key -> [row delta, column delta]. */
const ARROWS: Record<string, [number, number] | undefined> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1]
}

const bounds = (s: Selection) => ({
  r1: Math.min(s.r, s.r2),
  r2: Math.max(s.r, s.r2),
  c1: Math.min(s.c, s.c2),
  c2: Math.max(s.c, s.c2)
})

function inSelection(sel: Selection | null, r: number, c: number): boolean {
  if (!sel) return false
  const b = bounds(sel)
  return r >= b.r1 && r <= b.r2 && c >= b.c1 && c <= b.c2
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
  isDeleted,
  foreignKeys,
  onFollowFk,
  onAnchorChange,
  onToggleDetail
}: Props): JSX.Element {
  const [sel, setSel] = useState<Selection | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const tableRef = useRef<HTMLTableElement>(null)
  // True between mousedown and mouseup, so hovering a cell extends the selection.
  const dragging = useRef(false)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  useEffect(() => {
    const stop = () => {
      dragging.current = false
    }
    document.addEventListener('mouseup', stop)
    return () => document.removeEventListener('mouseup', stop)
  }, [])

  // Report the anchor row so a detail panel can follow the selection.
  useEffect(() => {
    onAnchorChange?.(sel ? sel.r : null)
  }, [sel?.r, onAnchorChange])

  /** Selected cells as TSV, with the selected columns' names as a header row. */
  const copySelection = useCallback(() => {
    if (!sel) return
    const { r1, r2, c1, c2 } = bounds(sel)
    const cells = (row: unknown[]) => {
      const out: string[] = []
      for (let c = c1; c <= c2; c++) out.push(displayValue(row[c]).replace(/[\t\r\n]+/g, ' '))
      return out.join('\t')
    }
    const header = columns.slice(c1, c2 + 1).map((col) => col.name).join('\t')
    const body: string[] = []
    for (let r = r1; r <= r2; r++) body.push(cells(rows[r] ?? []))
    const count = (r2 - r1 + 1) * (c2 - c1 + 1)
    void navigator.clipboard
      .writeText([header, ...body].join('\n'))
      .then(() => showToast(`Copied ${count} cell${count === 1 ? '' : 's'} with header`))
      .catch(() => showToast('Could not write to the clipboard', 'error'))
  }, [sel, columns, rows])

  /** Keep DOM focus on the selected cell so the arrow keys keep working. */
  const focusCell = (r: number, c: number) => {
    const el = tableRef.current?.querySelector<HTMLElement>(`td.cell[data-r="${r}"][data-c="${c}"]`)
    el?.focus()
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

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
    // Copy never opens the editor: it works straight off the selection.
    if ((e.metaKey || e.ctrlKey) && (e.key === 'c' || e.key === 'C')) {
      e.preventDefault()
      copySelection()
      return
    }
    if (onToggleDetail && (e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'e' || e.key === 'E')) {
      e.preventDefault()
      onToggleDetail()
      return
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault()
      setSel({ r: 0, c: 0, r2: Math.max(rows.length - 1, 0), c2: Math.max(columns.length - 1, 0) })
      return
    }
    if (e.key === 'Enter' || e.key === 'F2') {
      e.preventDefault()
      startEdit(r, c)
      return
    }
    const step = ARROWS[e.key]
    if (step) {
      e.preventDefault()
      const nr = Math.min(Math.max(r + step[0], 0), rows.length - 1)
      const nc = Math.min(Math.max(c + step[1], 0), columns.length - 1)
      // Shift keeps the anchor and stretches the block; a bare arrow moves it.
      if (e.shiftKey && sel) setSel({ ...sel, r2: nr, c2: nc })
      else {
        setSel({ r: nr, c: nc, r2: nr, c2: nc })
        focusCell(nr, nc)
      }
      return
    }
    if (editable && e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      setEditing({ r, c, text: e.key })
    }
  }

  const onCellMouseDown = (e: React.MouseEvent, r: number, c: number) => {
    if (e.button !== 0) return
    dragging.current = true
    if (e.shiftKey && sel) setSel({ ...sel, r2: r, c2: c })
    else setSel({ r, c, r2: r, c2: c })
  }

  const onCellMouseEnter = (r: number, c: number) => {
    if (!dragging.current || editing) return
    setSel((s) => (s ? { ...s, r2: r, c2: c } : s))
  }

  return (
    <div className="grid-wrap">
      <table className="grid" ref={tableRef}>
        <thead>
          <tr>
            <th className="rownum" />
            {columns.map((col) => {
              const sorted = sortState?.column === col.name
              return (
                <th
                  key={col.name}
                  title={col.dataType}
                  aria-sort={sorted ? (sortState!.desc ? 'descending' : 'ascending') : undefined}
                >
                  <span className="th-inner">
                    <span
                      className={onSort ? 'th-label sortable' : 'th-label'}
                      onClick={() => onSort?.(col.name)}
                    >
                      {col.name}
                      {sorted &&
                        (sortState!.desc ? (
                          <ChevronDown className="sort-ind" size={12} />
                        ) : (
                          <ChevronUp className="sort-ind" size={12} />
                        ))}
                    </span>
                    {onSearchColumn && (
                      <button
                        className="th-search"
                        title={`Filter ${col.name} (LIKE)`}
                        aria-label={`Filter ${col.name}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          onSearchColumn(col.name)
                        }}
                      >
                        <Search size={12} />
                      </button>
                    )}
                  </span>
                </th>
              )
            })}
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
                      aria-label={deleted ? `Undo delete of row ${r + 1}` : `Delete row ${r + 1}`}
                      onClick={() => onDeleteRow(r)}
                    >
                      {deleted ? <RotateCcw size={12} /> : <X size={12} />}
                    </button>
                  ) : (
                    r + 1
                  )}
                </td>
                {columns.map((col, c) => {
                  const isSel = inSelection(sel, r, c)
                  const isAnchor = sel?.r === r && sel?.c === c
                  const isEditing = editing?.r === r && editing?.c === c
                  const dirty = isDirty?.(r, c) ?? false
                  const value = row[c]
                  const text = displayValue(value)
                  // A NULL references nothing, so it gets no follow button.
                  const fk = !isNull(value) ? foreignKeys?.[col.name] : undefined
                  return (
                    <td
                      key={c}
                      tabIndex={0}
                      data-r={r}
                      data-c={c}
                      className={`cell ${isSel ? 'sel' : ''} ${isAnchor ? 'anchor' : ''} ${
                        editable ? 'editable' : ''
                      } ${dirty ? 'dirty' : ''}`}
                      onMouseDown={(e) => onCellMouseDown(e, r, c)}
                      onMouseEnter={() => onCellMouseEnter(r, c)}
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
                        <>
                          <span className="cell-text" title={text}>
                            {text}
                          </span>
                          {fk && onFollowFk && (
                            <button
                              className="cell-fk"
                              title={`Open ${fk.table} where ${fk.column} = ${text}`}
                              aria-label={`Open referenced row in ${fk.table}`}
                              // Not a drag start: keep the click from moving the selection.
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation()
                                onFollowFk(fk, value)
                              }}
                            >
                              <ArrowUpRight size={11} />
                            </button>
                          )}
                        </>
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
                No rows
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
