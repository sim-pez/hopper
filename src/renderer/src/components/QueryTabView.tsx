import { useState } from 'react'
import type { QueryResult } from '@shared/types'
import { useStore } from '../store'
import type { QueryTab } from '../store'
import { DataGrid } from './DataGrid'
import { HistoryPanel } from './HistoryPanel'
import { SavedQueriesPanel } from './SavedQueriesPanel'
import { SqlEditor } from './SqlEditor'
import { useDbMetadata } from '../hooks/useDbMetadata'
import { downloadCsv, downloadXlsx } from '../utils'

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
  const [showHistory, setShowHistory] = useState(false)
  const [showSaved, setShowSaved] = useState(false)
  const [exportFormat, setExportFormat] = useState<'xlsx' | 'csv'>('xlsx')

  const historyKey = `${tab.connectionId}:__query__`

  const run = async () => {
    const trimmed = sql.trim()
    if (!trimmed) return
    setRunning(true)
    setError(null)
    try {
      setResult(await window.api.db.query(tab.connectionId, trimmed))
      void window.api.history.add(historyKey, [{ sql: trimmed, ts: Date.now() }])
    } catch (e) {
      setError(String(e))
      setResult(null)
    } finally {
      setRunning(false)
    }
  }

  const cancel = async () => {
    await window.api.db.cancelQuery(tab.connectionId)
  }

  const save = async () => {
    const trimmed = sql.trim()
    if (!trimmed) return
    const name = prompt('Name this query:')
    if (!name) return
    await window.api.savedQueries.save({ connectionId: tab.connectionId, name, sql: trimmed })
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
          <button className="mini primary" onClick={run} disabled={running}>
            {running ? 'Running…' : '▶ Run (⌘↵)'}
          </button>
          {running && (
            <button className="mini danger" onClick={cancel}>
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
            <>
              <select
                className="mini-select"
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value as 'xlsx' | 'csv')}
                title="Export format"
              >
                <option value="xlsx">XLSX</option>
                <option value="csv">CSV</option>
              </select>
              <button className="mini" onClick={doExport}>
                Export
              </button>
            </>
          )}
          <button className="mini" title="Save this query for reuse" onClick={save}>
            ☆ Save
          </button>
          <button className="mini" title="Saved queries" onClick={() => setShowSaved(true)}>
            Saved
          </button>
          <button className="mini" title="Past queries run on this connection" onClick={() => setShowHistory(true)}>
            History
          </button>
        </div>
      </div>

      {error && <div className="error-bar">{error}</div>}

      {result && <DataGrid columns={result.columns} rows={result.rows} />}

      {showHistory && (
        <HistoryPanel tableKey={historyKey} title={tab.title} onClose={() => setShowHistory(false)} />
      )}
      {showSaved && (
        <SavedQueriesPanel
          connectionId={tab.connectionId}
          title={tab.title}
          onClose={() => setShowSaved(false)}
          onSelect={setSql}
        />
      )}
    </div>
  )
}
