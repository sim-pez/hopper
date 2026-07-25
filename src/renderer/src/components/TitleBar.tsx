import { useStore } from '../store'
import { Database } from '../icons'

/** Renderer-drawn title bar (the native one is hidden). Doubles as the window
 *  drag region. */
export function TitleBar(): JSX.Element {
  const { workspaces, activeWorkspaceId } = useStore()
  const active = workspaces.find((w) => w.id === activeWorkspaceId) ?? null

  return (
    <header className={`titlebar ${window.api.system.platform === 'darwin' ? 'mac' : ''}`}>
      <Database className="titlebar-icon" size={13} />
      <span className="titlebar-title">{active ? active.name : 'DB Manager'}</span>
    </header>
  )
}
