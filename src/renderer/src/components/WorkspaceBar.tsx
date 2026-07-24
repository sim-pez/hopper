import { useState } from 'react'
import type { Workspace } from '@shared/types'
import { useStore } from '../store'
import { WorkspaceDialog } from './WorkspaceDialog'
import { ConfirmDialog } from './ConfirmDialog'

/** Active-workspace picker plus create / rename / delete of workspaces. */
export function WorkspaceBar(): JSX.Element {
  const { workspaces, activeWorkspaceId, workspacesLoaded, connections, refreshWorkspaces, selectWorkspace } =
    useStore()
  const [editing, setEditing] = useState<Workspace | null | 'new'>(null)
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const active = workspaces.find((w) => w.id === activeWorkspaceId) ?? null
  // With no workspace at all the dialog opens by itself and can't be dismissed —
  // but only once the saved list has actually loaded.
  const required = workspacesLoaded && workspaces.length === 0
  const dialogFor = required ? 'new' : editing

  const remove = async () => {
    setConfirmingRemove(false)
    if (!active) return
    const nextId = await window.api.workspaces.delete(active.id)
    await refreshWorkspaces()
    if (nextId) await selectWorkspace(nextId)
    else await useStore.getState().refreshConnections()
  }

  return (
    <>
      <div className="workspace-bar">
        <select
          className="workspace-select"
          value={activeWorkspaceId ?? ''}
          onChange={(e) => selectWorkspace(e.target.value)}
          title="Active workspace"
          disabled={required}
        >
          {required && <option value="">No workspace</option>}
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <div className="icon-group">
          <button className="icon-btn-sm" title="New workspace" onClick={() => setEditing('new')}>
            +
          </button>
          <button
            className="icon-btn-sm"
            title="Rename workspace"
            onClick={() => setEditing(active)}
            disabled={!active}
          >
            ✎
          </button>
          <button
            className="icon-btn-sm danger"
            title="Delete workspace"
            onClick={() => setConfirmingRemove(true)}
            disabled={!active}
          >
            ✕
          </button>
        </div>
      </div>
      {confirmingRemove && active && (
        <ConfirmDialog
          message={`Delete workspace "${active.name}"${
            connections.length ? ` and its ${connections.length} connection${connections.length > 1 ? 's' : ''}` : ''
          }?`}
          confirmLabel="Delete"
          onCancel={() => setConfirmingRemove(false)}
          onConfirm={remove}
        />
      )}
      {dialogFor !== null && (
        <WorkspaceDialog
          workspace={dialogFor === 'new' ? null : dialogFor}
          required={required}
          onClose={() => setEditing(null)}
          onSaved={async (saved) => {
            setEditing(null)
            await refreshWorkspaces()
            await selectWorkspace(saved.id)
          }}
        />
      )}
    </>
  )
}
