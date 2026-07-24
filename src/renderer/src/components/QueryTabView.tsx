import { useState } from 'react'
import type { QueryResult } from '@shared/types'
import type { QueryTab } from '../store'
import { DataGrid } from './DataGrid'
import { downloadText, toCsv } from '../utils'

interface Props {
  tab: QueryTab
}

export function QueryTabView({ tab }: Props): JSX.Element {
  const [sql, setSql] = useState('SELECT * FROM ')
  const [result, setResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  const run = async () => {
    setRunning(true)
    setError(null)
    try {
      setResult(await window.api.db.query(tab.connectionId, sql))
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
            <button className="mini" onClick={() => downloadText('query.csv', toCsv(result.columns, result.rows))}>
              Export CSV
            </button>
          )}
        </div>
      </div>

      {error && <div className="error-bar">{error}</div>}

      {result && <DataGrid columns={result.columns} rows={result.rows} />}
    </div>
  )
}
