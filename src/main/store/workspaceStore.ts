import { randomUUID } from 'crypto'
import type { Workspace, WorkspaceInput } from '@shared/types'
import { JsonStore } from './jsonStore'

interface WorkspacesFile {
  workspaces: Workspace[]
  /** Null when no workspace exists yet — the UI then asks the user to create one. */
  activeWorkspaceId: string | null
}

const store = new JsonStore<WorkspacesFile>('workspaces.json', {
  workspaces: [],
  activeWorkspaceId: null
})

// Runs once per process; later calls just read the (already valid) state.
let initialized: Promise<void> | null = null

function ensureInit(): Promise<void> {
  initialized ??= store
    .update((d) => {
      // Repair a dangling active id; no workspace is ever created implicitly.
      if (!d.workspaces.some((w) => w.id === d.activeWorkspaceId)) {
        d.activeWorkspaceId = d.workspaces[0]?.id ?? null
      }
    })
    .then(() => undefined)
  return initialized
}

/** Returns the active workspace id, or null when none exists yet. */
export async function initWorkspaces(): Promise<string | null> {
  await ensureInit()
  return store.get('activeWorkspaceId')
}

export async function listWorkspaces(): Promise<Workspace[]> {
  await ensureInit()
  return store.get('workspaces')
}

export async function getActiveWorkspaceId(): Promise<string | null> {
  return initWorkspaces()
}

export async function setActiveWorkspaceId(id: string): Promise<string> {
  await store.update((d) => {
    if (!d.workspaces.some((w) => w.id === id)) throw new Error(`Workspace ${id} not found`)
    d.activeWorkspaceId = id
  })
  return id
}

export async function saveWorkspace(input: WorkspaceInput): Promise<Workspace> {
  const name = input.name.trim()
  if (!name) throw new Error('Workspace name is required')
  await ensureInit()
  const now = Date.now()
  let saved: Workspace

  await store.update((d) => {
    if (input.id) {
      const idx = d.workspaces.findIndex((w) => w.id === input.id)
      if (idx === -1) throw new Error(`Workspace ${input.id} not found`)
      saved = { ...d.workspaces[idx], name, updatedAt: now }
      d.workspaces[idx] = saved
    } else {
      saved = { id: randomUUID(), name, createdAt: now, updatedAt: now }
      d.workspaces.push(saved)
      // The very first workspace becomes active straight away.
      if (!d.activeWorkspaceId) d.activeWorkspaceId = saved.id
    }
  })
  return saved!
}

/** Removes the workspace and returns the id active afterwards (null if it was the
 *  last one). The caller deletes the connections that belonged to it. */
export async function deleteWorkspace(id: string): Promise<string | null> {
  const data = await store.update((d) => {
    if (!d.workspaces.some((w) => w.id === id)) throw new Error(`Workspace ${id} not found`)
    d.workspaces = d.workspaces.filter((w) => w.id !== id)
    if (d.activeWorkspaceId === id) d.activeWorkspaceId = d.workspaces[0]?.id ?? null
  })
  return data.activeWorkspaceId
}
