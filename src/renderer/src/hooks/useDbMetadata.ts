import { useEffect, useState } from 'react'
import type { TableRef } from '@shared/types'

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
export function useDbMetadata(connectionId: string, connected: boolean): { words: string[]; tableRefs: TableRef[] } {
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
