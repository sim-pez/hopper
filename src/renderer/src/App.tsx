import { useEffect, useState } from 'react'
import { useStore } from './store'
import { Sidebar } from './components/Sidebar'
import { ConnectionForm } from './components/ConnectionForm'
import { TabBar } from './components/TabBar'
import { TableTabView } from './components/TableTabView'
import { QueryTabView } from './components/QueryTabView'
import { ResultTabView } from './components/ResultTabView'
import { ScriptConsole } from './components/ScriptConsole'
import type { ConnectionView } from '@shared/types'

export function App(): JSX.Element {
  const { refreshConnections, setStatus, appendLog, tabs, activeTabId, consoleConnectionId } = useStore()
  const [editing, setEditing] = useState<ConnectionView | null | 'new'>(null)

  useEffect(() => {
    refreshConnections()
    const offOut = window.api.scripts.onOutput(appendLog)
    const offStatus = window.api.scripts.onStatus(setStatus)
    return () => {
      offOut()
      offStatus()
    }
  }, [])

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null

  return (
    <div className="app">
      <Sidebar onNew={() => setEditing('new')} onEdit={(c) => setEditing(c)} />
      <main className="main">
        <TabBar />
        <div className="tab-content">
          {activeTab?.kind === 'table' && <TableTabView key={activeTab.id} tab={activeTab} />}
          {activeTab?.kind === 'query' && <QueryTabView key={activeTab.id} tab={activeTab} />}
          {activeTab?.kind === 'result' && <ResultTabView key={activeTab.id} tab={activeTab} />}
          {!activeTab && (
            <div className="empty-state">
              <h2>No tab open</h2>
              <p>Connect to a database in the sidebar, then open a table or start a query to see data here.</p>
            </div>
          )}
        </div>
        {consoleConnectionId && <ScriptConsole connectionId={consoleConnectionId} />}
      </main>
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
    </div>
  )
}
