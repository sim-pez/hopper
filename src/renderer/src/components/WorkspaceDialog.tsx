import { useState } from 'react'
import type { Workspace } from '@shared/types'
import { COLORS } from '../colors'

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
  const [color, setColor] = useState(workspace?.color ?? COLORS[5])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dismiss = () => {
    if (!required) onClose()
  }

  const submit = async () => {
    if (!name.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      onSaved(await window.api.workspaces.save({ id: workspace?.id, name: name.trim(), color }))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={dismiss}>
      <div className="modal workspace-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{workspace ? 'Rename workspace' : 'New workspace'}</h3>
        {required && !workspace && (
          <p className="hint">Connections live in a workspace. Create one to get started.</p>
        )}
        <label>
          Name
          <input
            autoFocus
            value={name}
            placeholder="Production"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
              if (e.key === 'Escape') dismiss()
            }}
          />
        </label>
        <label>
          Color
          <div className="swatches">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`swatch ${color === c ? 'sel' : ''}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </label>
        {error && <div className="conn-error">{error}</div>}
        <div className="modal-actions">
          <div className="spacer" />
          {!required && (
            <button className="mini" onClick={onClose} disabled={saving}>
              Cancel
            </button>
          )}
          <button className="mini primary" onClick={submit} disabled={saving || !name.trim()}>
            {workspace ? 'Rename' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
