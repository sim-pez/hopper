import type { ResultTab } from '../store'
import { DataGrid } from './DataGrid'
import { downloadXlsx } from '../utils'

interface Props {
  tab: ResultTab
}

/** Read-only view of a query result set opened from the console. */
export function ResultTabView({ tab }: Props): JSX.Element {
  const { result, sql } = tab
  return (
    <div className="tab-view">
      <div className="toolbar">
        <span className="muted">
          {result.command ?? 'rows'}: {result.rowCount}
          {result.durationMs != null && ` · ${result.durationMs} ms`}
        </span>
        <span className="sep" />
        <code className="result-sql" title={sql}>
          {sql}
        </code>
        <div className="spacer" />
        {result.rows.length > 0 && (
          <button className="mini" onClick={() => downloadXlsx('query.xlsx', result.columns, result.rows)}>
            Export XLSX
          </button>
        )}
      </div>
      <DataGrid columns={result.columns} rows={result.rows} />
    </div>
  )
}
