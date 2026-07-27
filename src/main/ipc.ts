import { BrowserWindow, ipcMain } from 'electron'
import type {
  ApplyChangesPayload,
  ConnectionConfig,
  ConnectionExport,
  ConnectionInput,
  DeleteRowPayload,
  ExportOptions,
  InsertRowPayload,
  QueryHistoryInput,
  ScriptOutput,
  TableDataOptions,
  TestResult,
  UpdateCellPayload,
  WorkspaceInput
} from '@shared/types'
import {
  assignMissingWorkspaces,
  countConnectionsWithoutWorkspace,
  deleteConnection,
  duplicateConnection,
  getConnection,
  listConnectionIdsInWorkspace,
  listConnections,
  saveConnection
} from './store/connectionStore'
import {
  deleteWorkspace,
  getActiveWorkspaceId,
  initWorkspaces,
  listWorkspaces,
  saveWorkspace,
  setActiveWorkspaceId
} from './store/workspaceStore'
import { getPassword } from './store/secrets'
import { preScriptRunner } from './process/preScriptRunner'
import { cancelQuery, connect, disconnect, getDriver, getStatus, onStatusChange } from './db/pool'
import { PostgresDriver } from './db/postgres'
import { MysqlDriver } from './db/mysql'
import {
  addHistory,
  clearHistory,
  listHistory,
  migrateHistoryKeys,
  renameHistoryEntry,
  toggleHistoryPin
} from './store/historyStore'
import { listSshHosts } from './ssh/sshConfig'
import { resolvePreConnection } from './ssh/resolvePreConnection'

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

/** Migrates stores written by older versions: folds per-table query history into
 *  the per-connection buckets, and back-fills `workspaceId` on connections saved
 *  before workspaces existed, creating a "Default" workspace to hold them. Nothing is created on a fresh install — the
 *  UI asks the user to name their first workspace. Must run before the window loads. */
export async function initStores(): Promise<void> {
  await migrateHistoryKeys()
  let activeId = await initWorkspaces()
  const orphans = await countConnectionsWithoutWorkspace()
  if (orphans === 0) return
  if (!activeId) activeId = (await saveWorkspace({ name: 'Default' })).id
  await assignMissingWorkspaces(activeId)
}

