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
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Confirm changes</h3>
        <p className="hint">
          {statements.length} statement{statements.length === 1 ? '' : 's'} will run in a single
          transaction. Review before applying.
        </p>
        <pre className="generated-script sql-preview mono">{statements.join('\n')}</pre>
        <div className="modal-actions">
          <div className="spacer" />
          <button className="mini" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button className="mini primary" onClick={onConfirm} disabled={saving}>
            {saving ? 'Applying…' : 'Apply & save'}
          </button>
        </div>
      </div>
    </div>
  )
}
