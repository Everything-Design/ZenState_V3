import React, { useState, useEffect } from 'react';
import { Settings, Tag, Info, Shield, Wifi } from 'lucide-react';
import { User } from '../../../shared/types';

const COLOR_OPTIONS = ['#007AFF', '#34C759', '#FF9500', '#FF3B30', '#5856D6', '#AF52DE', '#FF2D55', '#8E8E93'];

interface Props {
  currentUser: User;
  peers: User[];
  onUserUpdate: (updates: Partial<User>) => void;
  onSignOut: () => void;
}

type SettingsSection = 'general' | 'categories' | 'network' | 'about' | 'admin';

export default function SettingsTab({ currentUser, peers, onUserUpdate, onSignOut }: Props) {
  const [activeSection, setActiveSection] = useState<SettingsSection>('general');
  const [launchAtLogin, setLaunchAtLogin] = useState(false);
  const [appVersion, setAppVersion] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(currentUser.name);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Avatar mode: 'photo' | 'initial' | 'emoji'
  const [avatarMode, setAvatarMode] = useState<'photo' | 'initial' | 'emoji'>(
    currentUser.avatarImageData ? 'photo' : currentUser.avatarEmoji ? 'emoji' : 'initial'
  );

  // Categories
  const [categories, setCategories] = useState<string[]>([]);
  const [newCategoryInput, setNewCategoryInput] = useState('');

  // Network
  const [localInfo, setLocalInfo] = useState<{ addresses: string[]; port: number }>({ addresses: [], port: 0 });
  const [connectIpInput, setConnectIpInput] = useState('');
  const [connectStatus, setConnectStatus] = useState('');

  const isAdmin = currentUser.username.toLowerCase() === 'saurabh';

  useEffect(() => {
    (window as any).zenstate.getLoginItemSettings?.().then((enabled: boolean) => {
      setLaunchAtLogin(enabled);
    }).catch(() => {});
    (window as any).zenstate.getAppVersion?.().then((v: string) => {
      setAppVersion(v);
    }).catch(() => {});
    // Load categories
    (window as any).zenstate.getCategories?.().then((cats: string[]) => {
      setCategories(cats || []);
    }).catch(() => {});
    // Load network info
    (window as any).zenstate.getLocalInfo?.().then((info: { addresses: string[]; port: number }) => {
      setLocalInfo(info);
    }).catch(() => {});
  }, []);

  function handleNameSave() {
    if (nameInput.trim() && nameInput.trim() !== currentUser.name) {
      onUserUpdate({ name: nameInput.trim() });
    }
    setEditingName(false);
  }

  function handleToggleLaunchAtLogin() {
    const newValue = !launchAtLogin;
    setLaunchAtLogin(newValue);
    (window as any).zenstate.setLoginItemSettings?.(newValue);
  }

  function handleToggleEmergencyAccess(peerId: string, currentValue: boolean) {
    (window as any).zenstate.grantEmergencyAccess(peerId, !currentValue);
  }

  async function handleResetApp() {
    await (window as any).zenstate.resetAllData();
    setShowResetConfirm(false);
    onSignOut();
  }

  async function handlePickPhoto() {
    const base64 = await (window as any).zenstate.pickAvatarImage();
    if (base64) {
      onUserUpdate({ avatarImageData: base64, avatarEmoji: undefined });
      setAvatarMode('photo');
    }
  }

  function handleUseInitial() {
    onUserUpdate({ avatarImageData: undefined, avatarEmoji: undefined });
    setAvatarMode('initial');
  }

  function handleAddCategory() {
    const cat = newCategoryInput.trim();
    if (!cat || categories.includes(cat)) return;
    const updated = [...categories, cat];
    setCategories(updated);
    (window as any).zenstate.saveCategories(updated);
    setNewCategoryInput('');
  }

  function handleDeleteCategory(cat: string) {
    const updated = categories.filter((c) => c !== cat);
    setCategories(updated);
    (window as any).zenstate.saveCategories(updated);
  }

  async function handleConnectIP() {
    const input = connectIpInput.trim();
    if (!input) return;
    // Parse host:port
    const parts = input.split(':');
    const host = parts[0];
    const port = parseInt(parts[1] || '0', 10);
    if (!host || isNaN(port) || port <= 0) {
      setConnectStatus('Invalid format. Use IP:Port');
      return;
    }
    try {
      await (window as any).zenstate.connectToIP(host, port);
      setConnectStatus('Connection initiated');
      setConnectIpInput('');
      setTimeout(() => setConnectStatus(''), 3000);
    } catch {
      setConnectStatus('Connection failed');
    }
  }

  // Render current avatar
  function renderAvatar(size: number, fontSize: number) {
    return (
      <div style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: currentUser.avatarColor || '#007AFF',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize,
        overflow: 'hidden',
      }}>
        {currentUser.avatarImageData ? (
          <img src={`data:image/png;base64,${currentUser.avatarImageData}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : currentUser.avatarEmoji ? (
          currentUser.avatarEmoji
        ) : (
          <span style={{ fontSize: fontSize * 0.7, fontWeight: 700, color: 'white' }}>
            {currentUser.name.charAt(0).toUpperCase()}
          </span>
        )}
      </div>
    );
  }

  const sections: { id: SettingsSection; label: string; icon: React.ReactNode; adminOnly?: boolean }[] = [
    { id: 'general', label: 'General', icon: <Settings size={16} /> },
    { id: 'categories', label: 'Categories', icon: <Tag size={16} /> },
    { id: 'network', label: 'Network', icon: <Wifi size={16} /> },
    { id: 'about', label: 'About', icon: <Info size={16} /> },
    { id: 'admin', label: 'Admin', icon: <Shield size={16} />, adminOnly: true },
  ];

  const visibleSections = sections.filter((s) => !s.adminOnly || isAdmin);

  return (
    <div className="fade-in">
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 20 }}>Settings</h1>

      {/* Tab Bar */}
      <div style={{
        display: 'flex',
        gap: 4,
        marginBottom: 24,
        borderBottom: '1px solid var(--zen-divider)',
        paddingBottom: 0,
      }}>
        {visibleSections.map((section) => (
          <button
            key={section.id}
            onClick={() => setActiveSection(section.id)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              padding: '8px 16px',
              background: 'none',
              border: 'none',
              borderBottom: activeSection === section.id ? '2px solid var(--zen-primary)' : '2px solid transparent',
              color: activeSection === section.id ? 'var(--zen-primary)' : 'var(--zen-secondary-text)',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 500,
              fontFamily: 'inherit',
              transition: 'all 0.15s ease',
              marginBottom: -1,
            }}
          >
            {section.icon}
            {section.label}
          </button>
        ))}
      </div>

      {/* General Section */}
      {activeSection === 'general' && (
        <div className="card">
          {/* Profile */}
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 12 }}>Profile</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            {renderAvatar(56, 28)}
            <div>
              {editingName ? (
                <input
                  className="text-input"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  autoFocus
                  style={{ width: 180, fontSize: 13 }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleNameSave(); }}
                  onBlur={handleNameSave}
                />
              ) : (
                <div
                  style={{ fontSize: 16, fontWeight: 600, cursor: 'pointer' }}
                  onClick={() => { setNameInput(currentUser.name); setEditingName(true); }}
                  title="Click to edit"
                >
                  {currentUser.name}
                </div>
              )}
              <div style={{ fontSize: 12, color: 'var(--zen-secondary-text)' }}>@{currentUser.username}</div>
            </div>
          </div>

          {/* Avatar Mode Selector */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--zen-secondary-text)', marginBottom: 8 }}>Avatar Style</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button
                className={`btn ${avatarMode === 'initial' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ flex: 1, fontSize: 11 }}
                onClick={handleUseInitial}
              >
                Initial Letter
              </button>
              <button
                className={`btn ${avatarMode === 'photo' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ flex: 1, fontSize: 11 }}
                onClick={handlePickPhoto}
              >
                Upload Photo
              </button>
            </div>
          </div>

          {/* Color Picker */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--zen-secondary-text)', marginBottom: 6 }}>Avatar Color</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {COLOR_OPTIONS.map((color) => (
                <button
                  key={color}
                  onClick={() => onUserUpdate({ avatarColor: color })}
                  style={{
                    width: 28,
                    height: 28,
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

          {/* Launch at Login */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <span style={{ fontSize: 13, flex: 1 }}>Launch at Login</span>
            <button
              onClick={handleToggleLaunchAtLogin}
              style={{
                width: 44,
                height: 24,
                borderRadius: 12,
                border: 'none',
                background: launchAtLogin ? 'var(--zen-primary)' : 'var(--zen-secondary-bg)',
                cursor: 'pointer',
                position: 'relative',
                transition: 'background 0.2s ease',
              }}
            >
              <div style={{
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: 'white',
                position: 'absolute',
                top: 2,
                left: launchAtLogin ? 22 : 2,
                transition: 'left 0.2s ease',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              }} />
            </button>
          </div>

          <div className="divider" />

          {/* Sign Out */}
          {showSignOutConfirm ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--status-focused)', flex: 1 }}>Are you sure?</span>
              <button className="btn btn-secondary" onClick={() => setShowSignOutConfirm(false)}>Cancel</button>
              <button className="btn btn-danger" onClick={onSignOut}>Sign Out</button>
            </div>
          ) : (
            <button
              className="btn btn-danger"
              style={{ width: '100%', marginTop: 8 }}
              onClick={() => setShowSignOutConfirm(true)}
            >
              Sign Out
            </button>
          )}
        </div>
      )}

      {/* Categories Section */}
      {activeSection === 'categories' && (
        <div className="card">
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 12 }}>Focus Categories</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {categories.map((cat) => (
              <div key={cat} style={{
                padding: '6px 12px',
                borderRadius: 8,
                background: 'var(--zen-tertiary-bg)',
                border: '1px solid var(--zen-divider)',
                fontSize: 12,
                color: 'var(--zen-secondary-text)',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}>
                {cat}
                <button
                  onClick={() => handleDeleteCategory(cat)}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--zen-tertiary-text)',
                    fontSize: 14,
                    padding: 0,
                    lineHeight: 1,
                    fontFamily: 'inherit',
                  }}
                  title="Remove category"
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          {/* Add category */}
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="text-input"
              placeholder="New category..."
              value={newCategoryInput}
              onChange={(e) => setNewCategoryInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddCategory(); }}
              style={{ flex: 1, fontSize: 12 }}
            />
            <button
              className="btn btn-primary"
              style={{ fontSize: 11 }}
              onClick={handleAddCategory}
              disabled={!newCategoryInput.trim()}
            >
              + Add
            </button>
          </div>

          <div style={{ marginTop: 12, fontSize: 11, color: 'var(--zen-tertiary-text)' }}>
            Categories are used to organize your focus sessions and time tracking.
          </div>
        </div>
      )}

      {/* Network Section */}
      {activeSection === 'network' && (
        <div className="card">
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 12 }}>Network</div>

          {/* Local IP display */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--zen-secondary-text)', marginBottom: 6 }}>Your Address</div>
            {localInfo.addresses.length > 0 ? (
              localInfo.addresses.map((addr) => (
                <div key={addr} style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  background: 'var(--zen-tertiary-bg)',
                  border: '1px solid var(--zen-divider)',
                  fontSize: 13,
                  fontFamily: 'var(--font-mono)',
                  marginBottom: 4,
                }}>
                  {addr}:{localInfo.port}
                </div>
              ))
            ) : (
              <div style={{ fontSize: 12, color: 'var(--zen-tertiary-text)' }}>
                Not connected to a network
              </div>
            )}
            <div style={{ fontSize: 10, color: 'var(--zen-tertiary-text)', marginTop: 4 }}>
              Share this address with team members who can't auto-discover you.
            </div>
          </div>

          <div className="divider" />

          {/* Manual connect */}
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--zen-secondary-text)', marginBottom: 6 }}>Connect to Peer</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="text-input"
                placeholder="IP:Port (e.g. 192.168.1.5:54321)"
                value={connectIpInput}
                onChange={(e) => setConnectIpInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleConnectIP(); }}
                style={{ flex: 1, fontSize: 12 }}
              />
              <button
                className="btn btn-primary"
                style={{ fontSize: 11 }}
                onClick={handleConnectIP}
                disabled={!connectIpInput.trim()}
              >
                Connect
              </button>
            </div>
            {connectStatus && (
              <div style={{ fontSize: 11, color: 'var(--zen-secondary-text)', marginTop: 6 }}>
                {connectStatus}
              </div>
            )}
            <div style={{ fontSize: 10, color: 'var(--zen-tertiary-text)', marginTop: 8 }}>
              Use this to manually connect to a team member when auto-discovery isn't working.
            </div>
          </div>
        </div>
      )}

      {/* About Section */}
      {activeSection === 'about' && (
        <div className="card" style={{ textAlign: 'center' }}>
          {/* App Icon */}
          <div style={{
            width: 80,
            height: 80,
            borderRadius: '50%',
            background: 'var(--zen-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '16px auto',
          }}>
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
              <circle cx="20" cy="12" r="5" fill="white"/>
              <circle cx="12" cy="24" r="5" fill="white"/>
              <circle cx="28" cy="24" r="5" fill="white"/>
              <circle cx="20" cy="20" r="3" fill="white" opacity="0.6"/>
            </svg>
          </div>

          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>ZenState</div>
          <div style={{ fontSize: 13, color: 'var(--zen-secondary-text)', marginBottom: 8 }}>
            Version {appVersion || '3.0.0'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--zen-tertiary-text)', marginBottom: 4 }}>
            Team availability and focus tracking
          </div>
          <div style={{ fontSize: 12, color: 'var(--zen-tertiary-text)', marginBottom: 24 }}>
            for local networks using Bonjour
          </div>
          <div style={{ fontSize: 11, color: 'var(--zen-tertiary-text)', marginBottom: 24 }}>
            App by Everything Flow and Everything Design
          </div>

          <div className="divider" />

          {/* Reset App */}
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 11, color: 'var(--zen-tertiary-text)', marginBottom: 8 }}>
              Reset will clear all your data including sessions, settings, and account info.
            </div>
            {showResetConfirm ? (
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                <button className="btn btn-secondary" onClick={() => setShowResetConfirm(false)}>Cancel</button>
                <button className="btn btn-danger" onClick={handleResetApp}>Confirm Reset</button>
              </div>
            ) : (
              <button
                className="btn btn-danger"
                onClick={() => setShowResetConfirm(true)}
              >
                Reset App
              </button>
            )}
          </div>
        </div>
      )}

      {/* Admin Section */}
      {activeSection === 'admin' && isAdmin && (
        <div className="card">
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Emergency Access</div>
          <div style={{ fontSize: 11, color: 'var(--zen-secondary-text)', marginBottom: 12 }}>
            Grant urgent request access to team members in Focus mode
          </div>
          {peers.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--zen-tertiary-text)', textAlign: 'center', padding: 16 }}>
              No team members connected
            </div>
          ) : (
            peers.map((peer) => (
              <div key={peer.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
                <div style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: peer.avatarColor || '#8E8E93',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 14,
                  overflow: 'hidden',
                }}>
                  {peer.avatarImageData ? (
                    <img src={`data:image/png;base64,${peer.avatarImageData}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : peer.avatarEmoji ? (
                    peer.avatarEmoji
                  ) : (
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'white' }}>{peer.name.charAt(0).toUpperCase()}</span>
                  )}
                </div>
                <span style={{ fontSize: 13, flex: 1 }}>{peer.name}</span>
                <button
                  onClick={() => handleToggleEmergencyAccess(peer.id, peer.canSendEmergency)}
                  style={{
                    width: 44,
                    height: 24,
                    borderRadius: 12,
                    border: 'none',
                    background: peer.canSendEmergency ? '#FF3B30' : 'var(--zen-secondary-bg)',
                    cursor: 'pointer',
                    position: 'relative',
                    transition: 'background 0.2s ease',
                  }}
                >
                  <div style={{
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    background: 'white',
                    position: 'absolute',
                    top: 2,
                    left: peer.canSendEmergency ? 22 : 2,
                    transition: 'left 0.2s ease',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                  }} />
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
