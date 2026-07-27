import { useEffect, useRef, useState } from 'react'
import type { ColumnMeta, QueryResult } from '@shared/types'
import { useStore } from '../store'
import { SqlEditor } from './SqlEditor'
import { HistoryPanel } from './HistoryPanel'
import { ConfirmDialog } from './ConfirmDialog'
import { Banner } from './Banner'
import { useDbMetadata } from '../hooks/useDbMetadata'
import { useResizable } from '../hooks/useResizable'
import { errorText, historyKey, noWhereGuard, uid } from '../utils'
import { ChevronDown, ChevronUp, Clock, Play, Stop, Terminal } from '../icons'

interface Props {
  connectionId: string
}

const EMPTY_LOGS: never[] = []

export function ScriptConsole({ connectionId }: Props): JSX.Element {
  const logs = useStore((s) => s.scriptLogs[connectionId] ?? EMPTY_LOGS)
  const conn = useStore((s) => s.connections.find((c) => c.id === connectionId))
  const status = useStore((s) => s.statuses[connectionId])
  const showConsole = useStore((s) => s.showConsole)
  const scriptLogVisible = useStore((s) => s.scriptLogVisible)
  const toggleScriptLog = useStore((s) => s.toggleScriptLog)
  const openTab = useStore((s) => s.openTab)
  const connected = status?.state === 'connected'
  const { vocab, tableRefs } = useDbMetadata(connectionId, connected)

  const [sql, setSql] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [pendingRun, setPendingRun] = useState<string | null>(null)
  const [lastMs, setLastMs] = useState<number | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const [height, resizeHandle] = useResizable({ axis: 'y', min: 140, max: 640, initial: 260, invert: true })

  const cancel = async () => {
    await window.api.db.cancelQuery(connectionId)
  }

  // Result sets open in their own tab; the console only reports non-result outcomes.
  const openResultTab = (querySql: string, result: QueryResult) => {
    const title = querySql.replace(/\s+/g, ' ').trim().slice(0, 28)
    openTab({ kind: 'result', id: uid(), connectionId, title: title || 'result', sql: querySql, result })
  }

  // The script log is collapsible on its own, so the SQL editor can stay open
  // with the port-forward noise out of the way.
  const logShown = logs.length > 0 && scriptLogVisible

  useEffect(() => {
    if (logShown) endRef.current?.scrollIntoView({ block: 'end' })
  }, [logs.length, logShown])

  // Handle psql-style `\d` meta-commands client-side using cached metadata.
  const runMetaCommand = async (cmd: string): Promise<QueryResult> => {
    const [verb, arg] = cmd.split(/\s+/, 2)
    if (verb === '\\dn' || verb === '\\l') {
      const schemas = [...new Set(tableRefs.map((t) => t.schema))].sort()
      return listResult([{ name: 'Schema' }], schemas.map((s) => [s]))
    }
    if (verb === '\\d' || verb === '\\dt') {
      if (!arg) {
        const cols: ColumnMeta[] = [{ name: 'Schema' }, { name: 'Name' }, { name: 'Type' }]
        return listResult(cols, tableRefs.map((t) => [t.schema, t.table, t.type]))
      }
      // Describe a single table (accepts `table` or `schema.table`).
      const dotted = arg.replace(/["`]/g, '').split('.')
      const table = dotted.pop() as string
      const schema = dotted.pop()
      const ref = tableRefs.find((t) => t.table === table && (!schema || t.schema === schema))
      if (!ref) throw new Error(`No such table: ${arg}`)
      const columns = await window.api.db.getColumns(connectionId, ref.schema, ref.table)
      const cols: ColumnMeta[] = [{ name: 'Column' }, { name: 'Type' }]
      return listResult(cols, columns.map((c) => [c.name, c.dataType ?? '']))
    }
    throw new Error(`Unsupported command: ${verb}`)
  }

  const doRun = async (trimmed: string) => {
    // Clear the previous run's outcome up front: a stale "N row(s) affected"
    // left next to a failed run reads as if nothing happened.
    setMessage(null)
    setLastMs(null)

    if (trimmed.startsWith('\\')) {
      setRunning(true)
      setError(null)
      try {
        openResultTab(trimmed, await runMetaCommand(trimmed))
      } catch (e) {
        setError(errorText(e))
      } finally {
        setRunning(false)
      }
      return
    }

    setRunning(true)
    setError(null)
    // Recorded before running: a statement that fails or is cancelled is exactly
    // the one worth pulling back out of history.
    void window.api.history.add(historyKey(connectionId), [{ sql: trimmed, ts: Date.now() }])
    try {
      const res = await window.api.db.query(connectionId, trimmed)
      setLastMs(res.durationMs ?? null)
      if (res.columns.length > 0) {
        // A result set — show it in a dedicated tab, keep the console compact.
        openResultTab(trimmed, res)
      } else {
        setMessage(`${res.command ?? 'OK'} · ${res.rowCount} row(s) affected`)
      }
    } catch (e) {
      setError(errorText(e))
    } finally {
      setRunning(false)
    }
  }

  const run = async () => {
    const trimmed = sql.trim()
    if (!trimmed) return
    if (!trimmed.startsWith('\\') && noWhereGuard(trimmed)) {
      setPendingRun(trimmed)
      return
    }
    await doRun(trimmed)
  }

  return (
    <div className={`console ${logShown ? '' : 'compact'}`} style={logShown ? { height } : undefined}>
      {logShown && (
        <div
          className="resize-handle-y"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize console"
          {...resizeHandle}
        />
      )}
      <div className="console-header">
        <span className="console-title">
          <Terminal size={13} />
          {conn?.name ?? connectionId}
          {status?.scriptRunning && <span className="badge running">script running</span>}
        </span>
        <div className="console-header-right">
          {logs.length > 0 && (
            <button
              className="mini"
              onClick={toggleScriptLog}
              title={scriptLogVisible ? 'Hide script log' : 'Show script log'}
            >
              {scriptLogVisible ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              Log
            </button>
          )}
          <button className="icon-btn" onClick={() => showConsole(null)} title="Hide console" aria-label="Hide console">
            <ChevronDown size={15} />
          </button>
        </div>
      </div>

      {logShown && (
        <div className="console-log mono">
          {logs.map((l, i) => (
            <div key={i} className={`log-line ${l.stream}`}>
              {l.data}
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}

      <SqlEditor
        className="mono sql-input"
        value={sql}
        onChange={setSql}
        onRun={run}
        vocab={vocab}
        placeholder="Write SQL command"
        // Dragged from its top edge, so it grows into the script log above it.
        resize={{ min: 60, max: 480, initial: 110, edge: 'top' }}
      />

      {/* Above the toolbar: at the bottom of the console it sits on the window
          edge, where a failed run is easy to miss. */}
      {error && <Banner message={error} onDismiss={() => setError(null)} />}

      <div className="toolbar">
        <button className="mini primary" onClick={run} disabled={running || !connected} title="Run (⌘↵)">
          <Play />
          {running ? 'Running…' : 'Run'}
        </button>
        {running && (
          <button className="mini danger" onClick={cancel}>
            <Stop />
            Cancel
          </button>
        )}
        {message && <span className="muted">{message}</span>}
        {lastMs != null && <span className="muted">{lastMs} ms</span>}
        <div className="spacer" />
        <span className="muted">results open in a new tab</span>
        <button
          className="mini"
          title="Statements run on this connection"
          onClick={() => setShowHistory(true)}
        >
          <Clock />
          History
        </button>
      </div>

      {showHistory && (
        <HistoryPanel
          bucket={historyKey(connectionId)}
          title={conn?.name ?? connectionId}
          onClose={() => setShowHistory(false)}
          onSelect={setSql}
        />
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

function listResult(columns: ColumnMeta[], rows: unknown[][]): QueryResult {
  return { columns, rows, rowCount: rows.length, command: 'META', durationMs: 0 }
}
