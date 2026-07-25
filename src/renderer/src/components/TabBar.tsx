import { useRef } from 'react'
import { useStore } from '../store'
import { Table, X, Zap } from '../icons'

export function TabBar(): JSX.Element {
  const { tabs, activeTabId, setActiveTab, closeTab } = useStore()
  const listRef = useRef<HTMLDivElement>(null)

  if (tabs.length === 0) return <div className="tabbar empty" />

  /** Left/Right move between tabs; the moved-to tab is activated and focused. */
  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const next = (index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
    setActiveTab(tabs[next].id)
    listRef.current?.querySelectorAll<HTMLElement>('.tab')[next]?.focus()
  }

  return (
    <div className="tabbar" role="tablist" aria-label="Open tabs" ref={listRef}>
      {tabs.map((t, i) => {
        const active = t.id === activeTabId
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            className={`tab ${active ? 'active' : ''}`}
            onClick={() => setActiveTab(t.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            onAuxClick={(e) => e.button === 1 && closeTab(t.id)}
          >
            {t.kind === 'table' ? <Table className="tab-icon" size={13} /> : <Zap className="tab-icon" size={13} />}
            <span className="tab-title" title={t.title}>
              {t.title}
            </span>
            <span
              className="tab-close"
              role="button"
              tabIndex={-1}
              title="Close tab"
              aria-label={`Close ${t.title}`}
              onClick={(e) => {
                e.stopPropagation()
                closeTab(t.id)
              }}
            >
              <X size={12} />
            </span>
          </button>
        )
      })}
    </div>
  )
}
