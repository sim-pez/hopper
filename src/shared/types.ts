// Shared type contract used by the main process, preload bridge, and renderer.

export type DriverKind = 'postgres' | 'mysql'

/** A named group of connections. Exactly one workspace is active at a time; the
 *  sidebar only lists the active workspace's connections. */
export interface Workspace {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

export interface WorkspaceInput {
  id?: string
  name: string
}

/** Connection metadata persisted to disk. The password is NOT part of this
 *  object when persisted — it is stored separately, encrypted. */
export interface ConnectionConfig {
  id: string
  /** Workspace this connection belongs to. */
  workspaceId: string
  name: string
  driver: DriverKind
  host: string
  port: number
  database: string
  user: string
  ssl?: boolean
  readOnly?: boolean
  /** Bash executed before connecting, e.g. `kubectl port-forward svc/db 5432:5432`. */
  preScript?: string
  /** If set, connection waits until a line of script output matches this regex. */
  preScriptReadyRegex?: string
  /** Fallback wait (ms) after starting the script when no ready regex is given. */
  preScriptWaitMs?: number
  /** Which structured config `preScript`/`preScriptReadyRegex` are generated from.
   *  'none' (default) runs `preScript` verbatim, or nothing if it is empty. */
  preConnectionMode?: 'none' | 'ssh-devcontainer' | 'kubectl'
  /** Structured config for the SSH + devcontainer pre-connection wizard. Only meaningful
   *  when `preConnectionMode === 'ssh-devcontainer'`. */
  sshDevcontainer?: SshDevcontainerConfig
  /** Structured config for a plain local `kubectl port-forward`. Only meaningful when
   *  `preConnectionMode === 'kubectl'`. */
  kubectl?: KubectlConfig
  createdAt: number
  updatedAt: number
}

export interface SshDevcontainerConfig {
  /** Host alias from ~/.ssh/config. */
  sshHost: string
  /** Path to the devcontainer's workspace folder on the remote host. */
  workspaceFolder: string
  /** Command run inside the devcontainer, e.g. `kubectl port-forward svc/db 5432:5432 ...`. */
  portForwardCommand: string
  /** Port the command listens on inside the devcontainer. */
  remotePort: number
}

/** A `kubectl port-forward` run directly on this machine — no SSH hop. The local
 *  port is not part of this config: a free one is picked on every connect
 *  (`main/ssh/resolvePreConnection.ts`). */
export interface KubectlConfig {
  /** Path to the kubeconfig file, e.g. `/Users/me/.kube/pho-dev.yaml`. Empty means
   *  kubectl's own default resolution (`$KUBECONFIG` / `~/.kube/config`). */
  kubeconfig: string
  /** Context within the kubeconfig. Empty means its `current-context`. */
  context: string
  namespace: string
  /** Port-forward target, e.g. `svc/erbavita-pg-cluster-rw` or `pod/db-0`. */
  target: string
  /** Port to forward on the target. */
  remotePort: number
}

/** Draft used when creating/updating a connection from the UI. */
export interface ConnectionInput
  extends Omit<ConnectionConfig, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt'> {
  id?: string
  /** Target workspace. Defaults to the active workspace on create; ignored on update. */
  workspaceId?: string
  /** New password. Leave undefined to keep the existing one on update. */
  password?: string
}

/** Connection as returned to the renderer by list/save — never carries the password. */
export interface ConnectionView extends ConnectionConfig {
  hasPassword: boolean
}

/** Full connection settings as shown in the form's JSON box and shared between
 *  machines. Unlike `ConnectionView` this DOES carry the plaintext password —
 *  it is only produced by the explicit `connections.exportConfig` call. Identity
 *  (`id`) and timestamps are omitted so an imported config can be saved as a new
 *  connection or applied onto an existing one. */
export interface ConnectionExport
  extends Omit<ConnectionConfig, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt'> {
  password?: string
}

export type ConnectionState =
  | 'disconnected'
  | 'starting-script'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error'

export interface ConnectionStatus {
  id: string
  state: ConnectionState
  error?: string
  scriptRunning: boolean
  /** 1-based attempt number while `state === 'reconnecting'`. */
  reconnectAttempt?: number
}

export interface ColumnMeta {
  name: string
  dataType?: string
}

export interface QueryResult {
  columns: ColumnMeta[]
  rows: unknown[][]
  rowCount: number
  command?: string
  /** Wall-clock duration in ms. */
  durationMs?: number
}

