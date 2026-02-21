import React from 'react';
import { createRoot } from 'react-dom/client';
import AlertApp from './AlertApp';
import './styles/zenstate.css';

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ color: '#ff6b6b', padding: 20, fontSize: 12, fontFamily: 'monospace', background: 'rgba(0,0,0,0.8)', borderRadius: 12, margin: 8 }}>
          <strong>Error:</strong><br />
          {this.state.error.message}<br /><br />
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 10 }}>{this.state.error.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

const root = createRoot(document.getElementById('root')!);
root.render(
  <ErrorBoundary>
    <AlertApp />
  </ErrorBoundary>
);
