import { Modal } from './Modal'

interface Props {
  /** SQL statements that will be executed, for review. */
  statements: string[]
  saving: boolean
  onCancel: () => void
  onConfirm: () => void
}

/** Shows the exact SQL a staged edit/delete batch will run and asks to confirm. */
export function ConfirmChangesDialog({ statements, saving, onCancel, onConfirm }: Props): JSX.Element {
  return (
    <Modal
      onClose={onCancel}
      title="Confirm changes"
      footer={
        <>
          <span className="muted">
            {statements.length} statement{statements.length === 1 ? '' : 's'} · one transaction
          </span>
          <div className="spacer" />
          <button className="mini" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button className="mini primary" onClick={onConfirm} disabled={saving}>
            {saving ? 'Applying…' : 'Apply & save'}
          </button>
        </>
      }
    >
      <p className="hint">
        These statements run in a single transaction — either all of them apply or none do. Review
        before applying.
      </p>
      <pre className="generated-script sql-preview mono">{statements.join('\n')}</pre>
    </Modal>
  )
}
