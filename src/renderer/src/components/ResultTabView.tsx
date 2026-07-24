import { useState } from 'react'
import type { ResultTab } from '../store'
import { DataGrid } from './DataGrid'
import { downloadCsv, downloadXlsx } from '../utils'

interface Props {
  tab: ResultTab
}

/** Read-only view of a query result set opened from the console. */
export function ResultTabView({ tab }: Props): JSX.Element {
  const { result, sql } = tab
  const [exportFormat, setExportFormat] = useState<'xlsx' | 'csv'>('xlsx')

  const doExport = () => {
    if (exportFormat === 'csv') downloadCsv('query.csv', result.columns, result.rows)
    else downloadXlsx('query.xlsx', result.columns, result.rows)
  }

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
      </div>
      <DataGrid columns={result.columns} rows={result.rows} />
    </div>
  )
}
