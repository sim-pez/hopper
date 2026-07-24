import type { QueryHistoryEntry } from '@shared/types'
import { JsonStore } from './jsonStore'

interface HistoryFile {
  /** key = `${connectionId}:${schema}:${table}` -> entries, newest first. */
  tables: Record<string, QueryHistoryEntry[]>
}

const CAP = 100
const store = new JsonStore<HistoryFile>('query-history.json', { tables: {} })

export async function listHistory(key: string): Promise<QueryHistoryEntry[]> {
  return (await store.get('tables'))[key] ?? []
}

export async function addHistory(key: string, entries: QueryHistoryEntry[]): Promise<QueryHistoryEntry[]> {
  let result: QueryHistoryEntry[] = []
  await store.update((d) => {
    const prev = d.tables[key] ?? []
    result = [...entries, ...prev].slice(0, CAP) // newest first, keep last 100
    d.tables[key] = result
  })
  return result
}

export async function clearHistory(key: string): Promise<void> {
  await store.update((d) => {
    delete d.tables[key]
  })
}
