import { useEffect, useState } from 'react'
import type { TableRef } from '@shared/types'
import { useStore } from '../store'
import { uid } from '../utils'

interface Props {
  connectionId: string
  connectionName: string
}

export function SchemaTree({ connectionId, connectionName }: Props): JSX.Element {
  const openTab = useStore((s) => s.openTab)
  const [schemas, setSchemas] = useState<string[]>([])
  const [openSchema, setOpenSchema] = useState<string | null>(null)
  const [tables, setTables] = useState<Record<string, TableRef[]>>({})
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    window.api.db
      .listSchemas(connectionId)
      .then((s) => {
        setSchemas(s)
        if (s.length === 1) toggleSchema(s[0])
      })
      .catch((e) => setError(String(e)))
  }, [connectionId])

  const toggleSchema = async (schema: string) => {
    if (openSchema === schema) {
      setOpenSchema(null)
      return
    }
    setOpenSchema(schema)
    if (!tables[schema]) {
      try {
        const t = await window.api.db.listTables(connectionId, schema)
        setTables((prev) => ({ ...prev, [schema]: t }))
      } catch (e) {
        setError(String(e))
      }
    }
  }

  const open = (t: TableRef) =>
    openTab({
      kind: 'table',
      id: uid(),
      connectionId,
      schema: t.schema,
      table: t.table,
      title: `${t.table} · ${connectionName}`
    })

  return (
    <div className="tree">
      {error && <div className="conn-error">{error}</div>}
      {schemas.map((schema) => {
        const list = (tables[schema] ?? []).filter((t) =>
          filter ? t.table.toLowerCase().includes(filter.toLowerCase()) : true
        )
        return (
          <div key={schema} className="tree-schema">
            <button className="tree-node" onClick={() => toggleSchema(schema)}>
              <span className="tri">{openSchema === schema ? '▾' : '▸'}</span>
              📁 {schema}
            </button>
            {openSchema === schema && (
              <div className="tree-tables">
                {(tables[schema]?.length ?? 0) > 8 && (
                  <input
                    className="tree-filter"
                    placeholder="filter tables…"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  />
                )}
                {list.map((t) => (
                  <button key={t.table} className="tree-leaf" onDoubleClick={() => open(t)} onClick={() => open(t)}>
                    {t.type === 'view' ? '👁' : '▤'} {t.table}
                  </button>
                ))}
                {tables[schema] && list.length === 0 && <div className="hint">no tables</div>}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
