import { useState } from 'react'
import type { QueryResult } from '@shared/types'
import { useStore } from '../store'
import type { QueryTab } from '../store'
import { DataGrid } from './DataGrid'
import { LoadingOverlay } from './LoadingOverlay'
import { ConfirmDialog } from './ConfirmDialog'
import { SqlEditor } from './SqlEditor'
import { Banner } from './Banner'
import { EmptyState } from './EmptyState'
import { useDbMetadata } from '../hooks/useDbMetadata'
import { downloadCsv, downloadXlsx, errorText, historyKey, noWhereGuard } from '../utils'
import { Download, Play, Stop, Zap } from '../icons'

interface Props {
  tab: QueryTab
}

export function QueryTabView({ tab }: Props): JSX.Element {
  const status = useStore((s) => s.statuses[tab.connectionId])
  const connected = status?.state === 'connected'
  const { words } = useDbMetadata(tab.connectionId, connected)

  const [sql, setSql] = useState('SELECT * FROM ')
  const [result, setResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [pendingRun, setPendingRun] = useState<string | null>(null)
  const [exportFormat, setExportFormat] = useState<'xlsx' | 'csv'>('xlsx')


  const doRun = async (trimmed: string) => {
    setRunning(true)
    setError(null)
    // Recorded before running: a statement that fails or is cancelled is exactly
    // the one worth pulling back out of history.
    void window.api.history.add(historyKey(tab.connectionId), [{ sql: trimmed, ts: Date.now() }])
    try {
      setResult(await window.api.db.query(tab.connectionId, trimmed))
    } catch (e) {
      setError(errorText(e))
      setResult(null)
    } finally {
      setRunning(false)
    }
  }

  const run = async () => {
    const trimmed = sql.trim()
    if (!trimmed) return
    if (noWhereGuard(trimmed)) {
      setPendingRun(trimmed)
      return
    }
    await doRun(trimmed)
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
          words={words}
          placeholder="Write SQL"
        />
        <div className="toolbar">
          <button className="mini primary" onClick={run} disabled={running} title="Run (⌘↵)">
            <Play />
            {running ? 'Running…' : 'Run'}
          </button>
          {running && (
            <button className="mini danger" onClick={cancel}>
              <Stop />
              Cancel
            </button>
          )}
          {result && (
            <span className="muted">
              {result.command ?? 'rows'}: {result.rowCount} · {result.durationMs} ms
            </span>
          )}
          <div className="spacer" />
          {result && result.rows.length > 0 && (
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
          )}
        </div>
      </div>

      {error && <Banner message={error} />}

      {result ? (
        <div className="grid-relative">
          <LoadingOverlay show={running} />
          <DataGrid columns={result.columns} rows={result.rows} />
        </div>
      ) : (
        !error && (
          <EmptyState
            icon={<Zap size={28} />}
            title="No results yet"
            hint="Write a statement above and press ⌘↵ to run it."
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
