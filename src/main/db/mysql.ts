import mysql from 'mysql2/promise'
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

// In MySQL a "schema" is a database. We treat the schema argument as the DB name.
function quoteIdent(id: string): string {
  return `\`${id.replace(/`/g, '``')}\``
}

/** A parameterized statement plus a display-only rendering with values inlined. */
interface Statement {
  text: string
  values: unknown[]
  preview: string
}

const SYSTEM_SCHEMAS = new Set(['mysql', 'information_schema', 'performance_schema', 'sys'])

export class MysqlDriver implements Driver {
  private pool!: mysql.Pool
  private readOnly = false
  private currentConn: mysql.PoolConnection | null = null

  async connect(cfg: ConnectionConfig, password?: string): Promise<void> {
    this.readOnly = !!cfg.readOnly
    this.pool = mysql.createPool({
      host: cfg.host,
      port: cfg.port,
      database: cfg.database || undefined,
      user: cfg.user,
      password,
      ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
      connectionLimit: 4,
      // Multi-statement execution would let a "read-only" connection smuggle a
      // write past the first-keyword regex check in query() below (e.g.
      // `SELECT 1; DROP TABLE users;`), so it's only enabled when writable.
      multipleStatements: !this.readOnly,
      connectTimeout: 10_000
    })
    const conn = await this.pool.getConnection()
    conn.release()
  }

  async end(): Promise<void> {
    await this.pool?.end()
  }

  async ping(): Promise<void> {
    const conn = await this.pool.getConnection()
    await conn.ping()
    conn.release()
  }

