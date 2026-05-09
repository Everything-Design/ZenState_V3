import React, { useState } from 'react';
import { User, AvailabilityStatus } from '../../shared/types';

interface Props {
  onLogin: (user: User) => void;
}

// Lowercase letters, numbers, dot, underscore, dash. 2–32 chars. Keeps the
// space readable in the team list and lets people pair name@team identifiers
// later without a parser fight.
const USERNAME_RE = /^[a-z0-9._-]{2,32}$/;

export default function LoginView({ onLogin }: Props) {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Normalise on the fly so the user sees what will actually be saved.
  const normalisedUsername = username.trim().toLowerCase().replace(/\s+/g, '');
  const usernameValid = USERNAME_RE.test(normalisedUsername);
  const nameValid = name.trim().length >= 2;
  const canSubmit = nameValid && usernameValid;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!nameValid) {
      setError('Please enter your name.');
      return;
    }
    if (!usernameValid) {
      setError('Username must be 2–32 chars: letters, numbers, dot, underscore, or dash.');
      return;
    }
    setError(null);

    const user: User = {
      id: crypto.randomUUID(),
      name: name.trim(),
      username: normalisedUsername,
      status: AvailabilityStatus.Available,
      lastSeen: new Date().toISOString(),
      totalFocusTime: 0,
      focusSessionCount: 0,
      isAdmin: false,
      canSendEmergency: false,
      avatarEmoji: '😊',
      avatarColor: '#007AFF',
    };

    onLogin(user);
  }

  return (
    <div className="popover">
      <form className="login-view" onSubmit={handleSubmit}>
        <img src="./icon.png" alt="ZenState" style={{ width: 56, height: 56, borderRadius: 12, marginBottom: 8 }} />
        <div className="login-title">Welcome to ZenState</div>
        <div className="login-subtitle">
          Team presence & availability.<br />
          Know when your teammates are free, focused, or busy.
        </div>

        <input
          className="text-input"
          type="text"
          placeholder="Your Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />

        <input
          className="text-input"
          type="text"
          placeholder="Username"
          value={username}
          onChange={(e) => { setUsername(e.target.value); setError(null); }}
        />
        {/* Live hint when the entered username won't be accepted. */}
        {username.length > 0 && !usernameValid && (
          <div style={{ fontSize: 10, color: 'var(--status-focused)', marginTop: -4 }}>
            Letters, numbers, dot, underscore, dash. 2–32 chars.
          </div>
        )}
        {error && (
          <div style={{ fontSize: 11, color: 'var(--status-focused)', marginTop: 4 }}>{error}</div>
        )}

        <button
          className="btn btn-primary"
          type="submit"
          disabled={!canSubmit}
          style={{ width: '100%', padding: '10px' }}
        >
          Get Started
        </button>

        <div style={{ fontSize: 10, color: 'var(--zen-tertiary-text)', textAlign: 'center', marginTop: 8 }}>
          Your data stays on your device.<br />
          No account, no cloud, no tracking.
        </div>
      </form>
    </div>
  );
}