export interface TableData extends QueryResult {
  schema: string
  table: string
  primaryKeys: string[]
  /** Whether the grid can safely issue single-row UPDATE/DELETE (needs a PK). */
  editable: boolean
  limit: number
  offset: number
  /** Total rows matching the current filters, ignoring limit/offset. */
  totalRows: number
}

export interface TableRef {
  schema: string
  table: string
  type: string
}

/** Comparison used by a `ColumnFilter`.
 *  - `contains`/`notContains`/`startsWith` match case-insensitively against the
 *    column cast to text, so they work on any type.
 *  - `eq`/`ne`/`gt`/`gte`/`lt`/`lte`/`in` compare in the column's own type, so
 *    numbers and dates order correctly (the DB coerces the bound text value).
 *  - `isNull`/`notNull` take no value. */
export type FilterOp =
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'isNull'
  | 'notNull'

/** Ops that ignore `ColumnFilter.value` entirely. */
export const VALUELESS_OPS: readonly FilterOp[] = ['isNull', 'notNull']

/** A single condition on one column. */
export interface ColumnFilter {
  column: string
  op: FilterOp
  /** Unused for `isNull`/`notNull`; comma-separated for `in`. */
  value: string
}

export interface TableDataOptions {
  limit: number
  offset: number
  orderBy?: { column: string; desc: boolean }
  filters?: ColumnFilter[]
  /** How multiple filters combine. Defaults to `'and'`. */
  filterJoin?: 'and' | 'or'
}

/** Fetch every row matching the filters instead of one page, for export.
 *  `maxRows` is a hard stop so a huge table can't exhaust memory. */
export type ExportOptions = Omit<TableDataOptions, 'limit' | 'offset'> & { maxRows: number }

/** One foreign key, described from its owning (referencing) side. Composite keys
 *  keep `columns`/`refColumns` aligned by position. */
export interface ForeignKey {
  constraint: string
  schema: string
  table: string
  columns: string[]
  refSchema: string
  refTable: string
  refColumns: string[]
}

export interface ColumnInfo extends ColumnMeta {
  nullable: boolean
  defaultValue: string | null
  isPrimaryKey: boolean
}

export interface IndexInfo {
  name: string
  columns: string[]
  unique: boolean
  primary: boolean
}

/** Everything the structure pane shows for one table. */
export interface TableStructure {
  schema: string
  table: string
  columns: ColumnInfo[]
  indexes: IndexInfo[]
  /** FKs on this table, pointing elsewhere. */
  foreignKeys: ForeignKey[]
  /** FKs on other tables, pointing at this one. */
  referencedBy: ForeignKey[]
  /** `CREATE TABLE` text — `SHOW CREATE TABLE` on MySQL, synthesized on Postgres. */
  ddl: string
}

/** One pending row change staged in the grid before the user saves. */
export interface RowChange {
  /** Column name -> value identifying the original row. */
  pk: Record<string, unknown>
  /** Changed columns -> new values (for an UPDATE). Omit for a delete. */
  set?: Record<string, unknown>
  /** True when the row should be deleted. */
  del?: boolean
}

export interface ApplyChangesPayload {
  schema: string
  table: string
  changes: RowChange[]
}

export interface UpdateCellPayload {
  schema: string
  table: string
  /** Column name -> value identifying the row. */
  pk: Record<string, unknown>
  column: string
  value: unknown
}

export interface DeleteRowPayload {
  schema: string
  table: string
  pk: Record<string, unknown>
}

export interface InsertRowPayload {
  schema: string
  table: string
  values: Record<string, unknown>
}

/** One SQL statement previously run, for the history panel. Pinned entries sort
 *  to the top, survive the cap and "clear history", and can carry a name. */
export interface QueryHistoryEntry {
  id: string
  sql: string
  ts: number
  pinned?: boolean
  /** Label shown instead of the timestamp. Only set while pinned. */
  name?: string
}

/** A statement being recorded — the store assigns the id. */
export interface QueryHistoryInput {
  sql: string
  ts: number
}

export interface ScriptOutput {
  id: string
  stream: 'stdout' | 'stderr' | 'system'
  data: string
  ts: number
}

export interface TestResult {
  ok: boolean
  latencyMs?: number
  message: string
}

