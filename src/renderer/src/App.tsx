import { useEffect, useState } from 'react'
import { useStore } from './store'
import { Sidebar } from './components/Sidebar'
import { ConnectionForm } from './components/ConnectionForm'
import { ConfirmDialog } from './components/ConfirmDialog'
import { TabBar } from './components/TabBar'
import { TableTabView } from './components/TableTabView'
import { QueryTabView } from './components/QueryTabView'
import { ResultTabView } from './components/ResultTabView'
import { ScriptConsole } from './components/ScriptConsole'
import { ConsoleBar } from './components/ConsoleBar'
import { TitleBar } from './components/TitleBar'
import { ToastHost } from './components/ToastHost'
import { EmptyState } from './components/EmptyState'
import { Table } from './icons'
import type { ConnectionView } from '@shared/types'

export function App(): JSX.Element {
  const { refreshWorkspaces, refreshConnections, setStatus, appendLog, tabs, activeTabId, consoleConnectionId } =
    useStore()
  const [editing, setEditing] = useState<ConnectionView | null | 'new'>(null)
  const [confirmQuit, setConfirmQuit] = useState(false)

  useEffect(() => {
    refreshWorkspaces()
    refreshConnections()
    const offOut = window.api.scripts.onOutput(appendLog)
    const offStatus = window.api.scripts.onStatus(setStatus)
    // Main asks before it tears anything down, so unsaved row edits get a
    // chance to be kept instead of silently lost on Cmd-Q / window close.
    const offQuit = window.api.app.onConfirmQuit(() => {
      const dirty = Object.keys(useStore.getState().dirtyTabs).length > 0
      if (dirty) setConfirmQuit(true)
      else window.api.app.respondQuit(true)
    })
    return () => {
      offOut()
      offStatus()
      offQuit()
    }
  }, [])

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null

  return (
    <div className="app-shell">
      <TitleBar />
      <div className="app">
        <Sidebar onNew={() => setEditing('new')} onEdit={(c) => setEditing(c)} />
        <main className="main">
          <TabBar />
          <div className="tab-content">
            {activeTab?.kind === 'table' && <TableTabView key={activeTab.id} tab={activeTab} />}
            {activeTab?.kind === 'query' && <QueryTabView key={activeTab.id} tab={activeTab} />}
            {activeTab?.kind === 'result' && <ResultTabView key={activeTab.id} tab={activeTab} />}
            {!activeTab && (
              <EmptyState
                icon={<Table size={30} />}
                title="Nothing open"
                hint="Connect to a database in the sidebar, then pick a table or run a query to see data here."
              />
            )}
          </div>
          {consoleConnectionId ? <ScriptConsole connectionId={consoleConnectionId} /> : <ConsoleBar />}
        </main>
      </div>
      {editing !== null && (
        <ConnectionForm
          connection={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            refreshConnections()
          }}
        />
      )}
      <ToastHost />
      {confirmQuit && (
        <ConfirmDialog
          title="Unsaved changes"
          message="Some tabs have unsaved row edits. Quit and discard them?"
          confirmLabel="Discard and quit"
          onCancel={() => {
            setConfirmQuit(false)
            window.api.app.respondQuit(false)
          }}
          onConfirm={() => {
            setConfirmQuit(false)
            window.api.app.respondQuit(true)
          }}
        />
      )}
    </div>
  )
}
