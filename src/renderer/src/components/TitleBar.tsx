import { useStore } from '../store'
import { Database } from '../icons'
import { IS_MAC } from '../shortcuts'

/** Renderer-drawn title bar (the native one is hidden). Doubles as the window
 *  drag region. */
export function TitleBar(): JSX.Element {
  const { workspaces, activeWorkspaceId } = useStore()
  const active = workspaces.find((w) => w.id === activeWorkspaceId) ?? null

  return (
    <header className={`titlebar ${IS_MAC ? 'mac' : 'overlay'}`}>
      <Database className="titlebar-icon" size={13} />
      <span className="titlebar-title">{active ? active.name : 'Hopper'}</span>
    </header>
  )
}
