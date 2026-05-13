import React, { useEffect, useState } from 'react';

export type ToastVariant = 'success' | 'error' | 'warning';

export interface ToastMessage {
  id: string;
  variant: ToastVariant;
  message: string;
  linkLabel?: string;
  linkHref?: string;
}

interface ToastProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

const VARIANT_STYLES: Record<ToastVariant, { background: string; border: string; icon: string }> = {
  success: { background: '#1a3a2a', border: '#34C759', icon: '✓' },
  error:   { background: '#3a1a1a', border: '#FF3B30', icon: '▲' },
  warning: { background: '#3a2e1a', border: '#FF9500', icon: '⚠' },
};

function ToastItem({ toast, onDismiss }: { toast: ToastMessage; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), 4000);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  const s = VARIANT_STYLES[toast.variant];

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '10px 14px',
        borderRadius: 8,
        background: s.background,
        border: `1px solid ${s.border}`,
        boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        maxWidth: 340,
        fontSize: 12,
        color: 'var(--zen-text)',
        lineHeight: 1.5,
      }}
    >
      <span style={{ color: s.border, fontWeight: 700, flexShrink: 0, marginTop: 1 }}>{s.icon}</span>
      <div style={{ flex: 1 }}>
        <span>{toast.message}</span>
        {toast.linkLabel && toast.linkHref && (
          <>
            {' '}
            <a
              href={toast.linkHref}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: s.border, textDecoration: 'underline', whiteSpace: 'nowrap' }}
            >
              {toast.linkLabel}
            </a>
          </>
        )}
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--zen-tertiary-text)',
          cursor: 'pointer',
          fontSize: 14,
          lineHeight: 1,
          padding: 0,
          flexShrink: 0,
        }}
        title="Dismiss"
      >
        ×
      </button>
    </div>
  );
}

export default function Toast({ toasts, onDismiss }: ToastProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: 'none',
      }}
    >
      {toasts.map((toast) => (
        <div key={toast.id} style={{ pointerEvents: 'auto' }}>
          <ToastItem toast={toast} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  );
}

// Hook for easy toast management
let _counter = 0;
export function useToast() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  function addToast(variant: ToastVariant, message: string, linkLabel?: string, linkHref?: string) {
    const id = String(++_counter);
    setToasts((prev) => [...prev, { id, variant, message, linkLabel, linkHref }]);
  }

  function dismiss(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  return { toasts, addToast, dismiss };
}
