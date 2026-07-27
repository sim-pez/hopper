import { useState } from 'react'
import type { ResultTab } from '../store'
import { DataGrid } from './DataGrid'
import { RowDetailPanel } from './RowDetailPanel'
import { downloadCsv, downloadXlsx } from '../utils'
import { Download, PanelRight } from '../icons'

interface Props {
  tab: ResultTab
}

/** Read-only view of a query result set opened from the console. */
export function ResultTabView({ tab }: Props): JSX.Element {
  const { result, sql, plan } = tab
  const [exportFormat, setExportFormat] = useState<'xlsx' | 'csv'>('xlsx')
  const [showDetail, setShowDetail] = useState(false)
  const [detailRow, setDetailRow] = useState<number | null>(null)

  const doExport = () => {
    if (exportFormat === 'csv') downloadCsv('query.csv', result.columns, result.rows)
    else downloadXlsx('query.xlsx', result.columns, result.rows)
  }

  return (
    <div className="tab-view">
      <div className="toolbar">
        <span className="muted">
          {plan ? 'query plan' : `${result.command ?? 'rows'}: ${result.rowCount}`}
          {result.durationMs != null && ` · ${result.durationMs} ms`}
        </span>
        <span className="sep" />
        <code className="result-sql" title={sql}>
          {sql}
        </code>
        <div className="spacer" />
        {!plan && result.rows.length > 0 && (
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
              <Download />
              Export
            </button>
            <button
              className={showDetail ? 'icon-btn is-on' : 'icon-btn'}
              aria-pressed={showDetail}
              aria-label="Row detail"
              title="Row detail (⌘⇧E)"
              onClick={() => setShowDetail((v) => !v)}
            >
              <PanelRight size={14} />
            </button>
          </>
        )}
      </div>

      {plan ? (
        <pre className="plan mono">{plan}</pre>
      ) : (
        <div className="grid-with-rail">
          <div className="grid-relative">
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
      )}
    </div>
  )
}
