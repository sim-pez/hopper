import { useState } from 'react'
import { Modal } from './Modal'

interface Props {
  onCancel: () => void
  onSave: (name: string) => void
}

/** Non-blocking replacement for window.prompt('Name this query:'). */
export function SaveQueryDialog({ onCancel, onSave }: Props): JSX.Element {
  const [name, setName] = useState('')

  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    onSave(trimmed)
  }

  return (
    <Modal onClose={onCancel}>
      <h3>Save query</h3>
      <label>
        Name
        <input
          autoFocus
          value={name}
          placeholder="My query"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </label>
      <div className="modal-actions">
        <div className="spacer" />
        <button className="mini" onClick={onCancel}>
          Cancel
        </button>
        <button className="mini primary" onClick={submit} disabled={!name.trim()}>
          Save
        </button>
      </div>
    </Modal>
  )
}
