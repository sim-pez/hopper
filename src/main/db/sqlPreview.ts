// Render a JS value as a SQL literal for DISPLAY ONLY (confirmation previews).
// Never use this to build SQL that is executed — execution always goes through
// bound parameters. This exists so the user can read the query before saving.
export function previewLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number' || typeof v === 'bigint') return String(v)
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (v instanceof Date) return `'${v.toISOString()}'`
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  return `'${s.replace(/'/g, "''")}'`
}
