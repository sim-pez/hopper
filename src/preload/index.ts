import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import type {
  Api,
  ApplyChangesPayload,
  ConnectionInput,
  ConnectionStatus,
  DeleteRowPayload,
  InsertRowPayload,
  SavedQueryInput,
  ScriptOutput,
  TableDataOptions,
  UpdateCellPayload,
  WorkspaceInput
} from '../shared/types'

const api: Api = {
  workspaces: {
    list: () => ipcRenderer.invoke('workspaces:list'),
    save: (input: WorkspaceInput) => ipcRenderer.invoke('workspaces:save', input),
    delete: (id: string) => ipcRenderer.invoke('workspaces:delete', id),
    getActive: () => ipcRenderer.invoke('workspaces:getActive'),
    setActive: (id: string) => ipcRenderer.invoke('workspaces:setActive', id)
  },
  connections: {
    list: (workspaceId?: string) => ipcRenderer.invoke('connections:list', workspaceId),
    move: (id: string, workspaceId: string) => ipcRenderer.invoke('connections:move', id, workspaceId),
    save: (input: ConnectionInput) => ipcRenderer.invoke('connections:save', input),
    delete: (id: string) => ipcRenderer.invoke('connections:delete', id),
    duplicate: (id: string) => ipcRenderer.invoke('connections:duplicate', id),
    test: (id: string) => ipcRenderer.invoke('connections:test', id),
    testDraft: (input: ConnectionInput) => ipcRenderer.invoke('connections:testDraft', input),
    exportConfig: (id: string) => ipcRenderer.invoke('connections:exportConfig', id)
  },
  db: {
    connect: (id: string) => ipcRenderer.invoke('db:connect', id),
    disconnect: (id: string) => ipcRenderer.invoke('db:disconnect', id),
    status: (id: string) => ipcRenderer.invoke('db:status', id),
    listSchemas: (id: string) => ipcRenderer.invoke('db:listSchemas', id),
    listTables: (id: string, schema: string) => ipcRenderer.invoke('db:listTables', id, schema),
    getColumns: (id: string, schema: string, table: string) =>
      ipcRenderer.invoke('db:getColumns', id, schema, table),
    getTableData: (id: string, schema: string, table: string, opts: TableDataOptions) =>
      ipcRenderer.invoke('db:getTableData', id, schema, table, opts),
    updateCell: (id: string, payload: UpdateCellPayload) => ipcRenderer.invoke('db:updateCell', id, payload),
    insertRow: (id: string, payload: InsertRowPayload) => ipcRenderer.invoke('db:insertRow', id, payload),
    deleteRow: (id: string, payload: DeleteRowPayload) => ipcRenderer.invoke('db:deleteRow', id, payload),
    previewChanges: (id: string, payload: ApplyChangesPayload) =>
      ipcRenderer.invoke('db:previewChanges', id, payload),
    applyChanges: (id: string, payload: ApplyChangesPayload) =>
      ipcRenderer.invoke('db:applyChanges', id, payload),
    query: (id: string, sql: string) => ipcRenderer.invoke('db:query', id, sql),
    cancelQuery: (id: string) => ipcRenderer.invoke('db:cancelQuery', id)
  },
  scripts: {
    onOutput: (cb: (out: ScriptOutput) => void) => {
      const handler = (_e: IpcRendererEvent, out: ScriptOutput) => cb(out)
      ipcRenderer.on('script:output', handler)
      return () => ipcRenderer.removeListener('script:output', handler)
    },
    onStatus: (cb: (status: ConnectionStatus) => void) => {
      const handler = (_e: IpcRendererEvent, status: ConnectionStatus) => cb(status)
      ipcRenderer.on('script:status', handler)
      return () => ipcRenderer.removeListener('script:status', handler)
    }
  },
  history: {
    list: (key: string) => ipcRenderer.invoke('history:list', key),
    add: (key: string, entries) => ipcRenderer.invoke('history:add', key, entries),
    clear: (key: string) => ipcRenderer.invoke('history:clear', key)
  },
  system: {
    listSshHosts: () => ipcRenderer.invoke('system:listSshHosts'),
    platform: process.platform,
    setAccentColor: (color: string, symbolColor: string) =>
      ipcRenderer.invoke('window:setAccentColor', color, symbolColor)
  },
  savedQueries: {
    list: (connectionId: string) => ipcRenderer.invoke('queries:list', connectionId),
    save: (input: SavedQueryInput) => ipcRenderer.invoke('queries:save', input),
    delete: (id: string) => ipcRenderer.invoke('queries:delete', id),
    togglePin: (id: string) => ipcRenderer.invoke('queries:togglePin', id)
  }
}

contextBridge.exposeInMainWorld('api', api)
