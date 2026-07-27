import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { completeAt, EMPTY_VOCABULARY, type Completion, type SqlVocabulary } from '../sql/complete'
import { caretOffset } from '../sql/caret'
import { useResizable } from '../hooks/useResizable'

interface ResizeOptions {
  min: number
  max: number
  initial: number
  /** Which edge carries the drag handle. `'top'` inverts the drag direction. */
  edge?: 'top' | 'bottom'
}

interface Props {
  value: string
  onChange: (v: string) => void
  onRun: () => void
  /** Schemas, tables, columns and keywords the completer draws on. */
  vocab?: SqlVocabulary
  placeholder?: string
  className?: string
  /** Give the editor a drag handle so its height can be changed. */
  resize?: ResizeOptions
}

/** Popup height budget used to decide whether it opens below or above the caret. */
const POPUP_MAX_H = 190

interface Anchor {
  left: number
  /** Viewport y of the popup's top edge, or of its bottom edge when flipped up. */
  y: number
  flip: boolean
}

/**
 * Textarea with a context-aware SQL autocomplete popup anchored to the caret.
 *
 * The popup only ever opens from a single typed character (or ⌃Space) — never
 * from a paste, a click, a caret move or a programmatic value change, all of
 * which close it. Suggestions come from `sql/complete.ts`.
 */
export function SqlEditor({
  value,
  onChange,
  onRun,
  vocab = EMPTY_VOCABULARY,
  placeholder,
  className,
  resize
}: Props): JSX.Element {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const [completion, setCompletion] = useState<Completion | null>(null)
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const [active, setActive] = useState(0)
  const caretRef = useRef<number | null>(null)
  const open = completion !== null && anchor !== null

  const [height, resizeHandle] = useResizable({
    axis: 'y',
    min: resize?.min ?? 0,
    max: resize?.max ?? 0,
    initial: resize?.initial ?? 0,
    invert: resize?.edge === 'top'
  })

  // Restore the caret after we programmatically rewrite the value on accept.
  useLayoutEffect(() => {
    if (caretRef.current != null && taRef.current) {
      taRef.current.selectionStart = taRef.current.selectionEnd = caretRef.current
      caretRef.current = null
    }
  })

  const close = (): void => {
    setCompletion(null)
    setAnchor(null)
  }

  // Anything happening outside the editor dismisses the popup.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!(e.target instanceof Node) || !taRef.current?.contains(e.target)) close()
    }
    document.addEventListener('mousedown', onDown, true)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
    }
  }, [open])

  const refresh = (text: string, caret: number, explicit = false): void => {
    const ta = taRef.current
    if (!ta) return
    const next = completeAt(text, caret, vocab, explicit)
    if (!next) {
      close()
      return
    }
    const rect = ta.getBoundingClientRect()
    const { left, top, lineHeight } = caretOffset(ta, caret)
    const lineTop = rect.top + top
    const flip = lineTop + lineHeight + POPUP_MAX_H > window.innerHeight
    setAnchor({
      left: Math.max(8, Math.min(rect.left + left, window.innerWidth - 240)),
      y: flip ? window.innerHeight - lineTop + 4 : lineTop + lineHeight + 4,
      flip
    })
    setCompletion(next)
    setActive(0)
  }

  const onInput = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const text = e.target.value
    onChange(text)
    const type = (e.nativeEvent as InputEvent).inputType
    const data = (e.nativeEvent as InputEvent).data
    // A single typed character opens (or narrows) the popup. A paste, a drop,
    // an undo or a multi-character insert never does — that is where the old
    // editor suggested nonsense against the tail of pasted SQL.
    const typed = type === 'insertText' && data != null && data.length === 1 && data !== '\n'
    const narrowing = open && (type === 'deleteContentBackward' || type === 'deleteContentForward')
    if (typed || narrowing) refresh(text, e.target.selectionStart)
    else close()
  }

  const accept = (index: number): void => {
    const ta = taRef.current
    if (!ta || !completion) return
    const { start, items } = completion
    const suggestion = items[index]
    if (!suggestion) return
    const caret = ta.selectionStart
    const next = value.slice(0, start) + suggestion.text + value.slice(caret)
    caretRef.current = start + suggestion.text.length
    onChange(next)
    close()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      close()
      onRun()
      return
    }
    // Explicit trigger, the escape hatch when the popup stays closed.
    if (e.ctrlKey && e.key === ' ') {
      e.preventDefault()
      const ta = taRef.current
      if (ta) refresh(ta.value, ta.selectionStart, true)
      return
    }
    if (!open) return
    const count = completion.items.length
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => (a + 1) % count)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (a - 1 + count) % count)
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      accept(active)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
      // The caret is leaving the word being completed.
      close()
    }
  }

  return (
    <div
      className={`sql-editor-wrap${resize ? ' is-resizable' : ''}`}
      style={resize ? { height } : undefined}
    >
      {resize?.edge === 'top' && (
        <div
          className="resize-handle-y"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize editor"
          {...resizeHandle}
        />
      )}
      <textarea
        ref={taRef}
        className={className}
        value={value}
        spellCheck={false}
        placeholder={placeholder}
        onChange={onInput}
        onKeyDown={onKeyDown}
        onMouseDown={close}
        onScroll={close}
        onBlur={close}
      />
      {resize && resize.edge !== 'top' && (
        <div
          className="resize-handle-y"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize editor"
          {...resizeHandle}
        />
      )}
      {open && (
        <ul
          className="autocomplete"
          style={anchor.flip ? { left: anchor.left, bottom: anchor.y } : { left: anchor.left, top: anchor.y }}
        >
          {completion.items.map((item, i) => (
            <li
              key={`${item.kind}:${item.text}`}
              className={i === active ? 'active' : ''}
              onMouseDown={(e) => {
                e.preventDefault()
                accept(i)
              }}
            >
              <span className={`ac-kind ${item.kind}`} aria-hidden>
                {item.kind[0].toUpperCase()}
              </span>
              <span className="ac-text">{item.text}</span>
              {item.detail && <span className="ac-detail">{item.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
