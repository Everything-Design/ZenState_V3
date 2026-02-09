import React, { useState, useEffect } from 'react';
import { User } from '../../shared/types';

const EMOJI_OPTIONS = ['😊', '😎', '🚀', '🎯', '🔥', '💡', '🎨', '🎵', '🌟', '⚡', '🦊', '🐱', '🌈', '🍀', '🎮', '🏀', '📚', '🧠', '💻', '☕'];
const COLOR_OPTIONS = ['#007AFF', '#34C759', '#FF9500', '#FF3B30', '#5856D6', '#AF52DE', '#FF2D55', '#8E8E93'];

interface Props {
  currentUser: User;
  peers: User[];
  onUserUpdate: (updates: Partial<User>) => void;
  onSignOut: () => void;
  onBack: () => void;
}

export default function SettingsView({ currentUser, peers, onUserUpdate, onSignOut, onBack }: Props) {
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(currentUser.name);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [launchAtLogin, setLaunchAtLogin] = useState(false);

  // Check launch at login status
  useEffect(() => {
    window.zenstate.getLoginItemSettings?.().then((enabled: boolean) => {
      setLaunchAtLogin(enabled);
    }).catch(() => {});
  }, []);

  const isAdmin = currentUser.username.toLowerCase() === 'saurabh';

  function handleEmojiChange(emoji: string) {
    onUserUpdate({ avatarEmoji: emoji });
  }

  function handleColorChange(color: string) {
    onUserUpdate({ avatarColor: color });
  }

  function handleNameSave() {
    if (nameInput.trim() && nameInput.trim() !== currentUser.name) {
      onUserUpdate({ name: nameInput.trim() });
    }
    setEditingName(false);
  }

  function handleToggleLaunchAtLogin() {
    const newValue = !launchAtLogin;
    setLaunchAtLogin(newValue);
    window.zenstate.setLoginItemSettings?.(newValue);
  }

  function handleToggleEmergencyAccess(peerId: string, currentValue: boolean) {
    window.zenstate.grantEmergencyAccess(peerId, !currentValue);
  }

  return (
    <div className="popover fade-in">
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, height: '100%', overflow: 'auto' }}>
        {/* Header */}
        <div className="hstack" style={{ gap: 8 }}>
          <button className="footer-btn" onClick={onBack}>
            ‹ Back
          </button>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Settings</span>
        </div>

        {/* Profile Section */}
        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--zen-tertiary-text)', textTransform: 'uppercase', letterSpacing: 1 }}>
          Profile
        </div>

        {/* Avatar Preview */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            background: currentUser.avatarColor || '#007AFF',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 24,
          }}>
            {currentUser.avatarEmoji || '😊'}
          </div>
          <div>
            {editingName ? (
              <div className="hstack" style={{ gap: 4 }}>
                <input
                  className="text-input"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  autoFocus
                  style={{ width: 140, fontSize: 12 }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleNameSave(); }}
                  onBlur={handleNameSave}
                />
              </div>
            ) : (
              <div
                style={{ fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                onClick={() => { setNameInput(currentUser.name); setEditingName(true); }}
                title="Click to edit"
              >
                {currentUser.name}
              </div>
            )}
            <div style={{ fontSize: 11, color: 'var(--zen-secondary-text)' }}>@{currentUser.username}</div>
          </div>
        </div>

        {/* Emoji Picker */}
        <div>
          <div style={{ fontSize: 11, color: 'var(--zen-secondary-text)', marginBottom: 4 }}>Avatar Emoji</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {EMOJI_OPTIONS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => handleEmojiChange(emoji)}
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 6,
                  border: currentUser.avatarEmoji === emoji ? '2px solid var(--zen-primary)' : '1px solid var(--zen-divider)',
                  background: currentUser.avatarEmoji === emoji ? 'rgba(0, 122, 255, 0.15)' : 'var(--zen-tertiary-bg)',
                  cursor: 'pointer',
                  fontSize: 14,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>

        {/* Color Picker */}
        <div>
          <div style={{ fontSize: 11, color: 'var(--zen-secondary-text)', marginBottom: 4 }}>Avatar Color</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {COLOR_OPTIONS.map((color) => (
              <button
                key={color}
                onClick={() => handleColorChange(color)}
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: color,
                  border: currentUser.avatarColor === color ? '2px solid white' : '2px solid transparent',
                  cursor: 'pointer',
                  boxShadow: currentUser.avatarColor === color ? '0 0 0 1px var(--zen-primary)' : 'none',
                }}
              />
            ))}
          </div>
        </div>

        <div className="divider" />

        {/* General Section */}
        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--zen-tertiary-text)', textTransform: 'uppercase', letterSpacing: 1 }}>
          General
        </div>

        <div className="hstack" style={{ gap: 8 }}>
          <span style={{ fontSize: 12, flex: 1 }}>Launch at Login</span>
          <button
            onClick={handleToggleLaunchAtLogin}
            style={{
              width: 40,
              height: 22,
              borderRadius: 11,
              border: 'none',
              background: launchAtLogin ? 'var(--zen-primary)' : 'var(--zen-secondary-bg)',
              cursor: 'pointer',
              position: 'relative',
              transition: 'background 0.2s ease',
            }}
          >
            <div style={{
              width: 18,
              height: 18,
              borderRadius: '50%',
              background: 'white',
              position: 'absolute',
              top: 2,
              left: launchAtLogin ? 20 : 2,
              transition: 'left 0.2s ease',
              boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
            }} />
          </button>
        </div>

        {/* Admin Section (only for @saurabh) */}
        {isAdmin && (
          <>
            <div className="divider" />
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--zen-tertiary-text)', textTransform: 'uppercase', letterSpacing: 1 }}>
              Admin
            </div>
            <div style={{ fontSize: 11, color: 'var(--zen-secondary-text)', marginBottom: 4 }}>
              Grant urgent request access to team members in Focus mode
            </div>
            {peers.length === 0 ? (
              <div style={{ fontSize: 11, color: 'var(--zen-tertiary-text)', textAlign: 'center', padding: 8 }}>
                No team members connected
              </div>
            ) : (
              peers.map((peer) => (
                <div key={peer.id} className="hstack" style={{ gap: 8, padding: '4px 0' }}>
                  <div style={{
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    background: peer.avatarColor || '#8E8E93',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                  }}>
                    {peer.avatarEmoji || '👤'}
                  </div>
                  <span style={{ fontSize: 12, flex: 1 }}>{peer.name}</span>
                  <button
                    onClick={() => handleToggleEmergencyAccess(peer.id, peer.canSendEmergency)}
                    style={{
                      width: 40,
                      height: 22,
                      borderRadius: 11,
                      border: 'none',
                      background: peer.canSendEmergency ? '#FF3B30' : 'var(--zen-secondary-bg)',
                      cursor: 'pointer',
                      position: 'relative',
                      transition: 'background 0.2s ease',
                    }}
                  >
                    <div style={{
                      width: 18,
                      height: 18,
                      borderRadius: '50%',
                      background: 'white',
                      position: 'absolute',
                      top: 2,
                      left: peer.canSendEmergency ? 20 : 2,
                      transition: 'left 0.2s ease',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                    }} />
                  </button>
                </div>
              ))
            )}
          </>
        )}

        <div className="divider" />

        {/* Account Section */}
        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--zen-tertiary-text)', textTransform: 'uppercase', letterSpacing: 1 }}>
          Account
        </div>

        <div className="hstack" style={{ gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: 'var(--zen-secondary-text)' }}>
              Total Focus: {Math.floor(currentUser.totalFocusTime / 3600)}h {Math.floor((currentUser.totalFocusTime % 3600) / 60)}m
            </div>
            <div style={{ fontSize: 11, color: 'var(--zen-secondary-text)' }}>
              Sessions: {currentUser.focusSessionCount}
            </div>
          </div>
        </div>

        {showSignOutConfirm ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--status-focused)', flex: 1, display: 'flex', alignItems: 'center' }}>
              Are you sure?
            </span>
            <button className="btn btn-secondary" onClick={() => setShowSignOutConfirm(false)}>
              Cancel
            </button>
            <button className="btn btn-danger" onClick={onSignOut}>
              Sign Out
            </button>
          </div>
        ) : (
          <button
            className="btn btn-danger"
            style={{ width: '100%' }}
            onClick={() => setShowSignOutConfirm(true)}
          >
            Sign Out
          </button>
        )}

        <div style={{ fontSize: 9, color: 'var(--zen-tertiary-text)', textAlign: 'center', marginTop: 4 }}>
          ZenState v3.0 · Electron
        </div>
      </div>
    </div>
  );
}
