import { useState } from 'react'
import type { QueryResult } from '@shared/types'
import type { QueryTab } from '../store'
import { DataGrid } from './DataGrid'
import { HistoryPanel } from './HistoryPanel'
import { downloadXlsx } from '../utils'

interface Props {
  tab: QueryTab
}

export function QueryTabView({ tab }: Props): JSX.Element {
  const [sql, setSql] = useState('SELECT * FROM ')
  const [result, setResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

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

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      run()
    }
  }

  return (
    <div className="tab-view">
      <div className="query-editor">
        <textarea
          className="mono sql-input"
          value={sql}
          spellCheck={false}
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Write SQL"
        />
        <div className="toolbar">
          <button className="mini primary" onClick={run} disabled={running}>
            {running ? 'Running…' : '▶ Run (⌘↵)'}
          </button>
          {result && (
            <span className="muted">
              {result.command ?? 'rows'}: {result.rowCount} · {result.durationMs} ms
            </span>
          )}
          <div className="spacer" />
          {result && result.rows.length > 0 && (
            <button className="mini" onClick={() => downloadXlsx('query.xlsx', result.columns, result.rows)}>
              Export XLSX
            </button>
          )}
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
    </div>
  )
}
