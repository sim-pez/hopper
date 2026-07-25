import { useState } from 'react'
import type { Workspace } from '@shared/types'
import { Modal } from './Modal'
import { Banner } from './Banner'

interface Props {
  /** Workspace being renamed, or null when creating one. */
  workspace: Workspace | null
  /** Shown when the app has no workspace yet; the dialog then can't be dismissed. */
  required?: boolean
  onClose: () => void
  onSaved: (saved: Workspace) => void
}

/** Create / rename a workspace. Electron has no `window.prompt`, so this is it. */
export function WorkspaceDialog({ workspace, required, onClose, onSaved }: Props): JSX.Element {
  const [name, setName] = useState(workspace?.name ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!name.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      onSaved(await window.api.workspaces.save({ id: workspace?.id, name: name.trim() }))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      onClose={onClose}
      title={workspace ? 'Rename workspace' : 'New workspace'}
      size="sm"
      dismissible={!required}
      footer={
        <>
          <div className="spacer" />
          {!required && (
            <button className="mini" onClick={onClose} disabled={saving}>
              Cancel
            </button>
          )}
          <button className="mini primary" onClick={submit} disabled={saving || !name.trim()}>
            {workspace ? 'Rename' : 'Create'}
          </button>
        </>
      }
    >
      {required && !workspace && (
        <p className="hint">Connections live in a workspace. Create one to get started.</p>
      )}
      <div className="form-grid">
        <label className="span2">
          Name
          <input
            autoFocus
            value={name}
            placeholder="Production"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </label>
      </div>
      {error && <Banner message={error} />}
    </Modal>
  )
}
