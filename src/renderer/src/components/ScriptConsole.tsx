import { useEffect, useRef, useState } from 'react'
import type { ColumnMeta, QueryResult, TableRef } from '@shared/types'
import { useStore } from '../store'
import { SqlEditor } from './SqlEditor'
import { HistoryPanel } from './HistoryPanel'
import { uid } from '../utils'

interface Props {
  connectionId: string
}

const EMPTY_LOGS: never[] = []

// A compact set of SQL keywords offered by the autocompleter.
const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',
  'CREATE', 'TABLE', 'ALTER', 'DROP', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER',
  'ON', 'GROUP', 'BY', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'DISTINCT', 'AS',
  'AND', 'OR', 'NOT', 'NULL', 'IS', 'IN', 'LIKE', 'BETWEEN', 'COUNT', 'SUM',
  'AVG', 'MIN', 'MAX', 'ASC', 'DESC', 'RETURNING', 'WITH', 'UNION', 'CASE',
  'WHEN', 'THEN', 'ELSE', 'END'
]

/** Database metadata used for autocompletion and `\d` commands. */
function useDbMetadata(connectionId: string, connected: boolean) {
  const [words, setWords] = useState<string[]>(SQL_KEYWORDS)
  const [tableRefs, setTableRefs] = useState<TableRef[]>([])

  useEffect(() => {
    if (!connected) return
    let cancelled = false
    ;(async () => {
      try {
        const schemas = await window.api.db.listSchemas(connectionId)
        const perSchema = await Promise.all(
          schemas.map((s) => window.api.db.listTables(connectionId, s).catch(() => []))
        )
        if (cancelled) return
        const refs = perSchema.flat()
        setTableRefs(refs)
        const vocab = new Set<string>(SQL_KEYWORDS)
        for (const s of schemas) vocab.add(s)
        for (const t of refs) vocab.add(t.table)
        setWords([...vocab])

        // Pull column names in the background (best effort) for richer suggestions.
        for (const t of refs.slice(0, 200)) {
          const cols = await window.api.db.getColumns(connectionId, t.schema, t.table).catch(() => [])
          if (cancelled) return
          if (cols.length) {
            setWords((prev) => {
              const set = new Set(prev)
              for (const c of cols) set.add(c.name)
              return [...set]
            })
          }
        }
      } catch {
        /* not connected yet or metadata unavailable — keep keyword-only vocab */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [connectionId, connected])

  return { words, tableRefs }
}

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
  const [showHistory, setShowHistory] = useState(false)
  const [lastMs, setLastMs] = useState<number | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const historyKey = `${connectionId}:__query__`

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

  const run = async () => {
    const trimmed = sql.trim()
    if (!trimmed) return

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

    // Guard against a full-table UPDATE/DELETE with no WHERE clause.
    if (/^\s*(update|delete)\b/i.test(trimmed) && !/\bwhere\b/i.test(trimmed)) {
      const verb = /^\s*update/i.test(trimmed) ? 'UPDATE' : 'DELETE'
      if (!confirm(`This ${verb} has no WHERE clause and will affect EVERY row. Run it anyway?`)) return
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

  return (
    <div className="console">
      <div className="console-header">
        <span>
          Query · {conn?.name ?? connectionId}
          {status?.scriptRunning && <span className="running-badge">script running</span>}
        </span>
        <div className="console-header-right">
          {lastMs != null && <span className="muted">{lastMs} ms</span>}
          <button className="btn-icon" onClick={() => showConsole(null)} title="Hide">
            ▾
          </button>
        </div>
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
        {message && <span className="muted">{message}</span>}
        <div className="spacer" />
        <span className="muted">results open in a new tab</span>
        <button className="mini" title="Past queries run on this connection" onClick={() => setShowHistory(true)}>
          History
        </button>
      </div>

      {error && <div className="error-bar">{error}</div>}

      {showHistory && (
        <HistoryPanel
          tableKey={historyKey}
          title={conn?.name ?? connectionId}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  )
}

function listResult(columns: ColumnMeta[], rows: unknown[][]): QueryResult {
  return { columns, rows, rowCount: rows.length, command: 'META', durationMs: 0 }
}
