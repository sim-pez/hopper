import { randomUUID } from 'crypto'
import type { QueryHistoryEntry, QueryHistoryInput } from '@shared/types'
import { JsonStore } from './jsonStore'

interface HistoryFile {
  /** key = `${connectionId}:${schema}:${table}` or `${connectionId}:__query__`. */
  tables: Record<string, QueryHistoryEntry[]>
}

const CAP = 100 // unpinned entries kept per key
const store = new JsonStore<HistoryFile>('query-history.json', { tables: {} })

/** Pinned first, newest first within each group. */
function sortEntries(entries: QueryHistoryEntry[]): QueryHistoryEntry[] {
  return [...entries].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.ts - a.ts)
}

/** Keeps every pinned entry plus the `CAP` most recent unpinned ones. Expects
 *  the sorted order, so the unpinned tail is the oldest. */
function capped(sorted: QueryHistoryEntry[]): QueryHistoryEntry[] {
  let unpinned = 0
  return sorted.filter((e) => e.pinned || ++unpinned <= CAP)
}

/** History used to be bucketed per table (`${connectionId}:${schema}:${table}`)
 *  and is now per connection (`${connectionId}:__query__`). Folds any leftover
 *  table buckets into their connection's list so nothing written by an older
 *  version becomes unreachable. Runs once at startup. */
export async function migrateHistoryKeys(): Promise<void> {
  await store.update((d) => {
    for (const key of Object.keys(d.tables)) {
      const connectionId = key.slice(0, key.indexOf(':'))
      const target = `${connectionId}:__query__`
      if (key === target) continue
      const merged = [...(d.tables[target] ?? []), ...d.tables[key]]
      for (const e of merged) if (!e.id) e.id = randomUUID()
      d.tables[target] = capped(sortEntries(merged))
      delete d.tables[key]
    }
  })
}

export async function listHistory(key: string): Promise<QueryHistoryEntry[]> {
  const entries = (await store.get('tables'))[key] ?? []
  // Entries written before pinning existed carry no id — backfill them once.
  if (entries.some((e) => !e.id)) {
    await store.update((d) => {
      for (const e of d.tables[key] ?? []) if (!e.id) e.id = randomUUID()
    })
  }
  return sortEntries(entries)
}

export async function addHistory(key: string, inputs: QueryHistoryInput[]): Promise<QueryHistoryEntry[]> {
  let result: QueryHistoryEntry[] = []
  await store.update((d) => {
    const entries = d.tables[key] ?? []
    for (const input of inputs) {
      // Re-running a statement moves its entry up rather than duplicating it,
      // so a pinned query keeps its pin and name when run again.
      const existing = entries.find((e) => e.sql === input.sql)
      if (existing) existing.ts = input.ts
      else entries.push({ id: randomUUID(), sql: input.sql, ts: input.ts })
    }
    result = capped(sortEntries(entries))
    d.tables[key] = result
  })
  return result
}

export async function clearHistory(key: string): Promise<void> {
  await store.update((d) => {
    const pinned = (d.tables[key] ?? []).filter((e) => e.pinned)
    if (pinned.length) d.tables[key] = pinned
    else delete d.tables[key]
  })
}

export async function toggleHistoryPin(key: string, id: string): Promise<QueryHistoryEntry[]> {
  return mutateEntry(key, id, (entry) => {
    entry.pinned = !entry.pinned
    if (!entry.pinned) delete entry.name
  })
}

export async function renameHistoryEntry(key: string, id: string, name: string): Promise<QueryHistoryEntry[]> {
  return mutateEntry(key, id, (entry) => {
    const trimmed = name.trim()
    if (trimmed) entry.name = trimmed
    else delete entry.name
  })
}

async function mutateEntry(
  key: string,
  id: string,
  mutator: (entry: QueryHistoryEntry) => void
): Promise<QueryHistoryEntry[]> {
  let result: QueryHistoryEntry[] = []
  await store.update((d) => {
    const entries = d.tables[key] ?? []
    const entry = entries.find((e) => e.id === id)
    if (!entry) throw new Error('History entry not found')
    mutator(entry)
    result = capped(sortEntries(entries))
    d.tables[key] = result
  })
  return result
}
