import pg from 'pg'
import type {
  ApplyChangesPayload,
  ColumnMeta,
  ConnectionConfig,
  DeleteRowPayload,
  InsertRowPayload,
  QueryResult,
  TableData,
  TableDataOptions,
  TableRef,
  UpdateCellPayload
} from '@shared/types'
import type { Driver } from './types'
import { previewLiteral } from './sqlPreview'

const { Pool } = pg

// Return everything as text-friendly JS values but keep bytea/json readable.
function quoteIdent(id: string): string {
  return `"${id.replace(/"/g, '""')}"`
}

/** A parameterized statement plus a display-only rendering with values inlined. */
interface Statement {
  text: string
  values: unknown[]
  preview: string
}

export class PostgresDriver implements Driver {
  private pool!: pg.Pool
  private readOnly = false

  async connect(cfg: ConnectionConfig, password?: string): Promise<void> {
    this.readOnly = !!cfg.readOnly
    this.pool = new Pool({
      host: cfg.host,
      port: cfg.port,
      database: cfg.database,
      user: cfg.user,
      password,
      ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
      max: 4,
      connectionTimeoutMillis: 10_000
    })
    // Force an actual connection so failures surface now.
    const client = await this.pool.connect()
    client.release()
  }

  async end(): Promise<void> {
    await this.pool?.end()
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1')
  }

  async listSchemas(): Promise<string[]> {
    const res = await this.pool.query(
      `SELECT schema_name FROM information_schema.schemata
       WHERE schema_name NOT LIKE 'pg_%' AND schema_name <> 'information_schema'
       ORDER BY schema_name`
    )
    return res.rows.map((r) => r.schema_name as string)
  }

  async listTables(schema: string): Promise<TableRef[]> {
    const res = await this.pool.query(
      `SELECT table_name, table_type FROM information_schema.tables
       WHERE table_schema = $1 ORDER BY table_name`,
      [schema]
    )
    return res.rows.map((r) => ({
      schema,
      table: r.table_name as string,
      type: r.table_type === 'VIEW' ? 'view' : 'table'
    }))
  }

  async getColumns(schema: string, table: string): Promise<ColumnMeta[]> {
    const res = await this.pool.query(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
      [schema, table]
    )
    return res.rows.map((r) => ({ name: r.column_name as string, dataType: r.data_type as string }))
  }

  async getPrimaryKeys(schema: string, table: string): Promise<string[]> {
    const res = await this.pool.query(
      `SELECT a.attname AS column_name
       FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
       WHERE i.indrelid = ($1 || '.' || $2)::regclass AND i.indisprimary
       ORDER BY a.attnum`,
      [quoteIdent(schema), quoteIdent(table)]
    )
    return res.rows.map((r) => r.column_name as string)
  }

  private qualified(schema: string, table: string): string {
    return `${quoteIdent(schema)}.${quoteIdent(table)}`
  }

  async getTableData(schema: string, table: string, opts: TableDataOptions): Promise<TableData> {
    const pks = await this.getPrimaryKeys(schema, table)
    const params: unknown[] = []
    let where = ''
    if (opts.filters?.length) {
      const clauses = opts.filters.map((f) => {
        params.push(`%${f.value}%`)
        return `${quoteIdent(f.column)}::text ILIKE $${params.length}`
      })
      where = ` WHERE ${clauses.join(' OR ')}`
    }
    const order = opts.orderBy
      ? ` ORDER BY ${quoteIdent(opts.orderBy.column)} ${opts.orderBy.desc ? 'DESC' : 'ASC'}`
      : ''
    const limitP = `$${params.length + 1}`
    const offsetP = `$${params.length + 2}`
    params.push(opts.limit, opts.offset)
    const sql = `SELECT * FROM ${this.qualified(schema, table)}${where}${order} LIMIT ${limitP} OFFSET ${offsetP}`
    const started = Date.now()
    const res = await this.pool.query({ text: sql, values: params, rowMode: 'array' })
    const columns: ColumnMeta[] = res.fields.map((f) => ({ name: f.name }))
    return {
      schema,
      table,
      columns,
      rows: res.rows as unknown[][],
      rowCount: res.rowCount ?? res.rows.length,
      primaryKeys: pks,
      editable: !this.readOnly && pks.length > 0,
      limit: opts.limit,
      offset: opts.offset,
      durationMs: Date.now() - started
    }
  }

  private assertWritable(): void {
    if (this.readOnly) throw new Error('Connection is read-only')
  }

