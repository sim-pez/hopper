import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ApplyChangesPayload, ColumnFilter, TableData, TableStructure } from '@shared/types'
import { useStore } from '../store'
import type { TableTab } from '../store'
import { DataGrid, type FkTarget } from './DataGrid'
import { InsertRowDialog } from './InsertRowDialog'
import { ConfirmChangesDialog } from './ConfirmChangesDialog'
import { LoadingOverlay } from './LoadingOverlay'
import { RowDetailPanel } from './RowDetailPanel'
import { StructurePanel } from './StructurePanel'
import { Banner } from './Banner'
import { Skeleton } from './Skeleton'
import {
  describeFilters,
  downloadCsv,
  downloadXlsx,
  errorText,
  FILTER_OPS,
  historyKey,
  opTakesValue,
  parseEdit,
  sqlLiteral,
  uid
} from '../utils'
import { showToast } from '../toast'
import { ArrowLeft, ArrowRight, Columns, Download, Filter, PanelRight, Plus, RefreshCw, X } from '../icons'
import { KEY_ROW_DETAIL } from '../shortcuts'

interface Props {
  tab: TableTab
}

const LIMITS = [50, 100, 200, 500, 1000]

/** Hard stop on a full-table export, so a huge table can't exhaust memory. */
const MAX_EXPORT_ROWS = 100_000

/** Combined scope + format, so exporting stays two controls instead of three. */
const EXPORT_CHOICES = [
  { value: 'page-xlsx', label: 'Page · XLSX' },
  { value: 'page-csv', label: 'Page · CSV' },
  { value: 'all-xlsx', label: 'All rows · XLSX' },
  { value: 'all-csv', label: 'All rows · CSV' }
] as const
type ExportChoice = (typeof EXPORT_CHOICES)[number]['value']

/** Which panel, if any, the right rail shows. */
type Rail = 'none' | 'structure' | 'row'

