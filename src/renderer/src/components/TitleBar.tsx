import { useEffect } from 'react'
import { useStore } from '../store'

/** Text/symbol color that stays readable on the workspace swatches (all light pastels). */
const ON_ACCENT = '#11111b'
const NEUTRAL = '#181825'

/** Renderer-drawn title bar (the native one is hidden) tinted with the active
 *  workspace's color. Doubles as the window drag region. */
export function TitleBar(): JSX.Element {
  const { workspaces, activeWorkspaceId } = useStore()
  const active = workspaces.find((w) => w.id === activeWorkspaceId) ?? null
  const color = active?.color || NEUTRAL
  const tinted = color !== NEUTRAL

  // Keep the Windows/Linux window controls in step with the bar.
  useEffect(() => {
    window.api.system.setAccentColor(color, tinted ? ON_ACCENT : '#cad3f5')
  }, [color, tinted])

  return (
    <header
      className={`titlebar ${window.api.system.platform === 'darwin' ? 'mac' : ''}`}
      style={{ background: color, color: tinted ? ON_ACCENT : 'var(--text-dim)' }}
    >
      <span className="titlebar-title">{active ? active.name : 'DB Manager'}</span>
    </header>
  )
}
