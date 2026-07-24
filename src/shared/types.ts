// Shared type contract used by the main process, preload bridge, and renderer.

export type DriverKind = 'postgres' | 'mysql'

/** Connection metadata persisted to disk. The password is NOT part of this
 *  object when persisted — it is stored separately, encrypted. */
export interface ConnectionConfig {
  id: string
  name: string
  color?: string
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
  /** Whether `preScript`/`preScriptReadyRegex` are generated from `sshDevcontainer`.
   *  'none' (default) means no pre-connection step runs. */
  preConnectionMode?: 'none' | 'ssh-devcontainer'
  /** Structured config for the SSH + devcontainer pre-connection wizard. Only meaningful
   *  when `preConnectionMode === 'ssh-devcontainer'`. */
  sshDevcontainer?: SshDevcontainerConfig
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

/** Draft used when creating/updating a connection from the UI. */
export interface ConnectionInput extends Omit<ConnectionConfig, 'id' | 'createdAt' | 'updatedAt'> {
  id?: string
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
export interface ConnectionExport extends Omit<ConnectionConfig, 'id' | 'createdAt' | 'updatedAt'> {
  password?: string
}

export type ConnectionState = 'disconnected' | 'starting-script' | 'connecting' | 'connected' | 'error'

export interface ConnectionStatus {
  id: string
  state: ConnectionState
  error?: string
  scriptRunning: boolean
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
}

export interface TableRef {
  schema: string
  table: string
  type: string
}

/** A single `LIKE` filter on one column. Multiple filters are combined with OR. */
export interface ColumnFilter {
  column: string
  /** Substring to match; wrapped as `%value%` and matched case-insensitively. */
  value: string
}

export interface TableDataOptions {
  limit: number
  offset: number
  orderBy?: { column: string; desc: boolean }
  /** Per-column LIKE filters, OR-combined. */
  filters?: ColumnFilter[]
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

/** One SQL statement previously run against a table, for the history panel. */
export interface QueryHistoryEntry {
  sql: string
  ts: number
}

/** A named SQL query saved for reuse against a specific connection. */
export interface SavedQuery {
  id: string
  connectionId: string
  name: string
  sql: string
  pinned: boolean
  createdAt: number
  updatedAt: number
}

export interface SavedQueryInput {
  id?: string
  connectionId: string
  name: string
  sql: string
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
  connections: {
    list: () => Promise<ConnectionView[]>
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
    getTableData: (id: string, schema: string, table: string, opts: TableDataOptions) => Promise<TableData>
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
  /** Per-table query history (capped to the last 100 entries per table). */
  history: {
    /** `key` is `${connectionId}:${schema}:${table}`. Newest first. */
    list: (key: string) => Promise<QueryHistoryEntry[]>
    /** Append statements; returns the updated (capped) list, newest first. */
    add: (key: string, entries: QueryHistoryEntry[]) => Promise<QueryHistoryEntry[]>
    clear: (key: string) => Promise<void>
  }
  system: {
    /** Host aliases parsed from ~/.ssh/config, for the SSH + devcontainer wizard. */
    listSshHosts: () => Promise<string[]>
  }
  /** Named queries saved per-connection, optionally pinned. */
  savedQueries: {
    list: (connectionId: string) => Promise<SavedQuery[]>
    save: (input: SavedQueryInput) => Promise<SavedQuery>
    delete: (id: string) => Promise<void>
    togglePin: (id: string) => Promise<SavedQuery>
  }
}
