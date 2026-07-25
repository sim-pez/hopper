import { useRef, useState } from 'react'

interface Options {
  axis: 'x' | 'y'
  min: number
  max: number
  initial: number
  /** Flip drag direction — for handles where dragging toward the panel's far
   *  edge should shrink it instead of grow it (e.g. a bottom panel's top-edge handle). */
  invert?: boolean
}

interface HandleProps {
  tabIndex: number
  onMouseDown: (e: React.MouseEvent) => void
  onKeyDown: (e: React.KeyboardEvent) => void
}

const KEY_STEP = 16

/** Drag-to-resize a panel. Returns the current size plus the props to spread
 *  onto a thin drag-handle element. The handle is focusable and also resizes
 *  with the arrow keys, so resizing isn't mouse-only. */
export function useResizable({ axis, min, max, initial, invert }: Options): [number, HandleProps] {
  const [size, setSize] = useState(initial)
  const startRef = useRef({ coord: 0, size: 0 })

  const clamp = (n: number) => Math.min(max, Math.max(min, n))

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    startRef.current = { coord: axis === 'x' ? e.clientX : e.clientY, size }
    document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'

    const onMouseMove = (ev: MouseEvent) => {
      const coord = axis === 'x' ? ev.clientX : ev.clientY
      const delta = (coord - startRef.current.coord) * (invert ? -1 : 1)
      setSize(clamp(startRef.current.size + delta))
    }
    const onMouseUp = () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const grow = axis === 'x' ? 'ArrowRight' : 'ArrowDown'
    const shrink = axis === 'x' ? 'ArrowLeft' : 'ArrowUp'
    if (e.key !== grow && e.key !== shrink) return
    e.preventDefault()
    const dir = (e.key === grow ? 1 : -1) * (invert ? -1 : 1)
    setSize((s) => clamp(s + dir * KEY_STEP))
  }

  return [size, { tabIndex: 0, onMouseDown, onKeyDown }]
}