  async listSchemas(): Promise<string[]> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      'SELECT schema_name FROM information_schema.schemata ORDER BY schema_name'
    )
    return rows.map((r) => r.schema_name ?? r.SCHEMA_NAME).filter((s: string) => !SYSTEM_SCHEMAS.has(s))
  }

  async listTables(schema: string): Promise<TableRef[]> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT table_name, table_type FROM information_schema.tables
       WHERE table_schema = ? ORDER BY table_name`,
      [schema]
    )
    return rows.map((r) => ({
      schema,
      table: (r.table_name ?? r.TABLE_NAME) as string,
      type: (r.table_type ?? r.TABLE_TYPE) === 'VIEW' ? 'view' : 'table'
    }))
  }

  async getColumns(schema: string, table: string): Promise<ColumnMeta[]> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position`,
      [schema, table]
    )
    return rows.map((r) => ({
      name: (r.column_name ?? r.COLUMN_NAME) as string,
      dataType: (r.data_type ?? r.DATA_TYPE) as string
    }))
  }

  async getPrimaryKeys(schema: string, table: string): Promise<string[]> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT column_name FROM information_schema.key_column_usage
       WHERE table_schema = ? AND table_name = ? AND constraint_name = 'PRIMARY'
       ORDER BY ordinal_position`,
      [schema, table]
    )
    return rows.map((r) => (r.column_name ?? r.COLUMN_NAME) as string)
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
        return `CAST(${quoteIdent(f.column)} AS CHAR) LIKE ?`
      })
      where = ` WHERE ${clauses.join(' OR ')}`
    }
    const order = opts.orderBy
      ? ` ORDER BY ${quoteIdent(opts.orderBy.column)} ${opts.orderBy.desc ? 'DESC' : 'ASC'}`
      : ''
    params.push(opts.limit, opts.offset)
    const sql = `SELECT * FROM ${this.qualified(schema, table)}${where}${order} LIMIT ? OFFSET ?`
    const started = Date.now()
    const [rows, fields] = await this.pool.query<mysql.RowDataPacket[]>({
      sql,
      values: params,
      rowsAsArray: true
    })
    const columns: ColumnMeta[] = (fields ?? []).map((f) => ({ name: f.name }))
    return {
      schema,
      table,
      columns,
      rows: rows as unknown[][],
      rowCount: rows.length,
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
    const where = pkCols.map((c) => `${quoteIdent(c)} = ?`).join(' AND ')
    const sql = `UPDATE ${this.qualified(p.schema, p.table)} SET ${quoteIdent(p.column)} = ? WHERE ${where}`
    const [res] = await this.pool.query<mysql.ResultSetHeader>(sql, [p.value, ...pkCols.map((c) => p.pk[c])])
    return res.affectedRows
  }

  async insertRow(p: InsertRowPayload): Promise<Record<string, unknown>> {
    this.assertWritable()
    const cols = Object.keys(p.values)
    if (cols.length === 0) throw new Error('No values provided')
    const placeholders = cols.map(() => '?').join(', ')
    const sql = `INSERT INTO ${this.qualified(p.schema, p.table)} (${cols
      .map(quoteIdent)
      .join(', ')}) VALUES (${placeholders})`
    const [res] = await this.pool.query<mysql.ResultSetHeader>(sql, cols.map((c) => p.values[c]))
    return { insertId: res.insertId, affectedRows: res.affectedRows, ...p.values }
  }

  async deleteRow(p: DeleteRowPayload): Promise<number> {
    this.assertWritable()
    const pkCols = Object.keys(p.pk)
    if (pkCols.length === 0) throw new Error('Cannot delete: table has no primary key')
    const where = pkCols.map((c) => `${quoteIdent(c)} = ?`).join(' AND ')
    const sql = `DELETE FROM ${this.qualified(p.schema, p.table)} WHERE ${where}`
    const [res] = await this.pool.query<mysql.ResultSetHeader>(sql, pkCols.map((c) => p.pk[c]))
    return res.affectedRows
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
        const where = pkCols.map((c) => `${quoteIdent(c)} = ?`).join(' AND ')
        const preview = `DELETE FROM ${qtable} WHERE ${pkCols
          .map((c) => `${quoteIdent(c)} = ${previewLiteral(ch.pk[c])}`)
          .join(' AND ')}`
        stmts.push({ text: `DELETE FROM ${qtable} WHERE ${where}`, values, preview })
      } else if (ch.set && Object.keys(ch.set).length) {
        const setCols = Object.keys(ch.set)
        const setClause = setCols.map((c) => `${quoteIdent(c)} = ?`).join(', ')
        const where = pkCols.map((c) => `${quoteIdent(c)} = ?`).join(' AND ')
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
    const conn = await this.pool.getConnection()
    let affected = 0
    try {
      await conn.beginTransaction()
      for (const s of stmts) {
        const [res] = await conn.query<mysql.ResultSetHeader>(s.text, s.values)
        affected += res.affectedRows ?? 0
      }
      await conn.commit()
    } catch (err) {
      await conn.rollback()
      throw err
    } finally {
      conn.release()
    }
    return affected
  }

  async query(sql: string): Promise<QueryResult> {
    if (this.readOnly && !/^\s*(select|with|explain|show|describe|desc)\b/i.test(sql)) {
      throw new Error('Connection is read-only: only SELECT/SHOW queries are allowed')
    }
    const started = Date.now()
    // Use a dedicated connection (not pool.query) so its thread id is stable
    // and reachable for cancellation while this query is in flight.
    const conn = await this.pool.getConnection()
    this.currentConn = conn
    try {
      const [result, fields] = await conn.query({ sql, rowsAsArray: true })
      // DML returns a ResultSetHeader object (not an array of rows).
      if (!Array.isArray(result)) {
        const header = result as mysql.ResultSetHeader
        return {
          columns: [],
          rows: [],
          rowCount: header.affectedRows ?? 0,
          command: 'OK',
          durationMs: Date.now() - started
        }
      }
      const columns: ColumnMeta[] = ((fields as mysql.FieldPacket[]) ?? []).map((f) => ({ name: f.name }))
      return {
        columns,
        rows: result as unknown[][],
        rowCount: result.length,
        durationMs: Date.now() - started
      }
    } finally {
      this.currentConn = null
      conn.release()
    }
  }

  async cancelCurrent(): Promise<void> {
    const conn = this.currentConn
    const threadId = conn?.threadId
    if (!threadId) return
    const killer = await this.pool.getConnection()
    try {
      await killer.query('KILL QUERY ?', [threadId])
    } finally {
      killer.release()
    }
  }
}
