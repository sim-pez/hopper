import { Modal } from './Modal'

interface Props {
  message: string
  title?: string
  confirmLabel?: string
  danger?: boolean
  onCancel: () => void
  onConfirm: () => void
}

/** Non-blocking replacement for window.confirm(). */
export function ConfirmDialog({
  message,
  title = 'Are you sure?',
  confirmLabel = 'Confirm',
  danger = true,
  onCancel,
  onConfirm
}: Props): JSX.Element {
  return (
    <Modal
      onClose={onCancel}
      title={title}
      size="sm"
      footer={
        <>
          <div className="spacer" />
          <button className="mini" onClick={onCancel}>
            Cancel
          </button>
          <button className={`mini ${danger ? 'danger' : 'primary'}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <p style={{ margin: 0 }}>{message}</p>
    </Modal>
  )
}