export function TableTabView({ tab }: Props): JSX.Element {
  const openTab = useStore((s) => s.openTab)
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
  const [filterJoin, setFilterJoin] = useState<'and' | 'or'>('and')

  const [structure, setStructure] = useState<TableStructure | null>(null)
  const [structureError, setStructureError] = useState<string | null>(null)
  const [rail, setRail] = useState<Rail>('none')
  const [detailRow, setDetailRow] = useState<number | null>(null)

  const [exportChoice, setExportChoice] = useState<ExportChoice>('page-xlsx')
  const [exporting, setExporting] = useState(false)

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
        filters: activeFilters.length ? activeFilters : undefined,
        filterJoin
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
    // Deliberately keyed on the identifying fields, not the whole tab: following
    // a foreign key rewrites the tab's title and filters, which must not by
    // itself trigger a second fetch on top of the one the new filters cause.
  }, [tab.connectionId, tab.schema, tab.table, limit, offset, sort, activeFilters, filterJoin])

  useEffect(() => {
    load()
  }, [load])

  // Foreign keys are needed for the grid's follow buttons whether or not the
  // structure pane is open, so they are fetched here rather than in the pane.
  useEffect(() => {
    let cancelled = false
    setStructure(null)
    setStructureError(null)
    window.api.db
      .getStructure(tab.connectionId, tab.schema, tab.table)
      .then((s) => !cancelled && setStructure(s))
      .catch((e) => !cancelled && setStructureError(errorText(e)))
    return () => {
      cancelled = true
    }
  }, [tab.connectionId, tab.schema, tab.table])

  // Arriving by way of a foreign key: adopt the filters the link carried. The
  // store hands over a fresh array each time, so re-following fires this again.
  useEffect(() => {
    if (!tab.initialFilters) return
    setFilters(tab.initialFilters)
    setActiveFilters(tab.initialFilters)
    setFilterJoin('and')
    setOffset(0)
  }, [tab.initialFilters])

  /** Column name -> where it points. Composite keys are skipped: one cell can't
   *  express a multi-column match. */
  const fkByColumn = useMemo(() => {
    const map: Record<string, FkTarget> = {}
    for (const fk of structure?.foreignKeys ?? []) {
      if (fk.columns.length === 1 && fk.refColumns.length === 1) {
        map[fk.columns[0]] = { schema: fk.refSchema, table: fk.refTable, column: fk.refColumns[0] }
      }
    }
    return map
  }, [structure])

  const openTable = (schema: string, table: string, initialFilters?: ColumnFilter[]) => {
    const conn = useStore.getState().connections.find((c) => c.id === tab.connectionId)
    const suffix = initialFilters?.length ? ` [${describeFilters(initialFilters)}]` : ''
    openTab({
      kind: 'table',
      id: uid(),
      connectionId: tab.connectionId,
      schema,
      table,
      title: `${table}${suffix} · ${conn?.name ?? ''}`.trim(),
      initialFilters
    })
  }

  const followFk = (target: FkTarget, value: unknown) => {
    openTable(target.schema, target.table, [
      { column: target.column, op: 'eq', value: String(value) }
    ])
  }

  const colIndex = (name: string) => data?.columns.findIndex((c) => c.name === name) ?? -1

  // PK values are read from the ORIGINAL row so edits to a PK still locate the row.
  const pkOf = (rowIndex: number): Record<string, unknown> => {
    const pk: Record<string, unknown> = {}
    for (const k of data!.primaryKeys) pk[k] = data!.rows[rowIndex][colIndex(k)]
    return pk
  }

  const editCount = Object.keys(edits).length + deletes.size
  const pending = editCount > 0

  // Reported to the store so the tab bar and app-quit confirmation know this
  // tab has unsaved changes, without lifting `edits`/`deletes` themselves.
  useEffect(() => {
    const setTabDirty = useStore.getState().setTabDirty
    setTabDirty(tab.id, editCount)
    return () => setTabDirty(tab.id, 0)
  }, [tab.id, editCount])

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
    setFilters((prev) =>
      prev.some((f) => f.column === column) ? prev : [...prev, { column, op: 'contains', value: '' }]
    )
  }
  const applyFilters = () => {
    setOffset(0)
    setActiveFilters(filters.filter((f) => !opTakesValue(f.op) || f.value !== ''))
  }
  const clearFilters = () => {
    setFilters([])
    setOffset(0)
    setActiveFilters([])
  }

  const doExport = async () => {
    if (!data) return
    const [scope, format] = exportChoice.split('-') as ['page' | 'all', 'xlsx' | 'csv']
    const name = `${tab.table}.${format}`
    const write = (columns: typeof data.columns, out: unknown[][]) =>
      format === 'csv' ? downloadCsv(name, columns, out) : downloadXlsx(name, columns, out)

    if (scope === 'page') return write(data.columns, rows)

    setExporting(true)
    try {
      const res = await window.api.db.exportTableData(tab.connectionId, tab.schema, tab.table, {
        orderBy: sort ?? undefined,
        filters: activeFilters.length ? activeFilters : undefined,
        filterJoin,
        maxRows: MAX_EXPORT_ROWS
      })
      write(res.columns, res.rows)
      if (res.rowCount >= MAX_EXPORT_ROWS) {
        showToast(`Export stopped at the ${MAX_EXPORT_ROWS.toLocaleString()}-row limit`, 'error')
      } else {
        showToast(`Exported ${res.rowCount.toLocaleString()} rows`, 'success')
      }
    } catch (e) {
      showToast(`Export failed: ${errorText(e)}`, 'error')
    } finally {
      setExporting(false)
    }
  }

  const toggleRail = (which: Rail) => setRail((prev) => (prev === which ? 'none' : which))

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
        <div className="spacer" />

        <div className="toolbar-group">
          <select
            className="mini-select"
            value={exportChoice}
            onChange={(e) => setExportChoice(e.target.value as ExportChoice)}
            title="What to export, and in which format"
            aria-label="Export scope and format"
          >
            {EXPORT_CHOICES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <button className="mini" onClick={doExport} disabled={!data || exporting}>
            <Download />
            {exporting ? 'Exporting…' : 'Export'}
          </button>
        </div>

        <div className="toolbar-group">
          <button
            className={rail === 'structure' ? 'icon-btn is-on' : 'icon-btn'}
            aria-pressed={rail === 'structure'}
            aria-label="Table structure"
            title="Table structure"
            onClick={() => toggleRail('structure')}
          >
            <Columns size={14} />
          </button>
          <button
            className={rail === 'row' ? 'icon-btn is-on' : 'icon-btn'}
            aria-pressed={rail === 'row'}
            aria-label="Row detail"
            title={`Row detail (${KEY_ROW_DETAIL})`}
            onClick={() => toggleRail('row')}
          >
            <PanelRight size={14} />
          </button>
        </div>
      </div>

      {filters.length > 0 && (
        <div className="filter-bar">
          <span className="filter-label">
            <Filter size={12} />
            Match
            <select
              className="mini-select"
              value={filterJoin}
              onChange={(e) => setFilterJoin(e.target.value as 'and' | 'or')}
              aria-label="Combine filters with AND or OR"
            >
              <option value="and">all</option>
              <option value="or">any</option>
            </select>
          </span>
          {filters.map((f, i) => (
            <span key={`${f.column}-${i}`} className="filter-chip">
              <span className="filter-col">{f.column}</span>
              <select
                className="filter-op"
                value={f.op}
                aria-label={`Comparison for ${f.column}`}
                onChange={(e) =>
                  setFilters((prev) =>
                    prev.map((x, j) => (j === i ? { ...x, op: e.target.value as ColumnFilter['op'] } : x))
                  )
                }
              >
                {FILTER_OPS.map((o) => (
                  <option key={o.op} value={o.op} title={o.title}>
                    {o.symbol}
                  </option>
                ))}
              </select>
              {opTakesValue(f.op) && (
                <input
                  className="filter-input"
                  placeholder={f.op === 'in' ? 'a, b, c' : 'value…'}
                  value={f.value}
                  autoFocus={f.value === ''}
                  onChange={(e) =>
                    setFilters((prev) => prev.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))
                  }
                  onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
                />
              )}
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
        <div className="grid-with-rail">
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
              foreignKeys={fkByColumn}
              onFollowFk={followFk}
              onAnchorChange={setDetailRow}
              onToggleDetail={() => toggleRail('row')}
            />
            {data.editable && pending && (
              <div className="grid-float-actions">
                <span className="count-badge">{editCount}</span>
                <button className="mini" onClick={discard} disabled={saving}>
                  Discard
                </button>
                <button className="mini primary" onClick={onSave} disabled={saving}>
                  Save
                </button>
              </div>
            )}
          </div>
          {rail === 'structure' && (
            <StructurePanel
              structure={structure}
              error={structureError}
              onClose={() => setRail('none')}
              onOpenTable={(schema, table) => openTable(schema, table)}
            />
          )}
          {rail === 'row' && (
            <RowDetailPanel
              columns={data.columns}
              row={detailRow != null ? (rows[detailRow] ?? null) : null}
              onClose={() => setRail('none')}
            />
          )}
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
