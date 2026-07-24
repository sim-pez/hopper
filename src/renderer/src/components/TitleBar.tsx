import { useStore } from '../store'

/** Renderer-drawn title bar (the native one is hidden). Doubles as the window
 *  drag region. */
export function TitleBar(): JSX.Element {
  const { workspaces, activeWorkspaceId } = useStore()
  const active = workspaces.find((w) => w.id === activeWorkspaceId) ?? null

  return (
    <header className={`titlebar ${window.api.system.platform === 'darwin' ? 'mac' : ''}`}>
      <span className="titlebar-title">{active ? active.name : 'DB Manager'}</span>
    </header>
  )
}
