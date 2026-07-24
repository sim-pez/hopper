import { useStore } from '../store'

export function TabBar(): JSX.Element {
  const { tabs, activeTabId, setActiveTab, closeTab } = useStore()

  if (tabs.length === 0) return <div className="tabbar empty" />

  return (
    <div className="tabbar">
      {tabs.map((t) => (
        <div
          key={t.id}
          className={`tab ${t.id === activeTabId ? 'active' : ''}`}
          onClick={() => setActiveTab(t.id)}
        >
          <span className="tab-icon">{t.kind === 'table' ? '▤' : '⚡'}</span>
          <span className="tab-title">{t.title}</span>
          <button
            className="tab-close"
            onClick={(e) => {
              e.stopPropagation()
              closeTab(t.id)
            }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
