import { randomUUID } from 'crypto'
import type { ConnectionConfig, ConnectionInput, ConnectionView } from '@shared/types'
import { JsonStore } from './jsonStore'
import { deletePassword, hasPassword, setPassword } from './secrets'

interface ConnectionsFile {
  connections: ConnectionConfig[]
}

const store = new JsonStore<ConnectionsFile>('connections.json', { connections: [] })

async function toView(cfg: ConnectionConfig): Promise<ConnectionView> {
  return { ...cfg, hasPassword: await hasPassword(cfg.id) }
}

export async function listConnections(): Promise<ConnectionView[]> {
  const list = await store.get('connections')
  return Promise.all(list.map(toView))
}

export async function getConnection(id: string): Promise<ConnectionConfig | undefined> {
  return (await store.get('connections')).find((c) => c.id === id)
}

export async function saveConnection(input: ConnectionInput): Promise<ConnectionView> {
  const now = Date.now()
  let saved: ConnectionConfig
  const { password, ...meta } = input

  await store.update((d) => {
    if (input.id) {
      const idx = d.connections.findIndex((c) => c.id === input.id)
      if (idx === -1) throw new Error(`Connection ${input.id} not found`)
      saved = { ...d.connections[idx], ...meta, id: input.id, updatedAt: now }
      d.connections[idx] = saved
    } else {
      saved = { ...(meta as Omit<ConnectionConfig, 'id' | 'createdAt' | 'updatedAt'>), id: randomUUID(), createdAt: now, updatedAt: now }
      d.connections.push(saved)
    }
  })

  if (password !== undefined && password !== '') {
    await setPassword(saved!.id, password)
  }
  return toView(saved!)
}

export async function deleteConnection(id: string): Promise<void> {
  await store.update((d) => {
    d.connections = d.connections.filter((c) => c.id !== id)
  })
  await deletePassword(id)
}

export async function duplicateConnection(id: string): Promise<ConnectionView> {
  const src = await getConnection(id)
  if (!src) throw new Error(`Connection ${id} not found`)
  const now = Date.now()
  const copy: ConnectionConfig = {
    ...src,
    id: randomUUID(),
    name: `${src.name} (copy)`,
    createdAt: now,
    updatedAt: now
  }
  await store.update((d) => {
    d.connections.push(copy)
  })
  return toView(copy)
}
