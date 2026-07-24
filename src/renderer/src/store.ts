import { create } from 'zustand'
import type {
  ConnectionState,
  ConnectionStatus,
  ConnectionView,
  QueryResult,
  ScriptOutput
} from '@shared/types'

export interface TableTab {
  kind: 'table'
  id: string // unique tab id
  connectionId: string
  schema: string
  table: string
  title: string
}

export interface QueryTab {
  kind: 'query'
  id: string
  connectionId: string
  title: string
}

/** A frozen result set produced by running a query in the console. */
export interface ResultTab {
  kind: 'result'
  id: string
  connectionId: string
  title: string
  sql: string
  result: QueryResult
}

export type Tab = TableTab | QueryTab | ResultTab

interface AppState {
  connections: ConnectionView[]
  statuses: Record<string, ConnectionStatus>
  scriptLogs: Record<string, ScriptOutput[]>
  tabs: Tab[]
  activeTabId: string | null
  consoleConnectionId: string | null // which connection's script console is shown

  refreshConnections: () => Promise<void>
  setStatus: (status: ConnectionStatus) => void
  appendLog: (out: ScriptOutput) => void
  stateOf: (id: string) => ConnectionState

  openTab: (tab: Tab) => void
  closeTab: (tabId: string) => void
  setActiveTab: (tabId: string) => void
  showConsole: (connectionId: string | null) => void
}

export const useStore = create<AppState>((set, get) => ({
  connections: [],
  statuses: {},
  scriptLogs: {},
  tabs: [],
  activeTabId: null,
  consoleConnectionId: null,

  refreshConnections: async () => {
    const connections = await window.api.connections.list()
    set({ connections })
  },

  setStatus: (status) => set((s) => ({ statuses: { ...s.statuses, [status.id]: status } })),

  appendLog: (out) =>
    set((s) => {
      const prev = s.scriptLogs[out.id] ?? []
      const next = [...prev, out].slice(-1000) // cap buffer
      return { scriptLogs: { ...s.scriptLogs, [out.id]: next } }
    }),

  stateOf: (id) => get().statuses[id]?.state ?? 'disconnected',

  openTab: (tab) =>
    set((s) => {
      const existing = s.tabs.find(
        (t) =>
          t.kind === tab.kind &&
          t.connectionId === tab.connectionId &&
          (t.kind === 'table' && tab.kind === 'table'
            ? t.schema === tab.schema && t.table === tab.table
            : t.id === tab.id)
      )
      if (existing) return { activeTabId: existing.id }
      return { tabs: [...s.tabs, tab], activeTabId: tab.id }
    }),

  closeTab: (tabId) =>
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== tabId)
      const activeTabId =
        s.activeTabId === tabId ? (tabs.length ? tabs[tabs.length - 1].id : null) : s.activeTabId
      return { tabs, activeTabId }
    }),

  setActiveTab: (tabId) => set({ activeTabId: tabId }),
  showConsole: (connectionId) => set({ consoleConnectionId: connectionId })
}))
