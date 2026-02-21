import React, { useState } from 'react';
import { User, AvailabilityStatus } from '../../shared/types';

interface Props {
  onLogin: (user: User) => void;
}

export default function LoginView({ onLogin }: Props) {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !username.trim()) return;

    const user: User = {
      id: crypto.randomUUID(),
      name: name.trim(),
      username: username.trim().toLowerCase().replace(/\s+/g, ''),
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
          onChange={(e) => setUsername(e.target.value)}
        />

        <button
          className="btn btn-primary"
          type="submit"
          disabled={!name.trim() || !username.trim()}
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
