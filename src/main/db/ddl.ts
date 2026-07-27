import type { ColumnInfo, ForeignKey } from '@shared/types'

/**
 * Synthesize a readable `CREATE TABLE` for engines that can't produce one
 * themselves (Postgres — MySQL has `SHOW CREATE TABLE`). It is for reading and
 * copying, not for round-tripping a schema: check constraints, triggers,
 * partitioning, storage parameters and non-PK indexes are not included.
 */
export function buildCreateTable(
  qualifiedName: string,
  columns: ColumnInfo[],
  primaryKeys: string[],
  foreignKeys: ForeignKey[],
  quoteIdent: (id: string) => string
): string {
  const lines = columns.map((c) => {
    let line = `  ${quoteIdent(c.name)} ${c.dataType ?? 'unknown'}`
    if (!c.nullable) line += ' NOT NULL'
    if (c.defaultValue != null) line += ` DEFAULT ${c.defaultValue}`
    return line
  })

  if (primaryKeys.length) {
    lines.push(`  PRIMARY KEY (${primaryKeys.map(quoteIdent).join(', ')})`)
  }
  for (const fk of foreignKeys) {
    lines.push(
      `  CONSTRAINT ${quoteIdent(fk.constraint)} FOREIGN KEY (${fk.columns.map(quoteIdent).join(', ')}) ` +
        `REFERENCES ${quoteIdent(fk.refSchema)}.${quoteIdent(fk.refTable)} ` +
        `(${fk.refColumns.map(quoteIdent).join(', ')})`
    )
  }

  return `CREATE TABLE ${qualifiedName} (\n${lines.join(',\n')}\n);`
}
