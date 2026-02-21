import React from 'react';

/** Inline "PRO" badge shown next to feature labels */
export function ProBadge() {
  return (
    <span style={{
      fontSize: 9,
      fontWeight: 700,
      padding: '1px 5px',
      borderRadius: 4,
      background: 'linear-gradient(135deg, #AF52DE, #5856D6)',
      color: 'white',
      letterSpacing: 0.5,
      marginLeft: 6,
      verticalAlign: 'middle',
      flexShrink: 0,
    }}>
      PRO
    </span>
  );
}

/** Wraps a feature section: if not Pro, overlays a lock message */
export function ProGate({ isPro, children, label }: { isPro: boolean; children: React.ReactNode; label?: string }) {
  if (isPro) return <>{children}</>;
  return (
    <div style={{ position: 'relative', opacity: 0.5, pointerEvents: 'none', userSelect: 'none' }}>
      {children}
      <div style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.03)',
        borderRadius: 8,
      }}>
        {label && (
          <span style={{
            fontSize: 10,
            color: 'var(--zen-secondary-text)',
            background: 'var(--zen-bg)',
            padding: '2px 8px',
            borderRadius: 6,
            border: '1px solid var(--zen-divider)',
          }}>
            <ProBadge /> {label}
          </span>
        )}
      </div>
    </div>
  );
}
