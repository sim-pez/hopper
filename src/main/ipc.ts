import { BrowserWindow, ipcMain } from 'electron'
import type {
  ApplyChangesPayload,
  ConnectionConfig,
  ConnectionInput,
  DeleteRowPayload,
  InsertRowPayload,
  QueryHistoryEntry,
  ScriptOutput,
  TableDataOptions,
  TestResult,
  UpdateCellPayload
} from '@shared/types'
import {
  deleteConnection,
  duplicateConnection,
  getConnection,
  listConnections,
  saveConnection
} from './store/connectionStore'
import { getPassword } from './store/secrets'
import { preScriptRunner } from './process/preScriptRunner'
import { connect, disconnect, getDriver, getStatus, onStatusChange } from './db/pool'
import { PostgresDriver } from './db/postgres'
import { MysqlDriver } from './db/mysql'
import { addHistory, clearHistory, listHistory } from './store/historyStore'
import { listSshHosts } from './ssh/sshConfig'
import { resolvePreConnection } from './ssh/resolvePreConnection'

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

export function registerIpc(): void {
  // Forward script output and status changes to all renderer windows.
  preScriptRunner.on('output', (out: ScriptOutput) => broadcast('script:output', out))
  onStatusChange((status) => broadcast('script:status', status))

  // --- Connections CRUD ---
  ipcMain.handle('connections:list', () => listConnections())
  ipcMain.handle('connections:save', (_e, input: ConnectionInput) => saveConnection(input))
  ipcMain.handle('connections:delete', (_e, id: string) => deleteConnection(id))
  ipcMain.handle('connections:duplicate', (_e, id: string) => duplicateConnection(id))

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

  // --- Data ---
  ipcMain.handle('db:getTableData', (_e, id: string, schema: string, table: string, opts: TableDataOptions) =>
    getDriver(id).getTableData(schema, table, opts)
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

  // --- Query history ---
  ipcMain.handle('history:list', (_e, key: string) => listHistory(key))
  ipcMain.handle('history:add', (_e, key: string, entries: QueryHistoryEntry[]) => addHistory(key, entries))
  ipcMain.handle('history:clear', (_e, key: string) => clearHistory(key))

  // --- System ---
  ipcMain.handle('system:listSshHosts', () => listSshHosts())
}
