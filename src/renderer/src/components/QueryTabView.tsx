import { useRef, useState } from 'react'
import type { QueryResult } from '@shared/types'
import { buildExplain, isExplain } from '@shared/explain'
import { useStore } from '../store'
import type { QueryTab } from '../store'
import { DataGrid } from './DataGrid'
import { LoadingOverlay } from './LoadingOverlay'
import { ConfirmDialog } from './ConfirmDialog'
import { RowDetailPanel } from './RowDetailPanel'
import { SqlEditor, type EditorSelection } from './SqlEditor'
import { Banner } from './Banner'
import { EmptyState } from './EmptyState'
import { useDbMetadata } from '../hooks/useDbMetadata'
import { sqlToRun } from '../sql/statements'
import { downloadCsv, downloadXlsx, errorText, historyKey, noWhereGuard, planText } from '../utils'
import { Download, Gauge, PanelRight, Play, Stop, Zap } from '../icons'
import { KEY_ROW_DETAIL, KEY_RUN, KEY_RUN_ALL } from '../shortcuts'

interface Props {
  tab: QueryTab
}

export function QueryTabView({ tab }: Props): JSX.Element {
  const status = useStore((s) => s.statuses[tab.connectionId])
  const driver = useStore((s) => s.connections.find((c) => c.id === tab.connectionId)?.driver)
  const connected = status?.state === 'connected'
  const { vocab } = useDbMetadata(tab.connectionId, connected)

  const [sql, setSql] = useState('SELECT * FROM ')
  const [result, setResult] = useState<QueryResult | null>(null)
  const [plan, setPlan] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [pendingRun, setPendingRun] = useState<string | null>(null)
  const [exportFormat, setExportFormat] = useState<'xlsx' | 'csv'>('xlsx')
  const [showDetail, setShowDetail] = useState(false)
  const [detailRow, setDetailRow] = useState<number | null>(null)

  // Where the caret is, so ⌘↵ and the Run button target one statement rather
  // than the whole editor. A ref, because it is read during the run itself.
  const selection = useRef<EditorSelection>({ start: 0, end: 0 })

  const doRun = async (trimmed: string, asPlan = false) => {
    setRunning(true)
    setError(null)
    // Recorded before running: a statement that fails or is cancelled is exactly
    // the one worth pulling back out of history.
    void window.api.history.add(historyKey(tab.connectionId), [{ sql: trimmed, ts: Date.now() }])
    try {
      const res = await window.api.db.query(tab.connectionId, trimmed)
      setResult(res)
      // A Postgres plan is one text column; MySQL's EXPLAIN is a real table, so
      // it keeps the grid.
      setPlan(asPlan ? planText(res) : null)
    } catch (e) {
      setError(errorText(e))
      setResult(null)
      setPlan(null)
    } finally {
      setRunning(false)
    }
  }

  /** The statement ⌘↵ applies to: the selection, else the one at the caret. */
  const targetSql = (): string => sqlToRun(sql, selection.current.start, selection.current.end)

  const start = async (trimmed: string) => {
    if (!trimmed) return
    if (noWhereGuard(trimmed)) {
      setPendingRun(trimmed)
      return
    }
    await doRun(trimmed)
  }

  const run = () => start(targetSql())
  const runAll = () => start(sql.trim())

  const explain = () => {
    const statement = targetSql()
    if (!statement) return
    // Already an EXPLAIN — run it as written instead of wrapping it again.
    doRun(isExplain(statement) ? statement : buildExplain(driver ?? 'postgres', statement), true)
  }

  const cancel = async () => {
    await window.api.db.cancelQuery(tab.connectionId)
  }

  const doExport = () => {
    if (!result) return
    if (exportFormat === 'csv') downloadCsv('query.csv', result.columns, result.rows)
    else downloadXlsx('query.xlsx', result.columns, result.rows)
  }

  return (
    <div className="tab-view">
      <div className="query-editor">
        <SqlEditor
          className="mono sql-input"
          value={sql}
          onChange={setSql}
          onRun={run}
          onRunAll={runAll}
          onSelectionChange={(sel) => {
            selection.current = sel
          }}
          vocab={vocab}
          placeholder="Write SQL"
          resize={{ min: 70, max: 600, initial: 130 }}
        />
        <div className="toolbar">
          <button
            className="mini primary"
            onClick={run}
            disabled={running}
            title={`Run the statement at the caret (${KEY_RUN}) — ${KEY_RUN_ALL} runs the whole editor`}
          >
            <Play />
            {running ? 'Running…' : 'Run'}
          </button>
          <button
            className="mini"
            onClick={explain}
            disabled={running}
            title="Show the query plan. ANALYZE (which executes the statement) is only used for a plain SELECT."
          >
            <Gauge />
            Explain
          </button>
          {running && (
            <button className="mini danger" onClick={cancel}>
              <Stop />
              Cancel
            </button>
          )}
          {result && !plan && (
            <span className="muted">
              {result.command ?? 'rows'}: {result.rowCount} · {result.durationMs} ms
            </span>
          )}
          {plan && <span className="muted">query plan · {result?.durationMs} ms</span>}
          <div className="spacer" />
          {result && result.rows.length > 0 && !plan && (
            <>
              <div className="toolbar-group">
                <select
                  className="mini-select"
                  value={exportFormat}
                  onChange={(e) => setExportFormat(e.target.value as 'xlsx' | 'csv')}
                  title="Export format"
                  aria-label="Export format"
                >
                  <option value="xlsx">XLSX</option>
                  <option value="csv">CSV</option>
                </select>
                <button className="mini" onClick={doExport}>
                  <Download />
                  Export
                </button>
              </div>
              <button
                className={showDetail ? 'icon-btn is-on' : 'icon-btn'}
                aria-pressed={showDetail}
                aria-label="Row detail"
                title={`Row detail (${KEY_ROW_DETAIL})`}
                onClick={() => setShowDetail((v) => !v)}
              >
                <PanelRight size={14} />
              </button>
            </>
          )}
        </div>
      </div>

      {error && <Banner message={error} />}

      {plan ? (
        <pre className="plan mono">{plan}</pre>
      ) : result ? (
        <div className="grid-with-rail">
          <div className="grid-relative">
            <LoadingOverlay show={running} />
            <DataGrid
              columns={result.columns}
              rows={result.rows}
              onAnchorChange={setDetailRow}
              onToggleDetail={() => setShowDetail((v) => !v)}
            />
          </div>
          {showDetail && (
            <RowDetailPanel
              columns={result.columns}
              row={detailRow != null ? (result.rows[detailRow] ?? null) : null}
              onClose={() => setShowDetail(false)}
            />
          )}
        </div>
      ) : (
        !error && (
          <EmptyState
            icon={<Zap size={28} />}
            title="No results yet"
            hint={`Write a statement above and press ${KEY_RUN} to run it.`}
          />
        )
      )}

      {pendingRun && (
        <ConfirmDialog
          title="No WHERE clause"
          message={`This ${noWhereGuard(pendingRun)} has no WHERE clause and will affect EVERY row. Run it anyway?`}
          confirmLabel="Run anyway"
          onCancel={() => setPendingRun(null)}
          onConfirm={() => {
            const trimmed = pendingRun
            setPendingRun(null)
            doRun(trimmed)
          }}
        />
      )}
    </div>
  )
}
