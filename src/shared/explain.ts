import type { DriverKind } from './types'

/**
 * Wrap a statement in the engine's `EXPLAIN`.
 *
 * `ANALYZE` really executes the statement, so it is only used for a plain
 * `SELECT` — never for a `WITH` (whose CTEs can write), an `UPDATE`/`DELETE`, or
 * DDL, which are explained without running them. A `SELECT` calling a volatile
 * function can still have side effects; that is the same trade every SQL client
 * makes.
 */
export function buildExplain(driver: DriverKind, sql: string): string {
  const statement = sql.trim().replace(/;\s*$/, '')
  if (driver === 'postgres' && /^select\b/i.test(statement)) {
    return `EXPLAIN (ANALYZE, BUFFERS) ${statement}`
  }
  return `EXPLAIN ${statement}`
}

/** True when `sql` is already an EXPLAIN, so the button shouldn't double-wrap it. */
export function isExplain(sql: string): boolean {
  return /^\s*explain\b/i.test(sql)
}
