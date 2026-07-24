import { Modal } from './Modal'

interface Props {
  message: string
  confirmLabel?: string
  danger?: boolean
  onCancel: () => void
  onConfirm: () => void
}

/** Non-blocking replacement for window.confirm(). */
export function ConfirmDialog({ message, confirmLabel = 'Confirm', danger = true, onCancel, onConfirm }: Props): JSX.Element {
  return (
    <Modal onClose={onCancel}>
      <p>{message}</p>
      <div className="modal-actions">
        <div className="spacer" />
        <button className="mini" onClick={onCancel}>
          Cancel
        </button>
        <button className={`mini ${danger ? 'danger' : 'primary'}`} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
