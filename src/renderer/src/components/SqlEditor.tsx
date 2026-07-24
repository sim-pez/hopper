import { useEffect, useLayoutEffect, useRef, useState } from 'react'

interface Props {
  value: string
  onChange: (v: string) => void
  onRun: () => void
  /** Words offered for autocompletion (keywords, schemas, tables, columns). */
  words: string[]
  placeholder?: string
  className?: string
}

const MAX_SUGGESTIONS = 10

/** Textarea with a lightweight prefix-based autocomplete popup. */
export function SqlEditor({ value, onChange, onRun, words, placeholder, className }: Props): JSX.Element {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const [matches, setMatches] = useState<string[]>([])
  const [active, setActive] = useState(0)
  const [open, setOpen] = useState(false)
  const caretRef = useRef<number | null>(null)

  // Restore the caret after we programmatically rewrite the value on accept.
  useLayoutEffect(() => {
    if (caretRef.current != null && taRef.current) {
      taRef.current.selectionStart = taRef.current.selectionEnd = caretRef.current
      caretRef.current = null
    }
  })

  const currentWord = (text: string, caret: number): { word: string; start: number } => {
    const before = text.slice(0, caret)
    const m = before.match(/[A-Za-z0-9_]+$/)
    return m ? { word: m[0], start: caret - m[0].length } : { word: '', start: caret }
  }

  const refresh = (text: string, caret: number) => {
    const { word } = currentWord(text, caret)
    if (word.length < 1) {
      setOpen(false)
      return
    }
    const lower = word.toLowerCase()
    const found = words
      .filter((w) => w.toLowerCase().startsWith(lower) && w.toLowerCase() !== lower)
      .slice(0, MAX_SUGGESTIONS)
    setMatches(found)
    setActive(0)
    setOpen(found.length > 0)
  }

  const accept = (suggestion: string) => {
    const ta = taRef.current
    if (!ta) return
    const caret = ta.selectionStart
    const { start } = currentWord(value, caret)
    const next = value.slice(0, start) + suggestion + value.slice(caret)
    caretRef.current = start + suggestion.length
    onChange(next)
    setOpen(false)
  }

  useEffect(() => {
    // Keep suggestions in sync when the caret word changes via typing.
    const ta = taRef.current
    if (ta && document.activeElement === ta) refresh(value, ta.selectionStart)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      setOpen(false)
      onRun()
      return
    }
    if (!open) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => (a + 1) % matches.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (a - 1 + matches.length) % matches.length)
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      accept(matches[active])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    }
  }

  return (
    <div className="sql-editor-wrap">
      <textarea
        ref={taRef}
        className={className}
        value={value}
        spellCheck={false}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
      />
      {open && (
        <ul className="autocomplete">
          {matches.map((m, i) => (
            <li
              key={m}
              className={i === active ? 'active' : ''}
              onMouseDown={(e) => {
                e.preventDefault()
                accept(m)
              }}
            >
              {m}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
