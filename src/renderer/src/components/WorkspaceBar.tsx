import { useState } from 'react'
import type { Workspace } from '@shared/types'
import { useStore } from '../store'
import { WorkspaceDialog } from './WorkspaceDialog'

/** Active-workspace picker plus create / rename / delete of workspaces. */
export function WorkspaceBar(): JSX.Element {
  const { workspaces, activeWorkspaceId, workspacesLoaded, connections, refreshWorkspaces, selectWorkspace } =
    useStore()
  const [editing, setEditing] = useState<Workspace | null | 'new'>(null)
  const active = workspaces.find((w) => w.id === activeWorkspaceId) ?? null
  // With no workspace at all the dialog opens by itself and can't be dismissed —
  // but only once the saved list has actually loaded.
  const required = workspacesLoaded && workspaces.length === 0
  const dialogFor = required ? 'new' : editing

  const remove = async () => {
    if (!active) return
    const n = connections.length
    const detail = n ? ` and its ${n} connection${n > 1 ? 's' : ''}` : ''
    if (!confirm(`Delete workspace "${active.name}"${detail}?`)) return
    const nextId = await window.api.workspaces.delete(active.id)
    await refreshWorkspaces()
    if (nextId) await selectWorkspace(nextId)
    else await useStore.getState().refreshConnections()
  }

  return (
    <>
      <div className="workspace-bar">
        <span className="conn-dot" style={{ background: active?.color || '#6c7086' }} />
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
          <button className="icon-btn-sm danger" title="Delete workspace" onClick={remove} disabled={!active}>
            ✕
          </button>
        </div>
      </div>
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
