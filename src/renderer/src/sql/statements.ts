/**
 * Splitting a script into its statements, so ⌘↵ can run just the one the caret
 * is in instead of the whole editor.
 *
 * Pure and self-contained (like `complete.ts`): it scans for `;` at the top
 * level, skipping over quoted strings, quoted identifiers, line and block
 * comments, and Postgres dollar-quoted bodies — the places a `;` doesn't end a
 * statement. Quotes are escaped by doubling (`''`), per standard SQL; MySQL's
 * non-standard backslash escapes are not recognised, so a `'\''` literal can
 * split in the wrong place.
 */

export interface SqlStatement {
  /** The statement, trimmed. */
  text: string
  /** Offsets of `text` within the original script. */
  start: number
  end: number
}

/** Index just past the string/identifier opened by `quote` at `i`. */
function skipQuoted(sql: string, i: number, quote: string): number {
  i++
  while (i < sql.length) {
    if (sql[i] === quote) {
      // A doubled quote is an escaped one: the string keeps going.
      if (sql[i + 1] !== quote) return i + 1
      i += 2
      continue
    }
    i++
  }
  return sql.length
}

/** Index just past the block comment starting at `i`. Postgres nests them. */
function skipBlockComment(sql: string, i: number): number {
  let depth = 0
  while (i < sql.length) {
    if (sql[i] === '/' && sql[i + 1] === '*') {
      depth++
      i += 2
    } else if (sql[i] === '*' && sql[i + 1] === '/') {
      depth--
      i += 2
      if (depth === 0) return i
    } else {
      i++
    }
  }
  return sql.length
}

/** Index just past the `$tag$ … $tag$` body starting at `i`, or `i` itself when
 *  this `$` isn't opening one (a `$1` placeholder, say). */
function skipDollarQuoted(sql: string, i: number): number {
  const match = /^\$(?:[A-Za-z_]\w*)?\$/.exec(sql.slice(i))
  if (!match) return i
  const tag = match[0]
  const end = sql.indexOf(tag, i + tag.length)
  return end < 0 ? sql.length : end + tag.length
}

/** Every non-empty statement in `sql`, in order. */
export function splitStatements(sql: string): SqlStatement[] {
  const out: SqlStatement[] = []
  let from = 0
  let i = 0

  const take = (to: number): void => {
    const raw = sql.slice(from, to)
    const text = raw.trim()
    if (!text) return
    const lead = raw.length - raw.trimStart().length
    out.push({ text, start: from + lead, end: from + lead + text.length })
  }

  while (i < sql.length) {
    const c = sql[i]
    if (c === "'" || c === '"' || c === '`') {
      i = skipQuoted(sql, i, c)
    } else if (c === '-' && sql[i + 1] === '-') {
      const nl = sql.indexOf('\n', i)
      i = nl < 0 ? sql.length : nl + 1
    } else if (c === '/' && sql[i + 1] === '*') {
      i = skipBlockComment(sql, i)
    } else if (c === '$') {
      const next = skipDollarQuoted(sql, i)
      i = next === i ? i + 1 : next
    } else if (c === ';') {
      take(i)
      i++
      from = i
    } else {
      i++
    }
  }
  take(sql.length)
  return out
}

/**
 * What ⌘↵ should run: an explicit selection wins, otherwise the statement the
 * caret sits in, otherwise (nothing parseable) the whole text.
 */
export function sqlToRun(text: string, start: number, end: number): string {
  if (end > start) return text.slice(start, end).trim()
  return statementAtCaret(text, start)?.text ?? text.trim()
}

/**
 * The statement to run for a caret at `caret`. Inside (or touching) a statement
 * that one wins; sitting in the whitespace between two, the statement just
 * before the caret does, since that is the one the user was writing.
 */
export function statementAtCaret(sql: string, caret: number): SqlStatement | null {
  const statements = splitStatements(sql)
  if (!statements.length) return null
  const inside = statements.find((s) => caret >= s.start && caret <= s.end)
  if (inside) return inside
  let before: SqlStatement | null = null
  for (const s of statements) if (s.end < caret) before = s
  return before ?? statements[0]
}
