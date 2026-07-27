import pg from 'pg'
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
import { buildCreateTable } from './ddl'

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
  private connCfg!: pg.PoolConfig
  private currentClient: pg.PoolClient | null = null

  async connect(cfg: ConnectionConfig, password?: string): Promise<void> {
    this.readOnly = !!cfg.readOnly
    this.connCfg = {
      host: cfg.host,
      port: cfg.port,
      database: cfg.database,
      user: cfg.user,
      password,
      ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
      max: 4,
      connectionTimeoutMillis: 10_000
    }
    this.pool = new Pool(this.connCfg)
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

  /**
   * Render `opts.filters` as a WHERE fragment (empty string when there is
   * nothing to filter on), pushing every value onto `params` as a bound
   * parameter. Text-matching ops cast the column to text so they work on any
   * type; comparison ops leave the parameter untyped so Postgres coerces it to
   * the column's own type and orders numbers and dates correctly.
   */
  private buildWhere(opts: Pick<TableDataOptions, 'filters' | 'filterJoin'>, params: unknown[]): string {
    const active = (opts.filters ?? []).filter(
      (f) => f.op === 'isNull' || f.op === 'notNull' || f.value !== ''
    )
    if (!active.length) return ''
    const p = (v: unknown): string => {
      params.push(v)
      return `$${params.length}`
    }
    const clauses = active.map((f) => {
      const col = quoteIdent(f.column)
      switch (f.op) {
        case 'isNull':
          return `${col} IS NULL`
        case 'notNull':
          return `${col} IS NOT NULL`
        case 'contains':
          return `${col}::text ILIKE ${p(`%${f.value}%`)}`
        // NULL never matches a NOT LIKE, but "does not contain x" should include
        // empty cells — otherwise the filter silently hides rows.
        case 'notContains':
          return `(${col} IS NULL OR ${col}::text NOT ILIKE ${p(`%${f.value}%`)})`
        case 'startsWith':
          return `${col}::text ILIKE ${p(`${f.value}%`)}`
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
    const limitP = `$${params.length + 1}`
    const offsetP = `$${params.length + 2}`
    const countParams = [...params]
    params.push(opts.limit, opts.offset)
    const sql = `SELECT * FROM ${this.qualified(schema, table)}${where}${order} LIMIT ${limitP} OFFSET ${offsetP}`
    const countSql = `SELECT COUNT(*) FROM ${this.qualified(schema, table)}${where}`
    const started = Date.now()
    const [res, countRes] = await Promise.all([
      this.pool.query({ text: sql, values: params, rowMode: 'array' }),
      this.pool.query(countSql, countParams)
    ])
    const columns: ColumnMeta[] = res.fields.map((f) => ({ name: f.name }))
    return {
      schema,
      table,
      columns,
      rows: res.rows as unknown[][],
      rowCount: res.rowCount ?? res.rows.length,
      totalRows: Number(countRes.rows[0].count),
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
    const sql = `SELECT * FROM ${this.qualified(schema, table)}${where}${order} LIMIT $${params.length}`
    const started = Date.now()
    const res = await this.pool.query({ text: sql, values: params, rowMode: 'array' })
    return {
      columns: res.fields.map((f) => ({ name: f.name })),
      rows: res.rows as unknown[][],
      rowCount: res.rowCount ?? res.rows.length,
      durationMs: Date.now() - started
    }
  }

  async getStructure(schema: string, table: string): Promise<TableStructure> {
    const oid = [quoteIdent(schema), quoteIdent(table)]
    const [colRes, idxRes, pks, foreignKeys, referencedBy] = await Promise.all([
      this.pool.query(
        `SELECT a.attname AS name,
                format_type(a.atttypid, a.atttypmod) AS data_type,
                NOT a.attnotnull AS nullable,
                pg_get_expr(d.adbin, d.adrelid) AS default_value
         FROM pg_attribute a
         LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
         WHERE a.attrelid = ($1 || '.' || $2)::regclass AND a.attnum > 0 AND NOT a.attisdropped
         ORDER BY a.attnum`,
        oid
      ),
      // Expression indexes have no pg_attribute row (attnum 0), so only their
      // plain columns are listed. attname is of type `name`, and node-pg has no
      // parser for a `name[]` — without the ::text cast every array_agg here
      // comes back as the raw "{a,b}" literal instead of an array.
      this.pool.query(
        `SELECT i.relname AS name,
                ix.indisunique AS "unique",
                ix.indisprimary AS "primary",
                array_agg(a.attname::text ORDER BY k.ord) AS columns
         FROM pg_index ix
         JOIN pg_class i ON i.oid = ix.indexrelid
         JOIN unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
         JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = k.attnum
         WHERE ix.indrelid = ($1 || '.' || $2)::regclass
         GROUP BY i.relname, ix.indisunique, ix.indisprimary
         ORDER BY ix.indisprimary DESC, i.relname`,
        oid
      ),
      this.getPrimaryKeys(schema, table),
      this.foreignKeys(oid, 'c.conrelid'),
      this.foreignKeys(oid, 'c.confrelid')
    ])

    const pkSet = new Set(pks)
    const columns: ColumnInfo[] = colRes.rows.map((r) => ({
      name: r.name as string,
      dataType: r.data_type as string,
      nullable: r.nullable as boolean,
      defaultValue: (r.default_value as string | null) ?? null,
      isPrimaryKey: pkSet.has(r.name as string)
    }))
    const indexes: IndexInfo[] = idxRes.rows.map((r) => ({
      name: r.name as string,
      columns: r.columns as string[],
      unique: r.unique as boolean,
      primary: r.primary as boolean
    }))

    return {
      schema,
      table,
      columns,
      indexes,
      foreignKeys,
      referencedBy,
      ddl: buildCreateTable(this.qualified(schema, table), columns, pks, foreignKeys, quoteIdent)
    }
  }

  /** Foreign keys where `side` (`c.conrelid` for outgoing, `c.confrelid` for
   *  incoming) is this table. */
  private async foreignKeys(oid: string[], side: string): Promise<ForeignKey[]> {
    const res = await this.pool.query(
      `SELECT c.conname AS constraint,
              ns.nspname AS schema, cl.relname AS "table",
              (SELECT array_agg(a.attname::text ORDER BY k.ord)
                 FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
                 JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS columns,
              fns.nspname AS ref_schema, fcl.relname AS ref_table,
              (SELECT array_agg(a.attname::text ORDER BY k.ord)
                 FROM unnest(c.confkey) WITH ORDINALITY k(attnum, ord)
                 JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum) AS ref_columns
       FROM pg_constraint c
       JOIN pg_class cl ON cl.oid = c.conrelid
       JOIN pg_namespace ns ON ns.oid = cl.relnamespace
       JOIN pg_class fcl ON fcl.oid = c.confrelid
       JOIN pg_namespace fns ON fns.oid = fcl.relnamespace
       WHERE c.contype = 'f' AND ${side} = ($1 || '.' || $2)::regclass
       ORDER BY c.conname`,
      oid
    )
    return res.rows.map((r) => ({
      constraint: r.constraint as string,
      schema: r.schema as string,
      table: r.table as string,
      columns: r.columns as string[],
      refSchema: r.ref_schema as string,
      refTable: r.ref_table as string,
      refColumns: r.ref_columns as string[]
    }))
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
    // Use a dedicated client (not pool.query) so its backend PID is stable and
    // reachable for cancellation while this query is in flight.
    const client = await this.pool.connect()
    this.currentClient = client
    try {
      const res = await client.query({ text: sql, rowMode: 'array' })
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
    } finally {
      this.currentClient = null
      client.release()
    }
  }

  async cancelCurrent(): Promise<void> {
    const client = this.currentClient
    // processID is set on every pg Client/PoolClient at runtime but isn't part
    // of the public @types/pg surface.
    const pid = (client as unknown as { processID?: number } | null)?.processID
    if (!pid) return
    const cancelClient = new pg.Client(this.connCfg)
    await cancelClient.connect()
    try {
      await cancelClient.query('SELECT pg_cancel_backend($1)', [pid])
    } finally {
      await cancelClient.end().catch(() => {})
    }
  }
}
