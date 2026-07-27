import type { TableRef } from '@shared/types'

/** Everything the completer knows about the connected database. */
export interface SqlVocabulary {
  keywords: string[]
  schemas: string[]
  tables: TableRef[]
  /** Column names keyed by `schema.table`. Filled in progressively. */
  columns: Record<string, string[]>
}

export type SuggestionKind = 'keyword' | 'schema' | 'table' | 'column'

export interface Suggestion {
  text: string
  kind: SuggestionKind
  /** Where it comes from — the schema for a table, the table for a column. */
  detail?: string
}

/** A completion request resolved against the text: what to replace and with what. */
export interface Completion {
  /** Offset the replacement starts at (the partial word, qualifier excluded). */
  start: number
  /** The partial word already typed, as typed. */
  word: string
  items: Suggestion[]
}

export const EMPTY_VOCABULARY: SqlVocabulary = { keywords: [], schemas: [], tables: [], columns: {} }

const MAX_ITEMS = 9

const IDENT = '[A-Za-z_][A-Za-z0-9_$]*'

/** Keywords that can legally open a statement — all we offer on an empty one. */
const STATEMENT_STARTERS = [
  'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'WITH', 'CREATE', 'ALTER', 'DROP',
  'TRUNCATE', 'EXPLAIN', 'ANALYZE', 'SHOW', 'GRANT', 'BEGIN', 'COMMIT', 'ROLLBACK'
]

/** After these, a relation is expected. */
const TABLE_KEYWORDS = new Set([
  'FROM', 'JOIN', 'INTO', 'UPDATE', 'TABLE', 'TRUNCATE', 'DESCRIBE', 'DESC'
])

/** After these, a column (or an expression over columns) is expected. */
const COLUMN_KEYWORDS = new Set([
  'SELECT', 'WHERE', 'AND', 'OR', 'ON', 'BY', 'SET', 'HAVING', 'USING',
  'NOT', 'IN', 'LIKE', 'BETWEEN', 'DISTINCT', 'RETURNING', 'CASE', 'WHEN', 'THEN'
])

type Context = 'start' | 'table' | 'column' | 'any'

/** Tables in scope for the statement being edited, plus their aliases. */
interface Scope {
  /** `schema.table` keys of the relations named in FROM/JOIN/UPDATE/INTO. */
  keys: string[]
  /** alias (lowercased) -> `schema.table` key. */
  aliases: Record<string, string>
}

/**
 * Resolve the completion at `caret`, or `null` when nothing should be offered.
 * `explicit` (a manual ⌃Space) relaxes the "needs at least one typed character"
 * rule, so the popup never appears on its own after a paste or a click.
 */
export function completeAt(
  text: string,
  caret: number,
  vocab: SqlVocabulary,
  explicit = false
): Completion | null {
  const statementStart = statementStartOffset(text, caret)
  const before = text.slice(statementStart, caret)

  if (inStringOrComment(before)) return null
  // `\d`-style meta commands are not SQL — nothing here to complete against.
  if (/\\[A-Za-z0-9_$]*$/.test(before)) return null

  const wordMatch = before.match(new RegExp(`[A-Za-z0-9_$]*$`))
  const word = wordMatch ? wordMatch[0] : ''
  const start = caret - word.length
  // Text before the partial word, used for the qualifier and the clause context.
  const lead = before.slice(0, before.length - word.length)
  const qualifier = lead.match(new RegExp(`(${IDENT}|"[^"]+"|\`[^\`]+\`)\\s*\\.\\s*$`))
  const qual = qualifier ? unquote(qualifier[1]) : null

  // Never pop open unprompted with nothing typed — except right after a `.`,
  // where the qualifier alone says exactly what the user is looking for.
  if (!word && !qual && !explicit) return null

  const scope = collectScope(text.slice(statementStart), vocab)
  const candidates = qual
    ? qualifiedCandidates(qual, scope, vocab)
    : contextCandidates(clauseContext(lead), scope, vocab)

  const items = rank(candidates, word)
  return items.length ? { start, word, items } : null
}