  async updateCell(p: UpdateCellPayload): Promise<number> {
    this.assertWritable()
    const pkCols = Object.keys(p.pk)
    if (pkCols.length === 0) throw new Error('Cannot update: table has no primary key')
    const where = pkCols.map((c, i) => `${quoteIdent(c)} = $${i + 2}`).join(' AND ')
    const sql = `UPDATE ${this.qualified(p.schema, p.table)} SET ${quoteIdent(p.column)} = $1 WHERE ${where}`
    const res = await this.pool.query(sql, [p.value, ...pkCols.map((c) => p.pk[c])])
    return res.rowCount ?? 0
  }

  async insertRow(p: InsertRowPayload): Promise<Record<string, unknown>> {
    this.assertWritable()
    const cols = Object.keys(p.values)
    if (cols.length === 0) throw new Error('No values provided')
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ')
    const sql = `INSERT INTO ${this.qualified(p.schema, p.table)} (${cols
      .map(quoteIdent)
      .join(', ')}) VALUES (${placeholders}) RETURNING *`
    const res = await this.pool.query(sql, cols.map((c) => p.values[c]))
    return res.rows[0] ?? {}
  }

  async deleteRow(p: DeleteRowPayload): Promise<number> {
    this.assertWritable()
    const pkCols = Object.keys(p.pk)
    if (pkCols.length === 0) throw new Error('Cannot delete: table has no primary key')
    const where = pkCols.map((c, i) => `${quoteIdent(c)} = $${i + 1}`).join(' AND ')
    const sql = `DELETE FROM ${this.qualified(p.schema, p.table)} WHERE ${where}`
    const res = await this.pool.query(sql, pkCols.map((c) => p.pk[c]))
    return res.rowCount ?? 0
  }

  /** Turn staged row changes into parameterized UPDATE/DELETE statements. */
  private buildStatements(p: ApplyChangesPayload): Statement[] {
    const stmts: Statement[] = []
    for (const ch of p.changes) {
      const pkCols = Object.keys(ch.pk)
      if (pkCols.length === 0) throw new Error('Cannot edit: table has no primary key')
      const qtable = this.qualified(p.schema, p.table)
      if (ch.del) {
        const values = pkCols.map((c) => ch.pk[c])
        const where = pkCols.map((c, i) => `${quoteIdent(c)} = $${i + 1}`).join(' AND ')
        const preview = `DELETE FROM ${qtable} WHERE ${pkCols
          .map((c) => `${quoteIdent(c)} = ${previewLiteral(ch.pk[c])}`)
          .join(' AND ')}`
        stmts.push({ text: `DELETE FROM ${qtable} WHERE ${where}`, values, preview })
      } else if (ch.set && Object.keys(ch.set).length) {
        const setCols = Object.keys(ch.set)
        const setClause = setCols.map((c, i) => `${quoteIdent(c)} = $${i + 1}`).join(', ')
        const where = pkCols.map((c, i) => `${quoteIdent(c)} = $${setCols.length + i + 1}`).join(' AND ')
        const values = [...setCols.map((c) => ch.set![c]), ...pkCols.map((c) => ch.pk[c])]
        const preview = `UPDATE ${qtable} SET ${setCols
          .map((c) => `${quoteIdent(c)} = ${previewLiteral(ch.set![c])}`)
          .join(', ')} WHERE ${pkCols
          .map((c) => `${quoteIdent(c)} = ${previewLiteral(ch.pk[c])}`)
          .join(' AND ')}`
        stmts.push({ text: `UPDATE ${qtable} SET ${setClause} WHERE ${where}`, values, preview })
      }
    }
    return stmts
  }

  async previewChanges(p: ApplyChangesPayload): Promise<string[]> {
    return this.buildStatements(p).map((s) => `${s.preview};`)
  }

  async applyChanges(p: ApplyChangesPayload): Promise<number> {
    this.assertWritable()
    const stmts = this.buildStatements(p)
    const client = await this.pool.connect()
    let affected = 0
    try {
      await client.query('BEGIN')
      for (const s of stmts) {
        const res = await client.query(s.text, s.values)
        affected += res.rowCount ?? 0
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
    return affected
  }

  async query(sql: string): Promise<QueryResult> {
    if (this.readOnly && !/^\s*(select|with|explain|show)\b/i.test(sql)) {
      throw new Error('Connection is read-only: only SELECT/EXPLAIN queries are allowed')
    }
    const started = Date.now()
    const res = await this.pool.query({ text: sql, rowMode: 'array' })
    // Multiple statements return an array of results; surface the last one.
    const result = Array.isArray(res) ? res[res.length - 1] : res
    const columns: ColumnMeta[] = (result.fields ?? []).map((f: pg.FieldDef) => ({ name: f.name }))
    return {
      columns,
      rows: (result.rows as unknown[][]) ?? [],
      rowCount: result.rowCount ?? (result.rows?.length ?? 0),
      command: result.command,
      durationMs: Date.now() - started
    }
  }
}
