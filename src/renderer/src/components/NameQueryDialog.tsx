import { useState } from 'react'
import { Modal } from './Modal'

interface Props {
  /** Current name, when renaming an already-named query. */
  initial?: string
  onCancel: () => void
  onSave: (name: string) => void
}

/** Non-blocking replacement for window.prompt('Name this query:'). */
export function NameQueryDialog({ initial = '', onCancel, onSave }: Props): JSX.Element {
  const [name, setName] = useState(initial)

  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    onSave(trimmed)
  }

  return (
    <Modal
      onClose={onCancel}
      title="Name query"
      size="sm"
      footer={
        <>
          <div className="spacer" />
          <button className="mini" onClick={onCancel}>
            Cancel
          </button>
          <button className="mini primary" onClick={submit} disabled={!name.trim()}>
            Save
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label className="span2">
          Name
          <input
            autoFocus
            value={name}
            placeholder="My query"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </label>
      </div>
    </Modal>
  )
}