export function registerIpc(): void {
  // Forward script output and status changes to all renderer windows.
  preScriptRunner.on('output', (out: ScriptOutput) => broadcast('script:output', out))
  onStatusChange((status) => broadcast('script:status', status))

  // --- Workspaces ---
  ipcMain.handle('workspaces:list', () => listWorkspaces())
  ipcMain.handle('workspaces:save', (_e, input: WorkspaceInput) => saveWorkspace(input))
  ipcMain.handle('workspaces:getActive', () => getActiveWorkspaceId())
  ipcMain.handle('workspaces:setActive', (_e, id: string) => setActiveWorkspaceId(id))

  // Deleting a workspace takes its connections with it: disconnect each one (so
  // no pre-script keeps running), then drop it along with its stored password.
  ipcMain.handle('workspaces:delete', async (_e, id: string) => {
    const ids = await listConnectionIdsInWorkspace(id)
    const activeId = await deleteWorkspace(id)
    for (const connId of ids) {
      await disconnect(connId).catch(() => {})
      await deleteConnection(connId)
    }
    return activeId
  })

  // --- Connections CRUD ---
  // With no workspace at all there is nothing to show.
  ipcMain.handle('connections:list', async (_e, workspaceId?: string) => {
    const scope = workspaceId ?? (await getActiveWorkspaceId())
    return scope ? listConnections(scope) : []
  })
  ipcMain.handle('connections:save', (_e, input: ConnectionInput) => saveConnection(input))
  ipcMain.handle('connections:delete', (_e, id: string) => deleteConnection(id))
  ipcMain.handle('connections:duplicate', (_e, id: string) => duplicateConnection(id))

  // Deliberate exception to "no passwords in the renderer": the export box shows
  // the whole connection, password included, so a config can be moved elsewhere.
  ipcMain.handle('connections:exportConfig', async (_e, id: string): Promise<ConnectionExport> => {
    const stored = await getConnection(id)
    if (!stored) throw new Error(`Connection ${id} not found`)
    const { id: _id, createdAt: _c, updatedAt: _u, ...settings } = stored
    const password = await getPassword(id)
    return password === undefined ? settings : { ...settings, password }
  })

  ipcMain.handle('connections:test', async (_e, id: string): Promise<TestResult> => {
    const stored = await getConnection(id)
    if (!stored) return { ok: false, message: 'Connection not found' }
    const cfg = await resolvePreConnection(stored)
    const started = Date.now()
    try {
      await preScriptRunner.start(cfg)
      const password = await getPassword(id)
      const driver = cfg.driver === 'mysql' ? new MysqlDriver() : new PostgresDriver()
      await driver.connect(cfg, password)
      await driver.ping()
      await driver.end()
      return { ok: true, latencyMs: Date.now() - started, message: 'Connection OK' }
    } catch (err) {
      return { ok: false, message: (err as Error).message }
    } finally {
      // Only tear down the script if this connection isn't actively connected.
      if (getStatus(id).state !== 'connected') preScriptRunner.stop(id)
    }
  })

  // Test an unsaved draft without persisting it. Runs the pre-script under a
  // throwaway id (so it never collides with a saved connection's lifecycle) and
  // always tears it down afterwards.
  ipcMain.handle('connections:testDraft', async (_e, input: ConnectionInput): Promise<TestResult> => {
    const tempId = `draft:${input.id ?? 'new'}:${Date.now()}`
    const cfg: ConnectionConfig = await resolvePreConnection({
      ...input,
      id: tempId,
      // Irrelevant to a throwaway test run, but ConnectionConfig requires it.
      workspaceId: input.workspaceId ?? '',
      driver: input.driver,
      createdAt: 0,
      updatedAt: 0
    })
    // Blank password on an existing connection means "keep current" — fetch it.
    const password =
      input.password !== undefined && input.password !== ''
        ? input.password
        : input.id
          ? await getPassword(input.id)
          : undefined
    const started = Date.now()
    try {
      await preScriptRunner.start(cfg)
      const driver = cfg.driver === 'mysql' ? new MysqlDriver() : new PostgresDriver()
      try {
        await driver.connect(cfg, password)
        await driver.ping()
      } finally {
        await driver.end().catch(() => {})
      }
      return { ok: true, latencyMs: Date.now() - started, message: 'Connection OK' }
    } catch (err) {
      return { ok: false, message: (err as Error).message }
    } finally {
      preScriptRunner.stop(tempId)
    }
  })

  // --- Connection lifecycle ---
  ipcMain.handle('db:connect', (_e, id: string) => connect(id))
  ipcMain.handle('db:disconnect', (_e, id: string) => disconnect(id))
  ipcMain.handle('db:status', (_e, id: string) => getStatus(id))

  // --- Schema browsing ---
  ipcMain.handle('db:listSchemas', (_e, id: string) => getDriver(id).listSchemas())
  ipcMain.handle('db:listTables', (_e, id: string, schema: string) => getDriver(id).listTables(schema))
  ipcMain.handle('db:getColumns', (_e, id: string, schema: string, table: string) =>
    getDriver(id).getColumns(schema, table)
  )
  ipcMain.handle('db:getStructure', (_e, id: string, schema: string, table: string) =>
    getDriver(id).getStructure(schema, table)
  )

  // --- Data ---
  ipcMain.handle('db:getTableData', (_e, id: string, schema: string, table: string, opts: TableDataOptions) =>
    getDriver(id).getTableData(schema, table, opts)
  )
  ipcMain.handle('db:exportTableData', (_e, id: string, schema: string, table: string, opts: ExportOptions) =>
    getDriver(id).exportTableData(schema, table, opts)
  )
  ipcMain.handle('db:updateCell', (_e, id: string, payload: UpdateCellPayload) =>
    getDriver(id).updateCell(payload)
  )
  ipcMain.handle('db:insertRow', (_e, id: string, payload: InsertRowPayload) =>
    getDriver(id).insertRow(payload)
  )
  ipcMain.handle('db:deleteRow', (_e, id: string, payload: DeleteRowPayload) =>
    getDriver(id).deleteRow(payload)
  )
  ipcMain.handle('db:previewChanges', (_e, id: string, payload: ApplyChangesPayload) =>
    getDriver(id).previewChanges(payload)
  )
  ipcMain.handle('db:applyChanges', (_e, id: string, payload: ApplyChangesPayload) =>
    getDriver(id).applyChanges(payload)
  )
  ipcMain.handle('db:query', (_e, id: string, sql: string) => getDriver(id).query(sql))
  ipcMain.handle('db:cancelQuery', (_e, id: string) => cancelQuery(id))

  // --- Query history ---
  ipcMain.handle('history:list', (_e, key: string) => listHistory(key))
  ipcMain.handle('history:add', (_e, key: string, entries: QueryHistoryInput[]) => addHistory(key, entries))
  ipcMain.handle('history:clear', (_e, key: string) => clearHistory(key))
  ipcMain.handle('history:togglePin', (_e, key: string, id: string) => toggleHistoryPin(key, id))
  ipcMain.handle('history:rename', (_e, key: string, id: string, name: string) =>
    renameHistoryEntry(key, id, name)
  )

  // --- System ---
  ipcMain.handle('system:listSshHosts', () => listSshHosts())
}
