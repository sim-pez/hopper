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

/** A live, connected database driver instance. */
export interface Driver {
  connect(cfg: ConnectionConfig, password?: string): Promise<void>
  end(): Promise<void>
  ping(): Promise<void>

  listSchemas(): Promise<string[]>
  listTables(schema: string): Promise<TableRef[]>
  getColumns(schema: string, table: string): Promise<ColumnMeta[]>
  getPrimaryKeys(schema: string, table: string): Promise<string[]>

  getTableData(schema: string, table: string, opts: TableDataOptions): Promise<TableData>
  updateCell(payload: UpdateCellPayload): Promise<number>
  insertRow(payload: InsertRowPayload): Promise<Record<string, unknown>>
  deleteRow(payload: DeleteRowPayload): Promise<number>

  /** Render staged changes as readable SQL for a confirmation dialog (no execution). */
  previewChanges(payload: ApplyChangesPayload): Promise<string[]>
  /** Execute staged UPDATE/DELETE changes in a single transaction. */
  applyChanges(payload: ApplyChangesPayload): Promise<number>

  query(sql: string): Promise<QueryResult>
}
