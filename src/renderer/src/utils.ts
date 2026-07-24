import type { ColumnMeta } from '@shared/types'

/** Render a DB value for display in a grid cell. */
export function displayValue(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** Whether a value is SQL NULL for badge rendering. */
export function isNull(v: unknown): boolean {
  return v === null || v === undefined
}

/**
 * Parse a text edit back into a value to send to the DB.
 * An empty string is treated as SQL NULL; the literal "NULL" too.
 */
export function parseEdit(text: string): unknown {
  if (text === '' || text.toUpperCase() === 'NULL') return null
  return text
}

export function toCsv(columns: ColumnMeta[], rows: unknown[][]): string {
  const esc = (v: unknown): string => {
    const s = displayValue(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const header = columns.map((c) => esc(c.name)).join(',')
  const body = rows.map((r) => r.map(esc).join(',')).join('\n')
  return `${header}\n${body}`
}

export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

/** Render a value as a SQL literal for DISPLAY ONLY (history entries). */
export function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number' || typeof v === 'bigint') return String(v)
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  return `'${s.replace(/'/g, "''")}'`
}
