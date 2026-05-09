import React from 'react'
import ReactDOM from 'react-dom/client'
// Use a clean App implementation while the original file is corrupted
import App from './App'
import './index.css'
import './xp-theme.css'

class ErrorBoundary extends React.Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  isRecoverableRemoveChildError(error) {
    if (!error) return false
    const message = String(error.message || error)
    return message.includes("Failed to execute 'removeChild' on 'Node'") ||
      message.includes('The node to be removed is not a child of this node')
  }
  componentDidCatch(error, info) {
    console.error('React ErrorBoundary caught:', error, info)

    if (this.isRecoverableRemoveChildError(error)) {
      try {
        const key = '__remove_child_recovery_once__'
        const recovered = sessionStorage.getItem(key)
        if (!recovered) {
          sessionStorage.setItem(key, '1')
          setTimeout(() => window.location.reload(), 0)
        }
      } catch (_) {}
    }
  }
  render() {
    if (this.state.error) {
      const recoverable = this.isRecoverableRemoveChildError(this.state.error)
      return (
        <div style={{ padding: '2rem', fontFamily: 'monospace' }}>
          <h2 style={{ color: 'red' }}>Something went wrong</h2>
          {recoverable && (
            <p style={{ color: '#444', marginBottom: '1rem' }}>
              A transient DOM conflict was detected. Please refresh this page.
            </p>
          )}
          <pre style={{ color: '#c00', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: '1rem', padding: '0.6rem 1rem', cursor: 'pointer' }}
          >
            Refresh page
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