/** Shape exposed on `window.api` by the preload bridge. */
export interface Api {
  /** Connection groups. The active workspace scopes what the sidebar shows. */
  workspaces: {
    list: () => Promise<Workspace[]>
    /** Create (no id) or rename (with id). */
    save: (input: WorkspaceInput) => Promise<Workspace>
    /** Deletes the workspace and every connection in it. Returns the id active
     *  afterwards, or null when it was the last workspace. */
    delete: (id: string) => Promise<string | null>
    /** Null until the user creates their first workspace. */
    getActive: () => Promise<string | null>
    setActive: (id: string) => Promise<string>
  }
  connections: {
    /** Connections in `workspaceId`, or in the active workspace when omitted. */
    list: (workspaceId?: string) => Promise<ConnectionView[]>
    save: (input: ConnectionInput) => Promise<ConnectionView>
    delete: (id: string) => Promise<void>
    duplicate: (id: string) => Promise<ConnectionView>
    /** Test a saved connection by id. */
    test: (id: string) => Promise<TestResult>
    /** Test an unsaved draft (runs the pre-script + connects + pings) without persisting it. */
    testDraft: (input: ConnectionInput) => Promise<TestResult>
    /** Full settings of a saved connection, password included in plaintext, for
     *  the form's export/import JSON box. */
    exportConfig: (id: string) => Promise<ConnectionExport>
  }
  db: {
    connect: (id: string) => Promise<ConnectionStatus>
    disconnect: (id: string) => Promise<ConnectionStatus>
    status: (id: string) => Promise<ConnectionStatus>
    listSchemas: (id: string) => Promise<string[]>
    listTables: (id: string, schema: string) => Promise<TableRef[]>
    getColumns: (id: string, schema: string, table: string) => Promise<ColumnMeta[]>
    /** Columns, indexes and foreign keys for the structure pane. */
    getStructure: (id: string, schema: string, table: string) => Promise<TableStructure>
    getTableData: (id: string, schema: string, table: string, opts: TableDataOptions) => Promise<TableData>
    /** Every row matching the filters (up to `opts.maxRows`), for a full export. */
    exportTableData: (id: string, schema: string, table: string, opts: ExportOptions) => Promise<QueryResult>
    updateCell: (id: string, payload: UpdateCellPayload) => Promise<number>
    insertRow: (id: string, payload: InsertRowPayload) => Promise<Record<string, unknown>>
    deleteRow: (id: string, payload: DeleteRowPayload) => Promise<number>
    /** Build human-readable SQL for staged changes, for a confirmation preview. */
    previewChanges: (id: string, payload: ApplyChangesPayload) => Promise<string[]>
    /** Apply staged UPDATE/DELETE changes atomically; returns rows affected. */
    applyChanges: (id: string, payload: ApplyChangesPayload) => Promise<number>
    query: (id: string, sql: string) => Promise<QueryResult>
    /** Cancel whatever `query()` call is currently in flight on this connection, if any. */
    cancelQuery: (id: string) => Promise<void>
  }
  scripts: {
    onOutput: (cb: (out: ScriptOutput) => void) => () => void
    onStatus: (cb: (status: ConnectionStatus) => void) => () => void
  }
  /** Query history, bucketed by key (100 unpinned entries per key; pinned ones
   *  are never dropped). Every call returns the updated list: pinned first,
   *  newest first within each group. */
  history: {
    /** `key` is `${connectionId}:${schema}:${table}` for a table, or
     *  `${connectionId}:__query__` for statements run in the console. */
    list: (key: string) => Promise<QueryHistoryEntry[]>
    /** Record statements. Re-running one moves the existing entry up instead of
     *  duplicating it. */
    add: (key: string, entries: QueryHistoryInput[]) => Promise<QueryHistoryEntry[]>
    /** Drops the unpinned entries; pinned ones are kept. */
    clear: (key: string) => Promise<void>
    /** Pin/unpin an entry. Unpinning also drops its name. */
    togglePin: (key: string, id: string) => Promise<QueryHistoryEntry[]>
    /** Name a pinned entry. */
    rename: (key: string, id: string, name: string) => Promise<QueryHistoryEntry[]>
  }
  system: {
    /** Host aliases parsed from ~/.ssh/config, for the SSH + devcontainer wizard. */
    listSshHosts: () => Promise<string[]>
    /** `process.platform`, so the renderer can leave room for macOS traffic lights. */
    platform: string
  }
}
