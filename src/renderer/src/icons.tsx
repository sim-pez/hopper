import type { ReactNode } from 'react'

/**
 * The app's icon set: hand-inlined SVGs in one consistent 24×24 stroke style.
 * Bundled rather than imported from a CDN — the renderer CSP (`index.html`)
 * blocks every external host.
 *
 * Icons are decorative: they carry `aria-hidden`, so an icon-only button must
 * still supply its own `aria-label`.
 */

export interface IconProps {
  /** Rendered size in px. Defaults to 14 — the size used in toolbars and rows. */
  size?: number
  className?: string
}

function icon(displayName: string, body: ReactNode, filled = false) {
  const Component = ({ size = 14, className }: IconProps): JSX.Element => (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {body}
    </svg>
  )
  Component.displayName = displayName
  return Component
}

export const Plus = icon(
  'Plus',
  <>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </>
)

export const Pencil = icon(
  'Pencil',
  <>
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7.5 18.5 3 20l1.5-4.5Z" />
    <path d="m14.5 5.5 3 3" />
  </>
)

export const Copy = icon(
  'Copy',
  <>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </>
)

export const Trash = icon(
  'Trash',
  <>
    <path d="M3.5 6h17" />
    <path d="M8.5 6V4.5a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2V6" />
    <path d="M18.5 6l-.9 13a2 2 0 0 1-2 1.9H8.4a2 2 0 0 1-2-1.9L5.5 6" />
  </>
)

export const ChevronRight = icon('ChevronRight', <path d="m9 5 7 7-7 7" />)
export const ChevronDown = icon('ChevronDown', <path d="m5 9 7 7 7-7" />)
export const ChevronUp = icon('ChevronUp', <path d="m5 15 7-7 7 7" />)

export const RefreshCw = icon(
  'RefreshCw',
  <>
    <path d="M20.5 11a8.5 8.5 0 0 0-14.6-4.6L2.5 9.5" />
    <path d="M2.5 4.5v5h5" />
    <path d="M3.5 13a8.5 8.5 0 0 0 14.6 4.6l3.4-3.1" />
    <path d="M21.5 19.5v-5h-5" />
  </>
)

export const RotateCcw = icon(
  'RotateCcw',
  <>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L2.5 9.5" />
    <path d="M2.5 4.5v5h5" />
  </>
)

export const Play = icon('Play', <path d="M7 4.8v14.4l12-7.2Z" />, true)
export const Stop = icon('Stop', <rect x="6" y="6" width="12" height="12" rx="2" />, true)

export const Star = icon(
  'Star',
  <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9Z" />
)
export const StarFilled = icon(
  'StarFilled',
  <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9Z" />,
  true
)

export const CornerDownLeft = icon(
  'CornerDownLeft',
  <>
    <path d="M20 4v7a4 4 0 0 1-4 4H4" />
    <path d="m9 20-5-5 5-5" />
  </>
)

export const Table = icon(
  'Table',
  <>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 9.5h18" />
    <path d="M9 9.5V20" />
  </>
)

export const Eye = icon(
  'Eye',
  <>
    <path d="M2.5 12S6.5 5.5 12 5.5 21.5 12 21.5 12 17.5 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="2.75" />
  </>
)

export const Folder = icon(
  'Folder',
  <path d="M3 6.5a1.5 1.5 0 0 1 1.5-1.5h4.2l2 2.2h8.8A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5Z" />
)

export const Database = icon(
  'Database',
  <>
    <ellipse cx="12" cy="5.5" rx="8.5" ry="3" />
    <path d="M3.5 5.5v13c0 1.7 3.8 3 8.5 3s8.5-1.3 8.5-3v-13" />
    <path d="M3.5 12c0 1.7 3.8 3 8.5 3s8.5-1.3 8.5-3" />
  </>
)

export const Search = icon(
  'Search',
  <>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m20 20-4.8-4.8" />
  </>
)

export const Filter = icon('Filter', <path d="M4 5h16l-6.2 7.3v6.2l-3.6 1.8v-8Z" />)

export const Download = icon(
  'Download',
  <>
    <path d="M12 3.5v11" />
    <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
    <path d="M4 20h16" />
  </>
)

export const Terminal = icon(
  'Terminal',
  <>
    <path d="m4 17 6-5.5L4 6" />
    <path d="M12.5 18H20" />
  </>
)

export const X = icon(
  'X',
  <>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </>
)

export const Check = icon('Check', <path d="M20 6.5 9.5 17 4 11.5" />)

export const AlertTriangle = icon(
  'AlertTriangle',
  <>
    <path d="M10.3 4 2.4 17.8A2 2 0 0 0 4.1 20.8h15.8a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9.5v4" />
    <path d="M12 17h.01" />
  </>
)

export const Info = icon(
  'Info',
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 16.5v-5" />
    <path d="M12 8h.01" />
  </>
)

export const CheckCircle = icon(
  'CheckCircle',
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12.2 2.7 2.7L16 9.5" />
  </>
)

export const Clock = icon(
  'Clock',
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5.3l3.3 2" />
  </>
)

export const Plug = icon(
  'Plug',
  <>
    <path d="M12 21.5V17" />
    <path d="M9 7.5V2.5" />
    <path d="M15 7.5V2.5" />
    <path d="M6.5 7.5h11V12a4.5 4.5 0 0 1-4.5 4.5h-2A4.5 4.5 0 0 1 6.5 12Z" />
  </>
)

export const PlugOff = icon(
  'PlugOff',
  <>
    <path d="M12 21.5V17" />
    <path d="M15 7.5V2.5" />
    <path d="M6.5 7.5h11V12a4.5 4.5 0 0 1-2.3 3.9" />
    <path d="M6.5 7.5V12a4.5 4.5 0 0 0 4.5 4.5h1" />
    <path d="m3 3 18 18" />
  </>
)

export const Zap = icon('Zap', <path d="M13.5 2.5 4.5 13.5h6l-.5 8 9-11h-6Z" />)

export const ArrowLeft = icon(
  'ArrowLeft',
  <>
    <path d="M20 12H4.5" />
    <path d="m10 5.5-5.5 6.5L10 18.5" />
  </>
)

export const ArrowRight = icon(
  'ArrowRight',
  <>
    <path d="M4 12h15.5" />
    <path d="m14 5.5 5.5 6.5L14 18.5" />
  </>
)
