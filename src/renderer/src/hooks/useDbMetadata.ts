import { useEffect, useState } from 'react'
import type { TableRef } from '@shared/types'
import type { SqlVocabulary } from '../sql/complete'

// A compact set of SQL keywords offered by the autocompleter.
const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',
  'CREATE', 'TABLE', 'ALTER', 'DROP', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER',
  'ON', 'GROUP', 'BY', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'DISTINCT', 'AS',
  'AND', 'OR', 'NOT', 'NULL', 'IS', 'IN', 'LIKE', 'BETWEEN', 'COUNT', 'SUM',
  'AVG', 'MIN', 'MAX', 'ASC', 'DESC', 'RETURNING', 'WITH', 'UNION', 'CASE',
  'WHEN', 'THEN', 'ELSE', 'END'
]

const KEYWORD_ONLY: SqlVocabulary = { keywords: SQL_KEYWORDS, schemas: [], tables: [], columns: {} }

/** Database metadata used for autocompletion and `\d` commands. */
export function useDbMetadata(
  connectionId: string,
  connected: boolean
): { vocab: SqlVocabulary; tableRefs: TableRef[] } {
  const [vocab, setVocab] = useState<SqlVocabulary>(KEYWORD_ONLY)

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
        const tables = perSchema.flat()
        setVocab({ keywords: SQL_KEYWORDS, schemas, tables, columns: {} })

        // Pull column names in the background (best effort) for richer suggestions.
        for (const t of tables.slice(0, 200)) {
          const cols = await window.api.db.getColumns(connectionId, t.schema, t.table).catch(() => [])
          if (cancelled) return
          if (cols.length) {
            setVocab((prev) => ({
              ...prev,
              columns: { ...prev.columns, [`${t.schema}.${t.table}`]: cols.map((c) => c.name) }
            }))
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

  return { vocab, tableRefs: vocab.tables }
}
