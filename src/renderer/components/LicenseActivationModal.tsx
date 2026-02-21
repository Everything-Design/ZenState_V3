import React, { useState } from 'react';
import { LicenseState } from '../../shared/types';

interface Props {
  onClose: () => void;
  onActivated: (state: LicenseState) => void;
}

export default function LicenseActivationModal({ onClose, onActivated }: Props) {
  const [keyInput, setKeyInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LicenseState | null>(null);

  async function handleActivate() {
    const trimmed = keyInput.trim();
    if (!trimmed) return;
    setLoading(true);
    try {
      const state = await (window as any).zenstate.activateLicense(trimmed) as LicenseState;
      setResult(state);
      if (state.isValid) {
        onActivated(state);
      }
    } catch (err) {
      setResult({ isValid: false, isPro: false, payload: null, error: 'Failed to activate license' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
    }} onClick={onClose}>
      <div
        className="card"
        style={{
          width: 420,
          maxWidth: '90vw',
          padding: 24,
          background: '#1a1a2e',
          borderRadius: 16,
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          border: '1px solid rgba(255,255,255,0.08)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Activate License</div>
        <div style={{ fontSize: 12, color: 'var(--zen-secondary-text)', marginBottom: 16 }}>
          Paste your ZenState Pro license key below to unlock all features.
        </div>

        <textarea
          className="text-input"
          placeholder="Paste your license key here..."
          value={keyInput}
          onChange={(e) => { setKeyInput(e.target.value); setResult(null); }}
          style={{
            width: '100%',
            minHeight: 80,
            resize: 'vertical',
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            marginBottom: 12,
          }}
          autoFocus
        />

        {/* Result feedback */}
        {result && (
          <div style={{
            padding: '10px 12px',
            borderRadius: 8,
            marginBottom: 12,
            background: result.isValid ? 'rgba(52, 199, 89, 0.1)' : 'rgba(255, 59, 48, 0.1)',
            border: `1px solid ${result.isValid ? 'rgba(52, 199, 89, 0.3)' : 'rgba(255, 59, 48, 0.3)'}`,
          }}>
            {result.isValid && result.payload ? (
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--status-available)', marginBottom: 4 }}>
                  License Activated
                </div>
                <div style={{ fontSize: 11, color: 'var(--zen-secondary-text)' }}>
                  Team: {result.payload.teamName}
                </div>
                <div style={{ fontSize: 11, color: 'var(--zen-secondary-text)' }}>
                  Seats: {result.payload.seats}
                </div>
                <div style={{ fontSize: 11, color: 'var(--zen-secondary-text)' }}>
                  Expires: {result.payload.expiresAt === '9999-12-31' ? 'Lifetime' : new Date(result.payload.expiresAt).toLocaleDateString()}
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: '#FF3B30' }}>
                {result.error || 'Invalid license key'}
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onClose}>
            {result?.isValid ? 'Done' : 'Cancel'}
          </button>
          {!result?.isValid && (
            <button
              className="btn btn-primary"
              onClick={handleActivate}
              disabled={!keyInput.trim() || loading}
            >
              {loading ? 'Validating...' : 'Activate'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
