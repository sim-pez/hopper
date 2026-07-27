import * as XLSX from 'xlsx'
import type { ColumnFilter, ColumnMeta, FilterOp, QueryResult } from '@shared/types'
import { VALUELESS_OPS } from '@shared/types'

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

/** The message a failed `window.api` call should show, with Electron's IPC
 *  wrapper ("Error invoking remote method 'db:query': …") stripped off so the
 *  driver's own wording is what the user reads. */
export function errorText(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  return raw.replace(/^(?:Error: )?Error invoking remote method '[^']*': /, '').replace(/^Error: /, '')
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

/** Returns the offending verb if `sql` is a WHERE-less UPDATE/DELETE that would
 *  affect every row, else null. */
export function noWhereGuard(sql: string): 'UPDATE' | 'DELETE' | null {
  if (!/^\s*(update|delete)\b/i.test(sql) || /\bwhere\b/i.test(sql)) return null
  return /^\s*update/i.test(sql) ? 'UPDATE' : 'DELETE'
}

/** Render a value as a SQL literal for DISPLAY ONLY (history entries). */
export function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number' || typeof v === 'bigint') return String(v)
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  return `'${s.replace(/'/g, "''")}'`
}

/** The filter operators offered in the filter bar, in menu order. `symbol` is
 *  what the chip shows; it doubles as the `<option>` label. */
export const FILTER_OPS: { op: FilterOp; symbol: string; title: string }[] = [
  { op: 'contains', symbol: '~', title: 'contains' },
  { op: 'notContains', symbol: '!~', title: 'does not contain' },
  { op: 'startsWith', symbol: '^', title: 'starts with' },
  { op: 'eq', symbol: '=', title: 'equals' },
  { op: 'ne', symbol: '≠', title: 'not equal to' },
  { op: 'gt', symbol: '>', title: 'greater than' },
  { op: 'gte', symbol: '≥', title: 'greater than or equal to' },
  { op: 'lt', symbol: '<', title: 'less than' },
  { op: 'lte', symbol: '≤', title: 'less than or equal to' },
  { op: 'in', symbol: 'in', title: 'in a comma-separated list' },
  { op: 'isNull', symbol: 'is null', title: 'is NULL' },
  { op: 'notNull', symbol: 'not null', title: 'is not NULL' }
]

export function opSymbol(op: FilterOp): string {
  return FILTER_OPS.find((o) => o.op === op)?.symbol ?? op
}

/** Whether an operator uses the value box at all. */
export function opTakesValue(op: FilterOp): boolean {
  return !VALUELESS_OPS.includes(op)
}

/** Short human rendering of the active filters, for a tab title. */
export function describeFilters(filters: ColumnFilter[]): string {
  return filters
    .map((f) => `${f.column} ${opSymbol(f.op)}${opTakesValue(f.op) ? ` ${f.value}` : ''}`)
    .join(', ')
}

/** A single-column result (a Postgres `QUERY PLAN`) as one text block, or null
 *  when the result is really tabular and belongs in the grid. */
export function planText(result: QueryResult): string | null {
  if (result.columns.length !== 1) return null
  return result.rows.map((r) => displayValue(r[0])).join('\n')
}

/** History bucket for a connection. History is per-database — every statement
 *  run against it (console, query tab, or a grid edit) lands in the same list,
 *  reachable from that connection's console. */
export function historyKey(connectionId: string): string {
  return `${connectionId}:__query__`
}
