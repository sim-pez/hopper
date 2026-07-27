import type { ForeignKey, TableStructure } from '@shared/types'
import { showToast } from '../toast'
import { Banner } from './Banner'
import { Skeleton } from './Skeleton'
import { ArrowUpRight, Copy, Key, X } from '../icons'

interface Props {
  /** Null while loading. Fetched by the parent, which also needs the foreign
   *  keys to draw the grid's follow buttons. */
  structure: TableStructure | null
  error: string | null
  onClose: () => void
  /** Open another table — used by the foreign-key rows. */
  onOpenTable: (schema: string, table: string) => void
}

/** `orders.customer_id` -> `customers.id`, collapsed to one line. */
function fkSummary(fk: ForeignKey, side: 'out' | 'in'): { from: string; to: string } {
  const owner = `${fk.table}.${fk.columns.join(', ')}`
  const target = `${fk.refTable}.${fk.refColumns.join(', ')}`
  return side === 'out' ? { from: fk.columns.join(', '), to: target } : { from: owner, to: '' }
}

/** Columns, indexes and foreign keys of the open table, plus its DDL. Lives in
 *  the right rail so it can sit alongside the data rather than replacing it. */
export function StructurePanel({ structure, error, onClose, onOpenTable }: Props): JSX.Element {
  const copyDdl = () => {
    if (!structure?.ddl) return
    void navigator.clipboard
      .writeText(structure.ddl)
      .then(() => showToast('CREATE TABLE copied'))
      .catch(() => showToast('Could not write to the clipboard', 'error'))
  }

  return (
    <aside className="rail">
      <div className="rail-header">
        <span className="rail-title">Structure</span>
        {structure?.ddl && (
          <button className="icon-btn" onClick={copyDdl} title="Copy CREATE TABLE" aria-label="Copy CREATE TABLE">
            <Copy size={13} />
          </button>
        )}
        <button className="icon-btn" onClick={onClose} title="Close" aria-label="Close structure">
          <X size={14} />
        </button>
      </div>

      <div className="rail-body">
        {error && <Banner message={error} />}
        {!structure && !error && <Skeleton rows={6} />}

        {structure && (
          <>
            <section className="rail-section">
              <h3>Columns</h3>
              <ul className="struct-list">
                {structure.columns.map((c) => (
                  <li key={c.name}>
                    <span className="struct-name">
                      {c.isPrimaryKey && <Key size={11} className="struct-pk" />}
                      {c.name}
                    </span>
                    <span className="struct-meta mono">
                      {c.dataType}
                      {!c.nullable && ' · not null'}
                      {c.defaultValue != null && ` · = ${c.defaultValue}`}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            {structure.indexes.length > 0 && (
              <section className="rail-section">
                <h3>Indexes</h3>
                <ul className="struct-list">
                  {structure.indexes.map((i) => (
                    <li key={i.name}>
                      <span className="struct-name">{i.name}</span>
                      <span className="struct-meta mono">
                        {i.columns.join(', ')}
                        {i.primary ? ' · primary' : i.unique ? ' · unique' : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {structure.foreignKeys.length > 0 && (
              <section className="rail-section">
                <h3>References</h3>
                <ul className="struct-list">
                  {structure.foreignKeys.map((fk) => {
                    const { from, to } = fkSummary(fk, 'out')
                    return (
                      <li key={fk.constraint}>
                        <button
                          className="struct-link"
                          onClick={() => onOpenTable(fk.refSchema, fk.refTable)}
                          title={`Open ${fk.refSchema}.${fk.refTable}`}
                        >
                          <span className="struct-name">{from}</span>
                          <span className="struct-meta mono">{to}</span>
                          <ArrowUpRight size={11} />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )}

            {structure.referencedBy.length > 0 && (
              <section className="rail-section">
                <h3>Referenced by</h3>
                <ul className="struct-list">
                  {structure.referencedBy.map((fk) => (
                    <li key={`${fk.schema}.${fk.table}.${fk.constraint}`}>
                      <button
                        className="struct-link"
                        onClick={() => onOpenTable(fk.schema, fk.table)}
                        title={`Open ${fk.schema}.${fk.table}`}
                      >
                        <span className="struct-name">{fkSummary(fk, 'in').from}</span>
                        <ArrowUpRight size={11} />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </aside>
  )
}
