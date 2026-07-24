import * as XLSX from 'xlsx'
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

/** Keep native types (numbers, dates, booleans) so Excel can sort/sum/filter them. */
function toCellValue(v: unknown): unknown {
  if (v === null || v === undefined) return ''
  if (v instanceof Date || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v
  if (typeof v === 'bigint') return v.toString()
  return JSON.stringify(v)
}

/** Build and download a single-sheet .xlsx workbook from grid columns/rows. */
export function downloadXlsx(filename: string, columns: ColumnMeta[], rows: unknown[][]): void {
  const data = [columns.map((c) => c.name), ...rows.map((r) => r.map(toCellValue))]
  const sheet = XLSX.utils.aoa_to_sheet(data)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'Data')
  const buf = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** Build and download a .csv file from grid columns/rows (RFC 4180 quoting). */
export function downloadCsv(filename: string, columns: ColumnMeta[], rows: unknown[][]): void {
  const escape = (v: unknown): string => {
    const s = displayValue(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [
    columns.map((c) => escape(c.name)).join(','),
    ...rows.map((r) => r.map(escape).join(','))
  ]
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
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