/** Statements are independent: only look back to the last `;` (or `\` command). */
function statementStartOffset(text: string, caret: number): number {
  const before = text.slice(0, caret)
  const semi = before.lastIndexOf(';')
  const nl = before.lastIndexOf('\n\\')
  return Math.max(semi + 1, nl + 1, 0)
}

/** True when the caret sits inside a quoted literal or a trailing comment. */
function inStringOrComment(before: string): boolean {
  let quote: string | null = null
  for (let i = 0; i < before.length; i++) {
    const c = before[i]
    if (quote) {
      if (c === quote) quote = null
      else if (c === '\\') i++
      continue
    }
    if (c === "'" || c === '"' || c === '`') quote = c
    else if (c === '-' && before[i + 1] === '-') {
      const nl = before.indexOf('\n', i)
      if (nl === -1) return true
      i = nl
    } else if (c === '/' && before[i + 1] === '*') {
      const end = before.indexOf('*/', i + 2)
      if (end === -1) return true
      i = end + 1
    }
  }
  // A single quote is quoted text (`"` included: an unfinished quoted identifier
  // is still better left alone than completed against).
  return quote !== null
}

function unquote(s: string): string {
  return s.replace(/^["`]|["`]$/g, '')
}

function clauseContext(lead: string): Context {
  const trimmed = lead.trim()
  if (!trimmed) return 'start'
  const words = trimmed.toUpperCase().match(new RegExp(`[A-Z_][A-Z0-9_$]*`, 'g')) ?? []
  // Walk back to the nearest keyword that tells us what is expected here.
  for (let i = words.length - 1; i >= 0; i--) {
    const w = words[i]
    if (TABLE_KEYWORDS.has(w)) {
      // `FROM t` — past the relation name, so we're on an alias or the next clause.
      return i === words.length - 1 ? 'table' : 'any'
    }
    if (COLUMN_KEYWORDS.has(w)) return 'column'
  }
  return 'any'
}

/** Parse the relations named in the statement so columns can be scoped to them. */
function collectScope(statement: string, vocab: SqlVocabulary): Scope {
  const keys: string[] = []
  const aliases: Record<string, string> = {}
  const re = new RegExp(
    `\\b(?:FROM|JOIN|INTO|UPDATE)\\s+((?:${IDENT}|"[^"]+"|\`[^\`]+\`)(?:\\s*\\.\\s*(?:${IDENT}|"[^"]+"|\`[^\`]+\`))?)` +
      `(?:\\s+(?:AS\\s+)?(${IDENT}))?`,
    'gi'
  )
  for (const m of statement.matchAll(re)) {
    const parts = m[1].split('.').map((p) => unquote(p.trim()))
    const table = parts[parts.length - 1]
    const schema = parts.length > 1 ? parts[0] : undefined
    const ref = findTable(vocab, table, schema)
    if (!ref) continue
    const key = tableKey(ref)
    if (!keys.includes(key)) keys.push(key)
    const alias = m[2]
    if (alias && !isKeyword(alias)) aliases[alias.toLowerCase()] = key
    aliases[table.toLowerCase()] = key
  }
  return { keys, aliases }
}

function isKeyword(word: string): boolean {
  const w = word.toUpperCase()
  return TABLE_KEYWORDS.has(w) || COLUMN_KEYWORDS.has(w) || STATEMENT_STARTERS.includes(w) ||
    ['LEFT', 'RIGHT', 'INNER', 'OUTER', 'CROSS', 'FULL', 'GROUP', 'ORDER', 'LIMIT', 'OFFSET', 'UNION'].includes(w)
}

function tableKey(ref: TableRef): string {
  return `${ref.schema}.${ref.table}`
}

function findTable(vocab: SqlVocabulary, table: string, schema?: string): TableRef | undefined {
  const lt = table.toLowerCase()
  const ls = schema?.toLowerCase()
  return vocab.tables.find(
    (t) => t.table.toLowerCase() === lt && (!ls || t.schema.toLowerCase() === ls)
  )
}

/** `alias.` / `table.` / `schema.` — the qualifier pins down what follows. */
function qualifiedCandidates(qual: string, scope: Scope, vocab: SqlVocabulary): Suggestion[] {
  const key = scope.aliases[qual.toLowerCase()]
  if (key) return columnsOf(key, vocab)

  const schema = vocab.schemas.find((s) => s.toLowerCase() === qual.toLowerCase())
  if (schema) {
    return vocab.tables
      .filter((t) => t.schema === schema)
      .map((t) => ({ text: t.table, kind: 'table' as const, detail: t.schema }))
  }

  const ref = findTable(vocab, qual)
  return ref ? columnsOf(tableKey(ref), vocab) : []
}

function columnsOf(key: string, vocab: SqlVocabulary): Suggestion[] {
  const table = key.split('.').pop() as string
  return (vocab.columns[key] ?? []).map((c) => ({ text: c, kind: 'column' as const, detail: table }))
}

function contextCandidates(ctx: Context, scope: Scope, vocab: SqlVocabulary): Suggestion[] {
  const tables = vocab.tables.map((t) => ({ text: t.table, kind: 'table' as const, detail: t.schema }))
  const schemas = vocab.schemas.map((s) => ({ text: s, kind: 'schema' as const }))
  const keywords = vocab.keywords.map((k) => ({ text: k, kind: 'keyword' as const }))
  // Columns of the tables actually in FROM/JOIN come first; the rest of the
  // database's columns are still offered, just after them.
  const scoped = scope.keys.flatMap((k) => columnsOf(k, vocab))
  const scopedSet = new Set(scoped.map((s) => s.text.toLowerCase()))
  const others = Object.keys(vocab.columns)
    .filter((k) => !scope.keys.includes(k))
    .flatMap((k) => columnsOf(k, vocab))
    .filter((s) => !scopedSet.has(s.text.toLowerCase()))

  if (ctx === 'start') return STATEMENT_STARTERS.map((k) => ({ text: k, kind: 'keyword' as const }))
  if (ctx === 'table') return [...tables, ...schemas]
  if (ctx === 'column') return [...scoped, ...keywords, ...tables, ...others]
  return [...keywords, ...scoped, ...tables, ...schemas, ...others]
}

/**
 * Score matches so the obvious completion wins: case-sensitive prefix beats
 * case-insensitive prefix, which beats a match on a `_`-separated part, which
 * beats a scattered subsequence (`slct` -> `SELECT`). Order within a tie is the
 * candidate order, which the context already sorted by relevance.
 */
function rank(candidates: Suggestion[], word: string): Suggestion[] {
  if (!word) return dedupe(candidates).slice(0, MAX_ITEMS)
  const lower = word.toLowerCase()
  const scored: { item: Suggestion; score: number; order: number }[] = []

  dedupe(candidates).forEach((item, order) => {
    const text = item.text
    const lt = text.toLowerCase()
    if (lt === lower) return // already fully typed — nothing to offer
    let score: number
    if (text.startsWith(word)) score = 100
    else if (lt.startsWith(lower)) score = 90
    else if (partsStartWith(lt, lower)) score = 60
    else if (isSubsequence(lower, lt)) score = 30
    else return
    // Prefer the shorter of two equally-good matches.
    score -= Math.min(text.length, 20) / 100
    scored.push({ item, score, order })
  })

  scored.sort((a, b) => b.score - a.score || a.order - b.order)
  return scored.slice(0, MAX_ITEMS).map((s) => s.item)
}

function dedupe(items: Suggestion[]): Suggestion[] {
  const seen = new Set<string>()
  const out: Suggestion[] = []
  for (const i of items) {
    const k = `${i.kind}:${i.text.toLowerCase()}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(i)
  }
  return out
}

/** `created` matches `order_created_at` on its second part. */
function partsStartWith(text: string, prefix: string): boolean {
  return text.split(/[_$.]/).some((p, i) => i > 0 && p.startsWith(prefix))
}

function isSubsequence(needle: string, haystack: string): boolean {
  if (needle.length < 3) return false // too little signal; would match everything
  let i = 0
  for (const c of haystack) {
    if (c === needle[i]) i++
    if (i === needle.length) return true
  }
  return false
}
