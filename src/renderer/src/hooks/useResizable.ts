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

/** Drag-to-resize a panel. Returns the current size plus the mousedown handler
 *  to attach to a thin drag-handle element. */
export function useResizable({ axis, min, max, initial, invert }: Options): [number, { onMouseDown: (e: React.MouseEvent) => void }] {
  const [size, setSize] = useState(initial)
  const startRef = useRef({ coord: 0, size: 0 })

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    startRef.current = { coord: axis === 'x' ? e.clientX : e.clientY, size }
    document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'

    const onMouseMove = (ev: MouseEvent) => {
      const coord = axis === 'x' ? ev.clientX : ev.clientY
      const delta = (coord - startRef.current.coord) * (invert ? -1 : 1)
      setSize(Math.min(max, Math.max(min, startRef.current.size + delta)))
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

  return [size, { onMouseDown }]
}
