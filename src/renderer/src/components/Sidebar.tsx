import { useState } from 'react'
import type { ConnectionView } from '@shared/types'
import { useStore } from '../store'
import { SchemaTree } from './SchemaTree'

interface Props {
  onNew: () => void
  onEdit: (c: ConnectionView) => void
}

export function Sidebar({ onNew, onEdit }: Props): JSX.Element {
  const { connections, statuses, refreshConnections, setStatus, showConsole, stateOf, clearLog } =
    useStore()
  const [busy, setBusy] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const connect = async (id: string) => {
    setBusy(id)
    clearLog(id)
    showConsole(id)
    try {
      const status = await window.api.db.connect(id)
      setStatus(status)
      if (status.state === 'connected') setExpanded(id)
    } finally {
      setBusy(null)
    }
  }

  const disconnect = async (id: string) => {
    setBusy(id)
    try {
      setStatus(await window.api.db.disconnect(id))
      if (expanded === id) setExpanded(null)
    } finally {
      setBusy(null)
    }
  }

  const remove = async (c: ConnectionView) => {
    if (!confirm(`Delete connection "${c.name}"?`)) return
    if (stateOf(c.id) === 'connected') await window.api.db.disconnect(c.id)
    await window.api.connections.delete(c.id)
    refreshConnections()
  }

  const duplicate = async (id: string) => {
    await window.api.connections.duplicate(id)
    refreshConnections()
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span>Connections</span>
        <button className="btn-icon" title="New connection" onClick={onNew}>
          +
        </button>
      </div>
      <div className="conn-list">
        {connections.length === 0 && <div className="hint">No connections yet. Click + to add one.</div>}
        {connections.map((c) => {
          const state = statuses[c.id]?.state ?? 'disconnected'
          const connected = state === 'connected'
          const isOpen = expanded === c.id
          return (
            <div key={c.id} className={`conn-item ${connected ? 'connected' : ''}`}>
              <div className="conn-row">
                <span className="conn-dot" style={{ background: c.color || '#6c7086' }} />
                <button
                  className="conn-name"
                  onClick={() => connected && setExpanded(isOpen ? null : c.id)}
                  title={`${c.driver} · ${c.user}@${c.host}:${c.port}/${c.database}`}
                >
                  {connected && <span className="tri">{isOpen ? '▾' : '▸'}</span>}
                  {c.name}
                  {c.readOnly && <span className="ro-badge">RO</span>}
                </button>
                <span className={`state-dot state-${state}`} title={`Status: ${state}`} />
              </div>
              <div className="conn-actions">
                {connected ? (
                  <button className="mini" onClick={() => disconnect(c.id)} disabled={busy === c.id}>
                    Disconnect
                  </button>
                ) : (
                  <button className="mini primary" onClick={() => connect(c.id)} disabled={busy === c.id}>
                    {busy === c.id ? 'Connecting…' : 'Connect'}
                  </button>
                )}
                <button className="mini" title="Query console & script log" onClick={() => showConsole(c.id)}>
                  Console
                </button>
                <span className="spacer" />
                <div className="icon-group">
                  <button className="icon-btn-sm" title="Edit connection" onClick={() => onEdit(c)}>
                    ✎
                  </button>
                  <button className="icon-btn-sm" title="Duplicate connection" onClick={() => duplicate(c.id)}>
                    ⧉
                  </button>
                  <button className="icon-btn-sm danger" title="Delete connection" onClick={() => remove(c)}>
                    ✕
                  </button>
                </div>
              </div>
              {statuses[c.id]?.error && <div className="conn-error">{statuses[c.id]?.error}</div>}
              {connected && isOpen && <SchemaTree connectionId={c.id} connectionName={c.name} />}
            </div>
          )
        })}
      </div>
    </aside>
  )
}
