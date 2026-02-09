import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/zenstate.css';

// Error boundary for visible error display
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

// Check if preload bridge is available
if (!window.zenstate) {
  console.error('[ZenState] window.zenstate is not available! Preload script may have failed.');
  const rootEl = document.getElementById('root')!;
  rootEl.innerHTML = '<div style="color:#ff6b6b;padding:20px;font-size:12px;font-family:monospace;background:rgba(0,0,0,0.8);border-radius:12px;margin:8px"><strong>Preload Error:</strong><br/>window.zenstate is not available.<br/>The preload script may have failed to load.</div>';
} else {
  console.log('[ZenState] Preload bridge available, mounting React app...');
  const root = createRoot(document.getElementById('root')!);
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
}
