import { randomUUID } from 'crypto'
import type { SavedQuery, SavedQueryInput } from '@shared/types'
import { JsonStore } from './jsonStore'

interface SavedQueriesFile {
  queries: SavedQuery[]
}

const store = new JsonStore<SavedQueriesFile>('saved-queries.json', { queries: [] })

/** Pinned queries first, newest-edited within each group first. */
function sortQueries(queries: SavedQuery[]): SavedQuery[] {
  return [...queries].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
}

export async function listSavedQueries(connectionId: string): Promise<SavedQuery[]> {
  const all = await store.get('queries')
  return sortQueries(all.filter((q) => q.connectionId === connectionId))
}

export async function saveSavedQuery(input: SavedQueryInput): Promise<SavedQuery> {
  const now = Date.now()
  let saved!: SavedQuery
  await store.update((d) => {
    if (input.id) {
      const idx = d.queries.findIndex((q) => q.id === input.id)
      if (idx === -1) throw new Error('Saved query not found')
      saved = { ...d.queries[idx], name: input.name, sql: input.sql, updatedAt: now }
      d.queries[idx] = saved
    } else {
      saved = {
        id: randomUUID(),
        connectionId: input.connectionId,
        name: input.name,
        sql: input.sql,
        pinned: false,
        createdAt: now,
        updatedAt: now
      }
      d.queries.push(saved)
    }
  })
  return saved
}

export async function deleteSavedQuery(id: string): Promise<void> {
  await store.update((d) => {
    d.queries = d.queries.filter((q) => q.id !== id)
  })
}

export async function toggleSavedQueryPin(id: string): Promise<SavedQuery> {
  let saved!: SavedQuery
  await store.update((d) => {
    const q = d.queries.find((q) => q.id === id)
    if (!q) throw new Error('Saved query not found')
    q.pinned = !q.pinned
    q.updatedAt = Date.now()
    saved = q
  })
  return saved
}
