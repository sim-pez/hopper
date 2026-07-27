import mysql from 'mysql2/promise'
import type {
  ApplyChangesPayload,
  ColumnInfo,
  ColumnMeta,
  ConnectionConfig,
  DeleteRowPayload,
  ExportOptions,
  ForeignKey,
  IndexInfo,
  InsertRowPayload,
  QueryResult,
  TableData,
  TableDataOptions,
  TableRef,
  TableStructure,
  UpdateCellPayload
} from '@shared/types'
import type { Driver } from './types'
import { previewLiteral } from './sqlPreview'

// In MySQL a "schema" is a database. We treat the schema argument as the DB name.
function quoteIdent(id: string): string {
  return `\`${id.replace(/`/g, '``')}\``
}

/** information_schema column names come back lower- or upper-cased depending on
 *  the server's `lower_case_table_names` and version — accept either. */
function field<T>(row: mysql.RowDataPacket, name: string): T {
  return (row[name] ?? row[name.toUpperCase()]) as T
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

  /**
   * Render `opts.filters` as a WHERE fragment (empty string when there is
   * nothing to filter on), pushing every value onto `params` as a bound
   * parameter. Text-matching ops cast the column to CHAR so they work on any
   * type; comparison ops leave the parameter untyped so MySQL coerces it to the
   * column's own type and orders numbers and dates correctly.
   */
  private buildWhere(opts: Pick<TableDataOptions, 'filters' | 'filterJoin'>, params: unknown[]): string {
    const active = (opts.filters ?? []).filter(
      (f) => f.op === 'isNull' || f.op === 'notNull' || f.value !== ''
    )
    if (!active.length) return ''
    const p = (v: unknown): string => {
      params.push(v)
      return '?'
    }
    const clauses = active.map((f) => {
      const col = quoteIdent(f.column)
      const asText = `CAST(${col} AS CHAR)`
      switch (f.op) {
        case 'isNull':
          return `${col} IS NULL`
        case 'notNull':
          return `${col} IS NOT NULL`
        case 'contains':
          return `${asText} LIKE ${p(`%${f.value}%`)}`
        // NULL never matches a NOT LIKE, but "does not contain x" should include
        // empty cells — otherwise the filter silently hides rows.
        case 'notContains':
          return `(${col} IS NULL OR ${asText} NOT LIKE ${p(`%${f.value}%`)})`
        case 'startsWith':
          return `${asText} LIKE ${p(`${f.value}%`)}`
        case 'ne':
          return `(${col} IS NULL OR ${col} <> ${p(f.value)})`
        case 'in': {
          const items = f.value.split(',').map((s) => s.trim()).filter((s) => s !== '')
          if (!items.length) return 'FALSE'
          return `${col} IN (${items.map(p).join(', ')})`
        }
        default: {
          const sign = { eq: '=', gt: '>', gte: '>=', lt: '<', lte: '<=' }[f.op]
          return `${col} ${sign} ${p(f.value)}`
        }
      }
    })
    return ` WHERE ${clauses.join(opts.filterJoin === 'or' ? ' OR ' : ' AND ')}`
  }

  private orderClause(opts: Pick<TableDataOptions, 'orderBy'>): string {
    return opts.orderBy
      ? ` ORDER BY ${quoteIdent(opts.orderBy.column)} ${opts.orderBy.desc ? 'DESC' : 'ASC'}`
      : ''
  }

  async getTableData(schema: string, table: string, opts: TableDataOptions): Promise<TableData> {
    const pks = await this.getPrimaryKeys(schema, table)
    const params: unknown[] = []
    const where = this.buildWhere(opts, params)
    const order = this.orderClause(opts)
    const countParams = [...params]
    params.push(opts.limit, opts.offset)
    const sql = `SELECT * FROM ${this.qualified(schema, table)}${where}${order} LIMIT ? OFFSET ?`
    const countSql = `SELECT COUNT(*) AS count FROM ${this.qualified(schema, table)}${where}`
    const started = Date.now()
    const [[rows, fields], [countRows]] = await Promise.all([
      this.pool.query<mysql.RowDataPacket[]>({ sql, values: params, rowsAsArray: true }),
      this.pool.query<mysql.RowDataPacket[]>(countSql, countParams)
    ])
    const columns: ColumnMeta[] = (fields ?? []).map((f) => ({ name: f.name }))
    return {
      schema,
      table,
      columns,
      rows: rows as unknown[][],
      rowCount: rows.length,
      totalRows: Number(countRows[0].count),
      primaryKeys: pks,
      editable: !this.readOnly && pks.length > 0,
      limit: opts.limit,
      offset: opts.offset,
      durationMs: Date.now() - started
    }
  }

  async exportTableData(schema: string, table: string, opts: ExportOptions): Promise<QueryResult> {
    const params: unknown[] = []
    const where = this.buildWhere(opts, params)
    const order = this.orderClause(opts)
    params.push(opts.maxRows)
    const sql = `SELECT * FROM ${this.qualified(schema, table)}${where}${order} LIMIT ?`
    const started = Date.now()
    const [rows, fields] = await this.pool.query<mysql.RowDataPacket[]>({
      sql,
      values: params,
      rowsAsArray: true
    })
    return {
      columns: (fields ?? []).map((f) => ({ name: f.name })),
      rows: rows as unknown[][],
      rowCount: rows.length,
      durationMs: Date.now() - started
    }
  }

  async getStructure(schema: string, table: string): Promise<TableStructure> {
    const [colRows, idxRows, foreignKeys, referencedBy, ddl] = await Promise.all([
      this.pool
        .query<mysql.RowDataPacket[]>(
          `SELECT column_name, column_type, is_nullable, column_default, column_key
           FROM information_schema.columns
           WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position`,
          [schema, table]
        )
        .then(([r]) => r),
      this.pool
        .query<mysql.RowDataPacket[]>(
          `SELECT index_name, non_unique, seq_in_index, column_name
           FROM information_schema.statistics
           WHERE table_schema = ? AND table_name = ?
           ORDER BY index_name, seq_in_index`,
          [schema, table]
        )
        .then(([r]) => r),
      this.foreignKeys('k.table_schema = ? AND k.table_name = ?', [schema, table]),
      this.foreignKeys('k.referenced_table_schema = ? AND k.referenced_table_name = ?', [schema, table]),
      this.showCreateTable(schema, table)
    ])

    const columns: ColumnInfo[] = colRows.map((r) => ({
      name: field<string>(r, 'column_name'),
      dataType: field<string>(r, 'column_type'),
      nullable: field<string>(r, 'is_nullable') === 'YES',
      defaultValue: field<string | null>(r, 'column_default') ?? null,
      isPrimaryKey: field<string>(r, 'column_key') === 'PRI'
    }))

    // statistics has one row per index column; fold them back into one entry.
    const byName = new Map<string, IndexInfo>()
    for (const r of idxRows) {
      const name = field<string>(r, 'index_name')
      let idx = byName.get(name)
      if (!idx) {
        idx = { name, columns: [], unique: Number(field(r, 'non_unique')) === 0, primary: name === 'PRIMARY' }
        byName.set(name, idx)
      }
      idx.columns.push(field<string>(r, 'column_name'))
    }
    const indexes = [...byName.values()].sort((a, b) => Number(b.primary) - Number(a.primary))

    return { schema, table, columns, indexes, foreignKeys, referencedBy, ddl }
  }

  private async showCreateTable(schema: string, table: string): Promise<string> {
    try {
      const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
        `SHOW CREATE TABLE ${this.qualified(schema, table)}`
      )
      // The column is "Create Table" for tables and "Create View" for views.
      const row = rows[0] ?? {}
      return (row['Create Table'] ?? row['Create View'] ?? '') as string
    } catch {
      return '' // e.g. no SHOW privilege — the rest of the pane still works.
    }
  }

  /** Foreign keys matching `predicate` (aliased `k`), folded from the one-row-per-column
   *  shape of key_column_usage. */
  private async foreignKeys(predicate: string, params: unknown[]): Promise<ForeignKey[]> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT k.constraint_name, k.table_schema, k.table_name, k.column_name,
              k.referenced_table_schema, k.referenced_table_name, k.referenced_column_name
       FROM information_schema.key_column_usage k
       WHERE k.referenced_table_name IS NOT NULL AND ${predicate}
       ORDER BY k.constraint_name, k.ordinal_position`,
      params
    )
    const byName = new Map<string, ForeignKey>()
    for (const r of rows) {
      // A constraint name is only unique within its table, so key on both.
      const owner = `${field<string>(r, 'table_schema')}.${field<string>(r, 'table_name')}`
      const key = `${owner}.${field<string>(r, 'constraint_name')}`
      let fk = byName.get(key)
      if (!fk) {
        fk = {
          constraint: field<string>(r, 'constraint_name'),
          schema: field<string>(r, 'table_schema'),
          table: field<string>(r, 'table_name'),
          columns: [],
          refSchema: field<string>(r, 'referenced_table_schema'),
          refTable: field<string>(r, 'referenced_table_name'),
          refColumns: []
        }
        byName.set(key, fk)
      }
      fk.columns.push(field<string>(r, 'column_name'))
      fk.refColumns.push(field<string>(r, 'referenced_column_name'))
    }
    return [...byName.values()]
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
