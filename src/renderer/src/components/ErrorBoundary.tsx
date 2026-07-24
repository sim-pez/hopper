import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
  info: ErrorInfo | null
}

/**
 * Catches render/lifecycle errors anywhere below it so a single component
 * failure shows a readable message instead of unmounting the whole tree
 * (which leaves nothing but the window background — a blank screen).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ info })
    // Keep a copy in the devtools console too.
    console.error('Renderer crashed:', error, info.componentStack)
  }

  render(): ReactNode {
    const { error, info } = this.state
    if (!error) return this.props.children
    return (
      <div className="crash">
        <h2>Something broke in the UI</h2>
        <p className="crash-msg">{error.message}</p>
        <pre className="crash-stack">{error.stack}</pre>
        {info?.componentStack && <pre className="crash-stack dim">{info.componentStack}</pre>}
        <button className="mini primary" onClick={() => this.setState({ error: null, info: null })}>
          Dismiss
        </button>
      </div>
    )
  }
}
