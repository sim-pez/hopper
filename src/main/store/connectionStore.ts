import { randomUUID } from 'crypto'
import type { ConnectionConfig, ConnectionInput, ConnectionView } from '@shared/types'
import { JsonStore } from './jsonStore'
import { deletePassword, hasPassword, setPassword } from './secrets'
import { getActiveWorkspaceId } from './workspaceStore'

interface ConnectionsFile {
  connections: ConnectionConfig[]
}

const store = new JsonStore<ConnectionsFile>('connections.json', { connections: [] })

async function toView(cfg: ConnectionConfig): Promise<ConnectionView> {
  return { ...cfg, hasPassword: await hasPassword(cfg.id) }
}

/** How many connections predate workspaces and still need a `workspaceId`. */
export async function countConnectionsWithoutWorkspace(): Promise<number> {
  const list = await store.get('connections')
  return list.filter((c) => !c.workspaceId).length
}

/** One-time migration: connections saved before workspaces existed land in the
 *  default workspace. */
export async function assignMissingWorkspaces(workspaceId: string): Promise<void> {
  await store.update((d) => {
    for (const c of d.connections) {
      if (!c.workspaceId) c.workspaceId = workspaceId
    }
  })
}

export async function listConnections(workspaceId?: string): Promise<ConnectionView[]> {
  const list = await store.get('connections')
  const scoped = workspaceId ? list.filter((c) => c.workspaceId === workspaceId) : list
  return Promise.all(scoped.map(toView))
}

export async function getConnection(id: string): Promise<ConnectionConfig | undefined> {
  return (await store.get('connections')).find((c) => c.id === id)
}

export async function saveConnection(input: ConnectionInput): Promise<ConnectionView> {
  const now = Date.now()
  let saved: ConnectionConfig
  // `workspaceId` is dropped from the patch so an update can never clear it.
  const { password, workspaceId, ...meta } = input
  const targetWorkspace = workspaceId ?? (await getActiveWorkspaceId())
  if (!input.id && !targetWorkspace) throw new Error('Create a workspace before adding connections')

  await store.update((d) => {
    if (input.id) {
      const idx = d.connections.findIndex((c) => c.id === input.id)
      if (idx === -1) throw new Error(`Connection ${input.id} not found`)
      saved = { ...d.connections[idx], ...meta, id: input.id, updatedAt: now }
      d.connections[idx] = saved
    } else {
      saved = {
        ...(meta as Omit<ConnectionConfig, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt'>),
        id: randomUUID(),
        workspaceId: targetWorkspace!,
        createdAt: now,
        updatedAt: now
      }
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

/** Ids of the connections in a workspace, for tearing them down before deletion. */
export async function listConnectionIdsInWorkspace(workspaceId: string): Promise<string[]> {
  const list = await store.get('connections')
  return list.filter((c) => c.workspaceId === workspaceId).map((c) => c.id)
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
