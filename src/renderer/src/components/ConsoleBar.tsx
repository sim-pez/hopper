import { useStore } from '../store'
import { ChevronUp, Terminal } from '../icons'

/**
 * Slim strip shown in place of the hidden query console. Without it, hiding the
 * console (its `▾` button) left no way to bring it back except reconnecting.
 * Targets the console that was last open, falling back to any connected
 * connection; renders nothing when there is none.
 */
export function ConsoleBar(): JSX.Element | null {
  const { connections, statuses, lastConsoleConnectionId, showConsole } = useStore()

  const isConnected = (id: string) => statuses[id]?.state === 'connected'
  const target =
    (lastConsoleConnectionId && isConnected(lastConsoleConnectionId) ? lastConsoleConnectionId : null) ??
    connections.find((c) => isConnected(c.id))?.id

  if (!target) return null
  const name = connections.find((c) => c.id === target)?.name ?? target

  return (
    <button className="console-bar" onClick={() => showConsole(target)} title="Show query console">
      <Terminal size={13} />
      <span className="console-bar-label">Query console · {name}</span>
      <span className="spacer" />
      <ChevronUp size={14} />
    </button>
  )
}
