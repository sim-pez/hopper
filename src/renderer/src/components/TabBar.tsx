import { useRef, useState } from 'react'
import { useStore } from '../store'
import type { Tab } from '../store'
import { ConfirmDialog } from './ConfirmDialog'
import { Table, X, Zap } from '../icons'

export function TabBar(): JSX.Element {
  const { tabs, activeTabId, setActiveTab, closeTab, dirtyTabs } = useStore()
  const listRef = useRef<HTMLDivElement>(null)
  // A tab with unsaved edits confirms before it closes instead of closing outright.
  const [closing, setClosing] = useState<Tab | null>(null)

  if (tabs.length === 0) return <div className="tabbar empty" />

  const requestClose = (tab: Tab) => {
    if (dirtyTabs[tab.id]) setClosing(tab)
    else closeTab(tab.id)
  }

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
            onAuxClick={(e) => e.button === 1 && requestClose(t)}
          >
            {t.kind === 'table' ? <Table className="tab-icon" size={13} /> : <Zap className="tab-icon" size={13} />}
            <span className="tab-title" title={t.title}>
              {t.title}
            </span>
            {!!dirtyTabs[t.id] && <span className="tab-dirty-dot" title="Unsaved changes" aria-hidden="true" />}
            <span
              className="tab-close"
              role="button"
              tabIndex={-1}
              title="Close tab"
              aria-label={`Close ${t.title}`}
              onClick={(e) => {
                e.stopPropagation()
                requestClose(t)
              }}
            >
              <X size={12} />
            </span>
          </button>
        )
      })}
      {closing && (
        <ConfirmDialog
          title="Unsaved changes"
          message={`"${closing.title}" has unsaved row edits. Close the tab and discard them?`}
          confirmLabel="Discard and close"
          danger
          onCancel={() => setClosing(null)}
          onConfirm={() => {
            closeTab(closing.id)
            setClosing(null)
          }}
        />
      )}
    </div>
  )
}
