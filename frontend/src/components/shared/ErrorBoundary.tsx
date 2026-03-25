import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: 'var(--bg, #0d1117)',
        color: 'var(--text, #e6edf3)',
        fontFamily: "'IBM Plex Mono', monospace",
        gap: '1rem',
        padding: '2rem',
      }}>
        <div style={{ fontSize: '2rem' }}>⚠</div>
        <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>Something went wrong</div>
        <pre style={{
          background: 'var(--surface, #161b22)',
          border: '1px solid var(--border, #21262d)',
          borderRadius: 6,
          padding: '1rem',
          maxWidth: 640,
          width: '100%',
          fontSize: '0.75rem',
          color: '#f85149',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}>
          {error.message}
        </pre>
        <button
          onClick={() => this.setState({ error: null })}
          style={{
            background: 'var(--surface, #161b22)',
            border: '1px solid var(--border, #21262d)',
            color: 'var(--text, #e6edf3)',
            borderRadius: 6,
            padding: '0.5rem 1.25rem',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: '0.85rem',
          }}
        >
          Try again
        </button>
      </div>
    );
  }
}
