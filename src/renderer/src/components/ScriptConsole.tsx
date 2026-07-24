import { useEffect, useRef, useState } from 'react'
import type { ColumnMeta, QueryResult } from '@shared/types'
import { useStore } from '../store'
import { SqlEditor } from './SqlEditor'
import { SavedQueriesPanel } from './SavedQueriesPanel'
import { SaveQueryDialog } from './SaveQueryDialog'
import { ConfirmDialog } from './ConfirmDialog'
import { useDbMetadata } from '../hooks/useDbMetadata'
import { useResizable } from '../hooks/useResizable'
import { uid, noWhereGuard } from '../utils'

interface Props {
  connectionId: string
}

const EMPTY_LOGS: never[] = []

export function ScriptConsole({ connectionId }: Props): JSX.Element {
  const logs = useStore((s) => s.scriptLogs[connectionId] ?? EMPTY_LOGS)
  const conn = useStore((s) => s.connections.find((c) => c.id === connectionId))
  const status = useStore((s) => s.statuses[connectionId])
  const showConsole = useStore((s) => s.showConsole)
  const openTab = useStore((s) => s.openTab)
  const connected = status?.state === 'connected'
  const { words, tableRefs } = useDbMetadata(connectionId, connected)

  const [sql, setSql] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [showSaved, setShowSaved] = useState(false)
  const [showSaveAs, setShowSaveAs] = useState(false)
  const [pendingRun, setPendingRun] = useState<string | null>(null)
  const [lastMs, setLastMs] = useState<number | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const historyKey = `${connectionId}:__query__`
  const [height, resizeHandle] = useResizable({ axis: 'y', min: 140, max: 640, initial: 260, invert: true })

  const cancel = async () => {
    await window.api.db.cancelQuery(connectionId)
  }

  const save = async (name: string) => {
    setShowSaveAs(false)
    await window.api.savedQueries.save({ connectionId, name, sql: sql.trim() })
  }

  // Result sets open in their own tab; the console only reports non-result outcomes.
  const openResultTab = (querySql: string, result: QueryResult) => {
    const title = querySql.replace(/\s+/g, ' ').trim().slice(0, 28)
    openTab({ kind: 'result', id: uid(), connectionId, title: title || 'result', sql: querySql, result })
  }

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [logs.length])

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
    if (trimmed.startsWith('\\')) {
      setRunning(true)
      setError(null)
      try {
        openResultTab(trimmed, await runMetaCommand(trimmed))
        setMessage(null)
      } catch (e) {
        setError(String(e))
      } finally {
        setRunning(false)
      }
      return
    }

    setRunning(true)
    setError(null)
    try {
      const res = await window.api.db.query(connectionId, trimmed)
      void window.api.history.add(historyKey, [{ sql: trimmed, ts: Date.now() }])
      setLastMs(res.durationMs ?? null)
      if (res.columns.length > 0) {
        // A result set — show it in a dedicated tab, keep the console compact.
        openResultTab(trimmed, res)
        setMessage(null)
      } else {
        setMessage(`${res.command ?? 'OK'} · ${res.rowCount} row(s) affected`)
      }
    } catch (e) {
      setError(String(e))
      setLastMs(null)
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
    <div className={`console ${logs.length > 0 ? '' : 'compact'}`} style={logs.length > 0 ? { height } : undefined}>
      {logs.length > 0 && <div className="resize-handle-y" onMouseDown={resizeHandle.onMouseDown} />}
      <div className="console-header">
        <span>
          Query · {conn?.name ?? connectionId}
          {status?.scriptRunning && <span className="running-badge">script running</span>}
        </span>
        <button className="btn-icon" onClick={() => showConsole(null)} title="Hide">
          ▾
        </button>
      </div>

      {logs.length > 0 && (
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
        className="mono sql-input console-sql"
        value={sql}
        onChange={setSql}
        onRun={run}
        words={words}
        placeholder="Write SQL command"
      />

      <div className="toolbar">
        <button className="mini primary" onClick={run} disabled={running || !connected}>
          {running ? 'Running…' : '▶ Run (⌘↵)'}
        </button>
        {running && (
          <button className="mini danger" onClick={cancel}>
            Cancel
          </button>
        )}
        {message && <span className="muted">{message}</span>}
        {lastMs != null && <span className="muted">{lastMs} ms</span>}
        <div className="spacer" />
        <span className="muted">results open in a new tab</span>
        <button className="mini" title="Save this query for reuse" onClick={() => setShowSaveAs(true)} disabled={!sql.trim()}>
          ☆ Save
        </button>
        <button className="mini" title="Saved queries" onClick={() => setShowSaved(true)}>
          Saved
        </button>
      </div>

      {error && <div className="error-bar">{error}</div>}

      {showSaved && (
        <SavedQueriesPanel
          connectionId={connectionId}
          title={conn?.name ?? connectionId}
          onClose={() => setShowSaved(false)}
          onSelect={setSql}
        />
      )}
      {showSaveAs && <SaveQueryDialog onCancel={() => setShowSaveAs(false)} onSave={save} />}
      {pendingRun && (
        <ConfirmDialog
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
