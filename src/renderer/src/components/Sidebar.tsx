import { useState } from 'react'
import type { ConnectionView } from '@shared/types'
import { useStore } from '../store'
import { SchemaTree } from './SchemaTree'
import { WorkspaceBar } from './WorkspaceBar'
import { ConfirmDialog } from './ConfirmDialog'
import { Banner } from './Banner'
import { EmptyState } from './EmptyState'
import { useResizable } from '../hooks/useResizable'
import { ChevronDown, ChevronRight, Copy, Database, Pencil, Plug, PlugOff, Plus, Trash } from '../icons'

interface Props {
  onNew: () => void
  onEdit: (c: ConnectionView) => void
}

export function Sidebar({ onNew, onEdit }: Props): JSX.Element {
  const { connections, statuses, workspaces, refreshConnections, setStatus, showConsole, stateOf, clearLog } =
    useStore()
  const [busy, setBusy] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [removing, setRemoving] = useState<ConnectionView | null>(null)
  // Connecting runs a pre-connection script and disconnecting tears it down, so
  // both go through a confirmation first.
  const [pending, setPending] = useState<{ kind: 'connect' | 'disconnect'; conn: ConnectionView } | null>(
    null
  )
  const [width, resizeHandle] = useResizable({ axis: 'x', min: 240, max: 560, initial: 300 })

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
    setRemoving(null)
    if (stateOf(c.id) === 'connected') await window.api.db.disconnect(c.id)
    await window.api.connections.delete(c.id)
    refreshConnections()
  }

  // SSH + devcontainer and kubectl scripts are generated at connect time, so an
  // empty `preScript` still means there is something to run.
  const hasPreScript = (c: ConnectionView) =>
    c.preConnectionMode === 'ssh-devcontainer' ||
    c.preConnectionMode === 'kubectl' ||
    !!c.preScript?.trim()

  const runPending = () => {
    if (!pending) return
    const { kind, conn } = pending
    setPending(null)
    void (kind === 'connect' ? connect(conn.id) : disconnect(conn.id))
  }

  const duplicate = async (id: string) => {
    await window.api.connections.duplicate(id)
    refreshConnections()
  }

  return (
    <aside className="sidebar" style={{ width }}>
      <div
        className="resize-handle-x"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        {...resizeHandle}
      />
      <WorkspaceBar />
      <div className="sidebar-header">
        <span className="sidebar-title">Connections</span>
        <button
          className="icon-btn"
          title={workspaces.length ? 'New connection' : 'Create a workspace first'}
          aria-label="New connection"
          onClick={onNew}
          disabled={workspaces.length === 0}
        >
          <Plus size={15} />
        </button>
      </div>
      <div className="conn-list">
        {connections.length === 0 && workspaces.length > 0 && (
          <EmptyState
            small
            icon={<Database size={24} />}
            title="No connections"
            hint="Add one to browse its tables and run queries."
            action={
              <button className="mini outline" onClick={onNew}>
                <Plus />
                New connection
              </button>
            }
          />
        )}
        {connections.map((c) => {
          const state = statuses[c.id]?.state ?? 'disconnected'
          const connected = state === 'connected'
          const isOpen = expanded === c.id
          const error = statuses[c.id]?.error
          return (
            <div key={c.id} className={`conn-item ${isOpen ? 'is-open' : ''}`}>
              <div className="conn-row">
                <button
                  className="conn-disclosure"
                  disabled={!connected}
                  aria-expanded={connected ? isOpen : undefined}
                  aria-label={isOpen ? 'Collapse schemas' : 'Expand schemas'}
                  onClick={() => setExpanded(isOpen ? null : c.id)}
                >
                  {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
                <span className={`state-dot state-${state}`} title={`Status: ${state}`} />
                <button
                  className="conn-main"
                  title={connected ? 'Show schemas' : 'Connect'}
                  onClick={() =>
                    connected ? setExpanded(isOpen ? null : c.id) : setPending({ kind: 'connect', conn: c })
                  }
                >
                  <span className="conn-name-row">
                    <span className="conn-name">{c.name}</span>
                    {c.readOnly && <span className="badge ro">RO</span>}
                  </span>
                  <span className="conn-sub">
                    {busy === c.id
                      ? 'Connecting…'
                      : state === 'reconnecting'
                        ? `Reconnecting… (${statuses[c.id]?.reconnectAttempt ?? 1})`
                        : `${c.driver} · ${c.user}@${c.host}:${c.port}/${c.database}`}
                  </span>
                </button>
                <div className="conn-actions">
                  {connected ? (
                    <button
                      className="icon-btn-sm"
                      title="Disconnect"
                      aria-label={`Disconnect ${c.name}`}
                      onClick={() => setPending({ kind: 'disconnect', conn: c })}
                      disabled={busy === c.id}
                    >
                      <PlugOff />
                    </button>
                  ) : (
                    <button
                      className="icon-btn-sm"
                      title="Connect"
                      aria-label={`Connect ${c.name}`}
                      onClick={() => setPending({ kind: 'connect', conn: c })}
                      disabled={busy === c.id}
                    >
                      <Plug />
                    </button>
                  )}
                  <button
                    className="icon-btn-sm"
                    title="Edit connection"
                    aria-label={`Edit ${c.name}`}
                    onClick={() => onEdit(c)}
                  >
                    <Pencil />
                  </button>
                  <button
                    className="icon-btn-sm"
                    title="Duplicate connection"
                    aria-label={`Duplicate ${c.name}`}
                    onClick={() => duplicate(c.id)}
                  >
                    <Copy />
                  </button>
                  <button
                    className="icon-btn-sm danger"
                    title="Delete connection"
                    aria-label={`Delete ${c.name}`}
                    onClick={() => setRemoving(c)}
                  >
                    <Trash />
                  </button>
                </div>
              </div>
              {error && <Banner message={error} />}
              {connected && isOpen && <SchemaTree connectionId={c.id} connectionName={c.name} />}
            </div>
          )
        })}
      </div>
      {pending && (
        <ConfirmDialog
          title={pending.kind === 'connect' ? 'Connect' : 'Disconnect'}
          message={
            pending.kind === 'connect'
              ? `Connect to "${pending.conn.name}"?` +
                (hasPreScript(pending.conn) ? ' Its pre-connection script runs first.' : '')
              : `Disconnect from "${pending.conn.name}"?` +
                (hasPreScript(pending.conn) ? ' Its pre-connection script is stopped too.' : '')
          }
          confirmLabel={pending.kind === 'connect' ? 'Connect' : 'Disconnect'}
          danger={pending.kind === 'disconnect'}
          onCancel={() => setPending(null)}
          onConfirm={runPending}
        />
      )}
      {removing && (
        <ConfirmDialog
          title="Delete connection"
          message={`Delete connection "${removing.name}"?`}
          confirmLabel="Delete"
          onCancel={() => setRemoving(null)}
          onConfirm={() => remove(removing)}
        />
      )}
    </aside>
  )
}
