import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ApplyChangesPayload, ColumnFilter, TableData } from '@shared/types'
import type { TableTab } from '../store'
import { DataGrid } from './DataGrid'
import { InsertRowDialog } from './InsertRowDialog'
import { ConfirmChangesDialog } from './ConfirmChangesDialog'
import { LoadingOverlay } from './LoadingOverlay'
import { Banner } from './Banner'
import { Skeleton } from './Skeleton'
import { downloadXlsx, errorText, historyKey, parseEdit, sqlLiteral } from '../utils'
import { showToast } from '../toast'
import { ArrowLeft, ArrowRight, Download, Filter, Plus, RefreshCw, X } from '../icons'

interface Props {
  tab: TableTab
}

const LIMITS = [50, 100, 200, 500, 1000]

export function TableTabView({ tab }: Props): JSX.Element {
  const [data, setData] = useState<TableData | null>(null)
  const [rows, setRows] = useState<unknown[][]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [limit, setLimit] = useState(100)
  const [offset, setOffset] = useState(0)
  const [sort, setSort] = useState<{ column: string; desc: boolean } | null>(null)
  const [showInsert, setShowInsert] = useState(false)

  // Draft filters the user is editing vs. the ones actually applied to the query.
  const [filters, setFilters] = useState<ColumnFilter[]>([])
  const [activeFilters, setActiveFilters] = useState<ColumnFilter[]>([])

  // Staged, unsaved changes: rowIndex -> { colName: newValue }, plus rows to delete.
  const [edits, setEdits] = useState<Record<number, Record<string, unknown>>>({})
  const [deletes, setDeletes] = useState<Set<number>>(new Set())
  const [preview, setPreview] = useState<string[] | null>(null)
  const [saving, setSaving] = useState(false)

  const recordHistory = (statements: string[]) => {
    const ts = Date.now()
    void window.api.history.add(
      historyKey(tab.connectionId),
      statements.map((sql) => ({ sql, ts }))
    )
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const d = await window.api.db.getTableData(tab.connectionId, tab.schema, tab.table, {
        limit,
        offset,
        orderBy: sort ?? undefined,
        filters: activeFilters.length ? activeFilters : undefined
      })
      setData(d)
      setRows(d.rows.map((r) => [...r]))
      setEdits({})
      setDeletes(new Set())
    } catch (e) {
      setError(errorText(e))
    } finally {
      setLoading(false)
    }
  }, [tab, limit, offset, sort, activeFilters])

  useEffect(() => {
    load()
  }, [load])

  const colIndex = (name: string) => data?.columns.findIndex((c) => c.name === name) ?? -1

  // PK values are read from the ORIGINAL row so edits to a PK still locate the row.
  const pkOf = (rowIndex: number): Record<string, unknown> => {
    const pk: Record<string, unknown> = {}
    for (const k of data!.primaryKeys) pk[k] = data!.rows[rowIndex][colIndex(k)]
    return pk
  }

  const pending = Object.keys(edits).length > 0 || deletes.size > 0

  // Stage a cell edit locally; save happens later via the Save button.
  const onCommitCell = async (rowIndex: number, cIndex: number, text: string): Promise<boolean> => {
    if (!data) return false
    const column = data.columns[cIndex].name
    const value = parseEdit(text)
    setRows((prev) => {
      const next = prev.map((r) => [...r])
      next[rowIndex][cIndex] = value
      return next
    })
    setEdits((prev) => {
      const rowEdits = { ...(prev[rowIndex] ?? {}) }
      // If the value returns to its original, drop it from the staged set.
      const original = data.rows[rowIndex][cIndex]
      if (Object.is(value, original) || value === original) delete rowEdits[column]
      else rowEdits[column] = value
      const next = { ...prev }
      if (Object.keys(rowEdits).length) next[rowIndex] = rowEdits
      else delete next[rowIndex]
      return next
    })
    return true
  }

  const onDeleteRow = (rowIndex: number) => {
    setDeletes((prev) => {
      const next = new Set(prev)
      if (next.has(rowIndex)) next.delete(rowIndex)
      else next.add(rowIndex)
      return next
    })
  }

  const buildPayload = (): ApplyChangesPayload | null => {
    if (!data) return null
    const changes: ApplyChangesPayload['changes'] = []
    for (const idx of deletes) changes.push({ pk: pkOf(idx), del: true })
    for (const key of Object.keys(edits)) {
      const idx = Number(key)
      if (deletes.has(idx)) continue // delete wins over edit
      changes.push({ pk: pkOf(idx), set: edits[idx] })
    }
    return changes.length ? { schema: tab.schema, table: tab.table, changes } : null
  }

  const onSave = async () => {
    const payload = buildPayload()
    if (!payload) return
    try {
      setPreview(await window.api.db.previewChanges(tab.connectionId, payload))
    } catch (e) {
      showToast(`Could not build preview: ${e}`, 'error')
    }
  }

  const onConfirmSave = async () => {
    const payload = buildPayload()
    if (!payload) return
    setSaving(true)
    try {
      await window.api.db.applyChanges(tab.connectionId, payload)
      if (preview) recordHistory(preview)
      setPreview(null)
      await load()
    } catch (e) {
      showToast(`Save failed: ${e}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  const discard = () => {
    if (!data) return
    setRows(data.rows.map((r) => [...r]))
    setEdits({})
    setDeletes(new Set())
  }

  const onSort = (column: string) => {
    setOffset(0)
    setSort((prev) => (prev?.column === column ? { column, desc: !prev.desc } : { column, desc: false }))
  }

  const addFilter = (column: string) => {
    setFilters((prev) => (prev.some((f) => f.column === column) ? prev : [...prev, { column, value: '' }]))
  }
  const applyFilters = () => {
    setOffset(0)
    setActiveFilters(filters.filter((f) => f.value !== ''))
  }
  const clearFilters = () => {
    setFilters([])
    setOffset(0)
    setActiveFilters([])
  }

  const isDirty = useMemo(
    () => (r: number, c: number) => !!(data && edits[r] && data.columns[c].name in edits[r]),
    [data, edits]
  )
  const isDeleted = useMemo(() => (r: number) => deletes.has(r), [deletes])

  return (
    <div className="tab-view">
      <div className="toolbar">
        <button
          className="mini"
          title="Reload data (discards unsaved edits)"
          onClick={load}
          disabled={loading}
        >
          <RefreshCw />
          Refresh
        </button>

        <div className="toolbar-group">
          <button
            className="mini"
            title="Previous page"
            aria-label="Previous page"
            disabled={offset === 0 || loading}
            onClick={() => setOffset(Math.max(0, offset - limit))}
          >
            <ArrowLeft />
          </button>
          <span className="page-info">
            {rows.length ? `${offset + 1}–${offset + rows.length}` : '0'} of {data?.totalRows ?? '…'}
          </span>
          <button
            className="mini"
            title="Next page"
            aria-label="Next page"
            disabled={rows.length < limit || loading}
            onClick={() => setOffset(offset + limit)}
          >
            <ArrowRight />
          </button>
        </div>
        <label className="inline">
          Limit
          <select className="limit-select" value={limit} onChange={(e) => { setOffset(0); setLimit(Number(e.target.value)) }}>
            {LIMITS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>

        <div className="spacer" />

        {data?.editable ? (
          <button className="mini outline" onClick={() => setShowInsert(true)}>
            <Plus />
            Add row
          </button>
        ) : (
          <span className="ro-note" title="Editing needs a primary key (or connection is read-only)">
            Read-only
          </span>
        )}
        {data?.editable && pending && (
          <div className="toolbar-group">
            <button className="mini primary" onClick={onSave} disabled={saving}>
              Save
              <span className="count-badge">{Object.keys(edits).length + deletes.size}</span>
            </button>
            <button className="mini" onClick={discard} disabled={saving}>
              Discard
            </button>
          </div>
        )}

        <div className="spacer" />

        <button
          className="mini"
          title="Download visible rows as an Excel file"
          disabled={!data}
          onClick={() => data && downloadXlsx(`${tab.table}.xlsx`, data.columns, rows)}
        >
          <Download />
          XLSX
        </button>
      </div>

      {filters.length > 0 && (
        <div className="filter-bar">
          <span className="filter-label">
            <Filter size={12} />
            Match any:
          </span>
          {filters.map((f, i) => (
            <span key={`${f.column}-${i}`} className="filter-chip">
              <span className="filter-col">{f.column} ~</span>
              <input
                className="filter-input"
                placeholder="text…"
                value={f.value}
                autoFocus={f.value === ''}
                onChange={(e) =>
                  setFilters((prev) => prev.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))
                }
                onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
              />
              <button
                className="icon-btn-sm"
                title="Remove filter"
                aria-label={`Remove filter on ${f.column}`}
                onClick={() => setFilters((prev) => prev.filter((_, j) => j !== i))}
              >
                <X size={11} />
              </button>
            </span>
          ))}
          <button className="mini primary" onClick={applyFilters} disabled={loading}>
            Apply
          </button>
          <button className="mini" onClick={clearFilters} disabled={loading}>
            Clear
          </button>
        </div>
      )}

      {error && <Banner message={error} onRetry={load} />}

      {!data && loading && <Skeleton rows={8} />}

      {data && (
        <div className="grid-relative">
          <LoadingOverlay show={loading} />
          <DataGrid
            columns={data.columns}
            rows={rows}
            editable={data.editable}
            onCommitCell={onCommitCell}
            onDeleteRow={data.editable ? onDeleteRow : undefined}
            onSort={onSort}
            sortState={sort}
            onSearchColumn={addFilter}
            isDirty={isDirty}
            isDeleted={isDeleted}
          />
        </div>
      )}

      {showInsert && data && (
        <InsertRowDialog
          columns={data.columns}
          onClose={() => setShowInsert(false)}
          onInsert={async (values) => {
            await window.api.db.insertRow(tab.connectionId, { schema: tab.schema, table: tab.table, values })
            const cols = Object.keys(values)
            recordHistory([
              `INSERT INTO ${tab.schema}.${tab.table} (${cols.join(', ')}) VALUES (${cols
                .map((c) => sqlLiteral(values[c]))
                .join(', ')});`
            ])
            setShowInsert(false)
            load()
          }}
        />
      )}

      {preview && (
        <ConfirmChangesDialog
          statements={preview}
          saving={saving}
          onCancel={() => setPreview(null)}
          onConfirm={onConfirmSave}
        />
      )}
    </div>
  )
}
