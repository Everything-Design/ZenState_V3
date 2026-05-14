import React, { useState, useEffect, useRef } from 'react';
import { Settings, Info, Shield, Wifi, KeyRound, Briefcase } from 'lucide-react';
import { User, AppSettings, LicenseState, BasecampAuthState, BasecampCredentials } from '../../../shared/types';
import { ProBadge, ProGate } from '../../components/ProGate';
import LicenseActivationModal from '../../components/LicenseActivationModal';
import NetworkTab from './NetworkTab';

// Avatar colors — no green/orange/red (reserved for status indicators)
const COLOR_OPTIONS = ['#007AFF', '#5856D6', '#AF52DE', '#FF2D55', '#00C7BE', '#5AC8FA', '#BF5AF2', '#A2845E'];
const EMOJI_OPTIONS = [
  // GenZ / fun
  '😎', '🤪', '🥶', '💀', '👻', '🤡', '🫠', '🫡', '🤯', '🥳',
  // Designers
  '🎨', '✏️', '🖌️', '🎭', '👁️', '💅', '🪄', '✨',
  // Developers
  '💻', '🧑‍💻', '⌨️', '🤖', '🐛', '🔧', '🧪', '🛠️',
  // Animators / Motion
  '🎬', '🎞️', '🕹️', '🌀', '💫', '🔮', '🪩', '🌊',
  // Management
  '📊', '🧠', '🎯', '📋', '🗂️', '💼', '🏆', '📈',
  // Misc fun
  '🚀', '🔥', '⚡', '🦊', '🐱', '🦄', '🍀', '🎮', '☕', '🌈',
];

interface Props {
  currentUser: User;
  peers: User[];
  isPro: boolean;
  licenseState: LicenseState;
  onLicenseStateChange: (state: LicenseState) => void;
  onUserUpdate: (updates: Partial<User>) => void;
  onSignOut: () => void;
}

type SettingsSection = 'general' | 'network' | 'basecamp' | 'about' | 'admin' | 'license';

export default function SettingsTab({ currentUser, peers, isPro, licenseState, onLicenseStateChange, onUserUpdate, onSignOut }: Props) {
  const [activeSection, setActiveSection] = useState<SettingsSection>('general');
  const [launchAtLogin, setLaunchAtLogin] = useState(false);
  const [appVersion, setAppVersion] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(currentUser.name);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'available' | 'downloading' | 'not-available' | 'downloaded' | 'error'>('idle');
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  // Avatar mode: 'photo' | 'initial' | 'emoji'
  const [avatarMode, setAvatarMode] = useState<'photo' | 'initial' | 'emoji'>(
    currentUser.avatarImageData ? 'photo' : currentUser.avatarEmoji ? 'emoji' : 'initial'
  );

  // Network
  const [localInfo, setLocalInfo] = useState<{ addresses: string[]; port: number }>({ addresses: [], port: 0 });
  const [connectIpInput, setConnectIpInput] = useState('');
  const [connectStatus, setConnectStatus] = useState('');

  // Basecamp
  const [bcAuthState, setBcAuthState] = useState<BasecampAuthState | null>(null);
  const [bcCredentials, setBcCredentials] = useState<BasecampCredentials>({ clientId: '', clientSecret: '' });
  const [bcCredentialsSaved, setBcCredentialsSaved] = useState(false);
  const [bcShowSecret, setBcShowSecret] = useState(false);
  const [bcConnecting, setBcConnecting] = useState(false);
  const [bcStatus, setBcStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [bcConnectElapsed, setBcConnectElapsed] = useState(0);
  const bcConnectTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const bcConnectInFlight = useRef(false);

  // App settings (productivity)
  const [appSettings, setAppSettings] = useState<AppSettings>({
    breakReminderEnabled: false,
    breakReminderIntervalSeconds: 90 * 60,
    idleDetectionEnabled: false,
    idleThresholdSeconds: 5 * 60,
    requireTimesheetConfirmation: true,
    miniTimerEnabled: true,
    miniTimerAutoDim: false,
  });

  // Admin notifications


  const [showLicenseModal, setShowLicenseModal] = useState(false);
  const isAdmin = currentUser.isAdmin === true;

  useEffect(() => {
    (window as any).zenstate.getLoginItemSettings?.().then((enabled: boolean) => {
      setLaunchAtLogin(enabled);
    }).catch(() => {});
    (window as any).zenstate.getAppVersion?.().then((v: string) => {
      setAppVersion(v);
    }).catch(() => {});
    // Load network info
    (window as any).zenstate.getLocalInfo?.().then((info: { addresses: string[]; port: number }) => {
      setLocalInfo(info);
    }).catch(() => {});
    // Load app settings
    (window as any).zenstate.getSettings?.().then((s: AppSettings) => {
      if (s) setAppSettings(s);
    }).catch(() => {});
    // Listen for auto-update download completion + basecamp auth changes.
    // Each on() returns its own unsubscribe so when SettingsTab unmounts we
    // detach only these listeners — not, e.g., ProjectsTab's subscription on
    // the same basecamp:auth-changed channel in the same dashboard window.
    // v5.1.2 — full update lifecycle. The previous "stuck at downloading"
    // bug on Windows was driven by the renderer only listening for the final
    // `update:downloaded` event. By subscribing to progress + error too, the
    // UI can show real progress and recover from a failed download instead
    // of sitting on "available" forever.
    const offDownloaded = window.zenstate.on('update:downloaded', () => {
      setUpdateStatus('downloaded');
      setUpdateProgress(null);
      setUpdateError(null);
    });
    const offProgress = window.zenstate.on('update:progress', (...args: unknown[]) => {
      const p = args[0] as { percent: number };
      setUpdateStatus('downloading');
      setUpdateProgress(typeof p?.percent === 'number' ? p.percent : null);
    });
    const offUpdateError = window.zenstate.on('update:error', (...args: unknown[]) => {
      const e = args[0] as { message?: string };
      setUpdateStatus('error');
      setUpdateError(e?.message ?? 'Update failed');
      setUpdateProgress(null);
    });
    const offNotAvailable = window.zenstate.on('update:not-available', () => {
      // Only switch to 'not-available' if we were actively checking — otherwise
      // the periodic background check would replace 'downloaded' or 'idle'.
      setUpdateStatus((prev) => (prev === 'checking' ? 'not-available' : prev));
    });

    // Basecamp: seed state and listen for auth changes from main process
    window.zenstate.bcGetAuthState().then((state) => setBcAuthState(state)).catch(() => {});
    window.zenstate.bcGetCredentials().then((creds) => {
      if (creds) {
        setBcCredentials(creds);
        setBcCredentialsSaved(true);
      }
    }).catch(() => {});
    const offAuth = window.zenstate.on('basecamp:auth-changed', (...args: unknown[]) => {
      const state = args[0] as BasecampAuthState;
      setBcAuthState(state);
      setBcConnecting(false);
      if (bcConnectTimer.current) { clearInterval(bcConnectTimer.current); bcConnectTimer.current = null; }
      setBcConnectElapsed(0);
    });

    return () => {
      offDownloaded();
      offProgress();
      offUpdateError();
      offNotAvailable();
      offAuth();
      if (bcConnectTimer.current) clearInterval(bcConnectTimer.current);
    };
  }, []);

  async function handleCheckForUpdate() {
    setUpdateStatus('checking');
    setUpdateProgress(null);
    setUpdateError(null);
    try {
      const result = await (window as any).zenstate.checkForUpdate();
      if (result?.updateAvailable) {
        // 'available' is brief — autoDownload is on so the download starts
        // immediately and update:progress events will flip us to 'downloading'.
        setUpdateStatus('available');
      } else {
        setUpdateStatus('not-available');
        setTimeout(() => setUpdateStatus((s) => (s === 'not-available' ? 'idle' : s)), 3000);
      }
    } catch (err) {
      setUpdateStatus('error');
      setUpdateError((err as Error)?.message ?? 'Check failed');
    }
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
    (window as any).zenstate.setLoginItemSettings?.(newValue);
  }

  function handleToggleEmergencyAccess(peerId: string, currentValue: boolean) {
    (window as any).zenstate.grantEmergencyAccess(peerId, !currentValue);
  }

  function updateAppSettings(updates: Partial<AppSettings>) {
    const updated = { ...appSettings, ...updates };
    setAppSettings(updated);
    (window as any).zenstate.saveSettings?.(updated);
  }

  async function handleResetApp() {
    await (window as any).zenstate.resetAllData();
    setShowResetConfirm(false);
    onSignOut();
  }

  async function handleBcSaveCredentials() {
    setBcStatus(null);
    const ok = await (window as any).zenstate.bcSaveCredentials?.(bcCredentials).catch(() => false);
    if (ok) {
      setBcCredentialsSaved(true);
      setBcStatus({ type: 'success', message: 'Credentials saved.' });
    } else {
      setBcStatus({ type: 'error', message: 'Failed to save credentials.' });
    }
  }

  async function handleBcConnect() {
    if (bcConnectInFlight.current) return;
    bcConnectInFlight.current = true;
    setBcStatus(null);
    setBcConnecting(true);
    setBcConnectElapsed(0);
    bcConnectTimer.current = setInterval(() => {
      setBcConnectElapsed((prev) => prev + 1);
    }, 1000);
    try {
      const result = await (window as any).zenstate.bcConnect?.().catch((): { ok: boolean; error?: string; state?: BasecampAuthState } => ({ ok: false, error: 'Connection failed.' }));
      if (result?.ok && result.state) {
        setBcAuthState(result.state);
        setBcStatus({ type: 'success', message: 'Connected to Basecamp.' });
      } else {
        setBcStatus({ type: 'error', message: result?.error || 'Connection failed.' });
      }
    } finally {
      if (bcConnectTimer.current) { clearInterval(bcConnectTimer.current); bcConnectTimer.current = null; }
      setBcConnecting(false);
      setBcConnectElapsed(0);
      bcConnectInFlight.current = false;
    }
  }

  async function handleBcDisconnect() {
    if (!confirm('Disconnect from Basecamp? You can reconnect any time.')) return;
    const state = await (window as any).zenstate.bcDisconnect?.().catch(() => null);
    if (state) setBcAuthState(state);
    setBcCredentialsSaved(false);
    setBcStatus(null);
  }

  const [bcSyncing, setBcSyncing] = useState(false);
  async function handleBcBackfill() {
    setBcSyncing(true);
    setBcStatus(null);
    const res = await (window as any).zenstate.bcBackfillTimesheet?.().catch((e: Error) => ({ ok: false, error: e.message }));
    setBcSyncing(false);
    if (!res?.ok) {
      setBcStatus({ type: 'error', message: res?.error || 'Sync failed.' });
      return;
    }
    const { migrated, failed, totalUnsynced, groups } = res.data || {};
    if ((totalUnsynced ?? 0) === 0) {
      setBcStatus({ type: 'success', message: 'Nothing to sync — all past sessions are already on Basecamp.' });
      return;
    }
    if (failed && failed > 0) {
      setBcStatus({
        type: 'error',
        message: `Synced ${migrated} of ${totalUnsynced} sessions (${groups} entries). ${failed} failed — see logs.`,
      });
    } else {
      setBcStatus({
        type: 'success',
        message: `Synced ${migrated} sessions to Basecamp as ${groups} timesheet ${groups === 1 ? 'entry' : 'entries'}.`,
      });
    }
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

  function handleEmojiSelect(emoji: string) {
    onUserUpdate({ avatarEmoji: emoji, avatarImageData: undefined });
    setAvatarMode('emoji');
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

  const sections: { id: SettingsSection; label: string; icon: React.ReactNode; adminOnly?: boolean; proOnly?: boolean }[] = [
    { id: 'general', label: 'General', icon: <Settings size={16} /> },
    { id: 'network', label: 'Network', icon: <Wifi size={16} /> },
    { id: 'basecamp', label: 'Basecamp', icon: <Briefcase size={16} /> },
    { id: 'license', label: 'License', icon: <KeyRound size={16} /> },
    { id: 'about', label: 'About', icon: <Info size={16} /> },
    { id: 'admin', label: 'Admin', icon: <Shield size={16} />, adminOnly: true, proOnly: true },
  ];

  const visibleSections = sections.filter((s) => {
    if (s.adminOnly && !isAdmin) return false;
    if (s.proOnly && !isPro) return false;
    return true;
  });

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
              <button
                className={`btn ${avatarMode === 'emoji' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ flex: 1, fontSize: 11 }}
                onClick={() => setAvatarMode('emoji')}
              >
                Emoji
              </button>
            </div>
            {avatarMode === 'emoji' && (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(10, 1fr)',
                columnGap: 6,
                rowGap: 6,
                maxHeight: 3 * 32 + 2 * 6,
                overflowY: 'auto',
                overflowX: 'hidden',
              }}>
                {EMOJI_OPTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => handleEmojiSelect(emoji)}
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 6,
                      border: currentUser.avatarEmoji === emoji ? '2px solid var(--zen-primary)' : '1px solid var(--zen-divider)',
                      background: currentUser.avatarEmoji === emoji ? 'rgba(0, 122, 255, 0.15)' : 'var(--zen-tertiary-bg)',
                      cursor: 'pointer',
                      fontSize: 16,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Color Picker */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--zen-secondary-text)', marginBottom: 6 }}>Avatar Color</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
              {/* Custom color picker */}
              <label
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: !COLOR_OPTIONS.includes(currentUser.avatarColor || '#007AFF')
                    ? currentUser.avatarColor
                    : 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)',
                  border: !COLOR_OPTIONS.includes(currentUser.avatarColor || '#007AFF')
                    ? '2px solid white'
                    : '2px solid transparent',
                  boxShadow: !COLOR_OPTIONS.includes(currentUser.avatarColor || '#007AFF')
                    ? '0 0 0 1px var(--zen-primary)'
                    : 'none',
                  cursor: 'pointer',
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                title="Custom color"
              >
                <input
                  type="color"
                  value={currentUser.avatarColor || '#007AFF'}
                  onChange={(e) => onUserUpdate({ avatarColor: e.target.value })}
                  style={{
                    position: 'absolute',
                    width: 0,
                    height: 0,
                    opacity: 0,
                    overflow: 'hidden',
                  }}
                />
              </label>
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

          {/* Productivity (Pro features) */}
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, marginTop: 8 }}>
            Productivity {!isPro && <ProBadge />}
          </div>

          <ProGate isPro={isPro} label="Upgrade to Pro">
          {/* Break Reminders */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 13, flex: 1 }}>☕ Break Reminders</span>
            <button
              onClick={() => updateAppSettings({ breakReminderEnabled: !appSettings.breakReminderEnabled })}
              style={{
                width: 44,
                height: 24,
                borderRadius: 12,
                border: 'none',
                background: appSettings.breakReminderEnabled ? 'var(--zen-primary)' : 'var(--zen-secondary-bg)',
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
                left: appSettings.breakReminderEnabled ? 22 : 2,
                transition: 'left 0.2s ease',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              }} />
            </button>
          </div>
          {appSettings.breakReminderEnabled && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, paddingLeft: 16 }}>
              <span style={{ fontSize: 11, color: 'var(--zen-secondary-text)', flex: 1 }}>Remind every</span>
              <input
                type="number"
                min="1"
                max="480"
                value={Math.round(appSettings.breakReminderIntervalSeconds / 60)}
                onChange={(e) => {
                  const mins = parseInt(e.target.value) || 90;
                  updateAppSettings({ breakReminderIntervalSeconds: mins * 60 });
                }}
                className="text-input"
                style={{ width: 60, textAlign: 'center', fontSize: 12 }}
              />
              <span style={{ fontSize: 11, color: 'var(--zen-tertiary-text)' }}>min</span>
            </div>
          )}

          {/* Idle Detection */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 13, flex: 1 }}>💤 Idle Detection</span>
            <button
              onClick={() => updateAppSettings({ idleDetectionEnabled: !appSettings.idleDetectionEnabled })}
              style={{
                width: 44,
                height: 24,
                borderRadius: 12,
                border: 'none',
                background: appSettings.idleDetectionEnabled ? 'var(--zen-primary)' : 'var(--zen-secondary-bg)',
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
                left: appSettings.idleDetectionEnabled ? 22 : 2,
                transition: 'left 0.2s ease',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              }} />
            </button>
          </div>
          {appSettings.idleDetectionEnabled && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, paddingLeft: 16 }}>
              <span style={{ fontSize: 11, color: 'var(--zen-secondary-text)', flex: 1 }}>Auto-pause after</span>
              <input
                type="number"
                min="1"
                max="60"
                value={Math.round(appSettings.idleThresholdSeconds / 60)}
                onChange={(e) => {
                  const mins = parseInt(e.target.value) || 5;
                  updateAppSettings({ idleThresholdSeconds: mins * 60 });
                }}
                className="text-input"
                style={{ width: 60, textAlign: 'center', fontSize: 12 }}
              />
              <span style={{ fontSize: 11, color: 'var(--zen-tertiary-text)' }}>min idle</span>
            </div>
          )}

          <div style={{ fontSize: 10, color: 'var(--zen-tertiary-text)', marginBottom: 12 }}>
            Break reminders alert you during long focus sessions. Idle detection auto-pauses the timer when you step away.
          </div>
          </ProGate>

          <div className="divider" />

          {/* Floating mini-timer overlay */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, marginTop: 8 }}>
            <span style={{ fontSize: 13, flex: 1 }}>⏱ Floating timer pill</span>
            <button
              onClick={() => updateAppSettings({ miniTimerEnabled: !appSettings.miniTimerEnabled })}
              style={{
                width: 44, height: 24, borderRadius: 12, border: 'none',
                background: appSettings.miniTimerEnabled ? 'var(--zen-primary)' : 'var(--zen-secondary-bg)',
                cursor: 'pointer', position: 'relative', transition: 'background 0.2s ease',
              }}
            >
              <div style={{
                width: 20, height: 20, borderRadius: '50%', background: 'white',
                position: 'absolute', top: 2,
                left: appSettings.miniTimerEnabled ? 22 : 2,
                transition: 'left 0.2s ease',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              }} />
            </button>
          </div>
          <div style={{ fontSize: 10, color: 'var(--zen-tertiary-text)', marginBottom: 12 }}>
            A small timer pill floats on top of all apps — including full-screen ones — while a timer is running. Click it to switch tasks. Drag to any corner.
          </div>

          {/* Auto-dim pill */}
          {appSettings.miniTimerEnabled && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 13, flex: 1 }}>👁 Auto-dim pill when idle</span>
                <button
                  onClick={() => updateAppSettings({ miniTimerAutoDim: !appSettings.miniTimerAutoDim })}
                  style={{
                    width: 44, height: 24, borderRadius: 12, border: 'none',
                    background: appSettings.miniTimerAutoDim ? 'var(--zen-primary)' : 'var(--zen-secondary-bg)',
                    cursor: 'pointer', position: 'relative', transition: 'background 0.2s ease',
                  }}
                >
                  <div style={{
                    width: 20, height: 20, borderRadius: '50%', background: 'white',
                    position: 'absolute', top: 2,
                    left: appSettings.miniTimerAutoDim ? 22 : 2,
                    transition: 'left 0.2s ease',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                  }} />
                </button>
              </div>
              <div style={{ fontSize: 10, color: 'var(--zen-tertiary-text)', marginBottom: 12 }}>
                Pill fades to half-opacity after a few seconds of no hover, so it stays out of your way without disappearing. Hover to bring it back.
              </div>
            </>
          )}

          {/* Pre-flight Basecamp confirmation */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 13, flex: 1 }}>📋 Review before posting to Basecamp</span>
            <button
              onClick={() => updateAppSettings({ requireTimesheetConfirmation: !appSettings.requireTimesheetConfirmation })}
              style={{
                width: 44, height: 24, borderRadius: 12, border: 'none',
                background: appSettings.requireTimesheetConfirmation ? 'var(--zen-primary)' : 'var(--zen-secondary-bg)',
                cursor: 'pointer', position: 'relative', transition: 'background 0.2s ease',
              }}
            >
              <div style={{
                width: 20, height: 20, borderRadius: '50%', background: 'white',
                position: 'absolute', top: 2,
                left: appSettings.requireTimesheetConfirmation ? 22 : 2,
                transition: 'left 0.2s ease',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              }} />
            </button>
          </div>
          <div style={{ fontSize: 10, color: 'var(--zen-tertiary-text)', marginBottom: 12 }}>
            When on, a small dialog appears when a Basecamp-linked timer stops so you can edit the duration and choose Post or Discard. Nothing reaches Basecamp until you confirm.
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



      {/* Network Section — fully replaces the standalone Network tab.
          Includes peer connection diagnostics (local IP/port, manual connect)
          + WiFi info (signal, channel, nearby APs). The WiFi part is mainly
          a troubleshooting tool for the LAN peer-discovery feature. */}
      {activeSection === 'network' && (
        <NetworkTab />
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

          {/* Check for Update */}
          <div style={{ marginBottom: 16 }}>
            {updateStatus === 'idle' && (
              <button className="btn btn-secondary" onClick={handleCheckForUpdate}>
                Check for Update
              </button>
            )}
            {updateStatus === 'checking' && (
              <span style={{ fontSize: 12, color: 'var(--zen-secondary-text)' }}>Checking for updates...</span>
            )}
            {updateStatus === 'available' && (
              <span style={{ fontSize: 12, color: 'var(--zen-primary)' }}>Update found — starting download…</span>
            )}
            {updateStatus === 'downloading' && (
              <span style={{ fontSize: 12, color: 'var(--zen-primary)' }}>
                Downloading update… {updateProgress !== null ? `${updateProgress}%` : ''}
              </span>
            )}
            {updateStatus === 'not-available' && (
              <span style={{ fontSize: 12, color: 'var(--status-available)' }}>You're up to date</span>
            )}
            {updateStatus === 'downloaded' && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--status-available)' }}>Update ready — Restart to update</span>
                <button className="btn btn-primary" onClick={() => (window as any).zenstate.installUpdate()}>
                  Restart Now
                </button>
              </div>
            )}
            {updateStatus === 'error' && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--status-occupied, #ff6b6b)' }}>
                  Update failed{updateError ? ` — ${updateError}` : ''}
                </span>
                <button className="btn btn-secondary" onClick={handleCheckForUpdate}>
                  Try again
                </button>
              </div>
            )}
          </div>

          <div className="divider" />

          {/* Reset App */}
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 11, color: 'var(--zen-tertiary-text)', marginBottom: 8, lineHeight: 1.5 }}>
              Reset clears your account, time-tracking history, today/tomorrow plans,
              recently-used to-dos, peer groups, Basecamp connection, and license.
              App preferences (mini-timer, break reminders, etc.) are kept — you can
              tweak them in Settings after signing back in.
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

      {/* Basecamp Section */}
      {activeSection === 'basecamp' && (
        <div className="card">
          <div className="hstack" style={{ gap: 8, alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>Basecamp</div>
            {bcAuthState?.isConnected && (
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#34C759', flexShrink: 0 }} />
            )}
          </div>

          {bcAuthState?.isConnected ? (
            <>
              <div style={{
                padding: '12px 16px',
                borderRadius: 10,
                background: 'rgba(52, 199, 89, 0.08)',
                border: '1px solid rgba(52, 199, 89, 0.2)',
                marginBottom: 16,
              }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--status-available)', marginBottom: 6 }}>
                  Connected
                </div>
                <div style={{ fontSize: 11, color: 'var(--zen-secondary-text)', marginBottom: 2 }}>
                  Account: {bcAuthState.account?.name}
                </div>
                {bcAuthState.identity && (
                  <div style={{ fontSize: 11, color: 'var(--zen-secondary-text)' }}>
                    Identity: {bcAuthState.identity.firstName} {bcAuthState.identity.lastName}
                  </div>
                )}
              </div>

              <div style={{
                padding: '12px 16px',
                borderRadius: 10,
                background: 'var(--zen-tertiary-bg)',
                border: '1px solid var(--zen-divider)',
                marginBottom: 12,
              }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Share past sessions to Basecamp</div>
                <div style={{ fontSize: 11, color: 'var(--zen-secondary-text)', lineHeight: 1.5, marginBottom: 10 }}>
                  Optional — pushes your local sessions to Basecamp's timesheet, grouped by to-do and date. Only sessions you haven't already shared are included. Run this when you're ready to update your team. v5.1+: edits and deletes also auto-sync as you make them. Backfill is for retrying failures.
                </div>
                <button
                  className="btn btn-secondary"
                  style={{ width: '100%' }}
                  onClick={handleBcBackfill}
                  disabled={bcSyncing}
                >
                  {bcSyncing ? 'Syncing…' : 'Sync history to Basecamp'}
                </button>
              </div>

              {bcStatus && (
                <div style={{ fontSize: 11, color: bcStatus.type === 'success' ? '#34C759' : '#FF3B30', marginBottom: 12 }}>
                  {bcStatus.message}
                </div>
              )}

              <button className="btn btn-danger" style={{ width: '100%' }} onClick={handleBcDisconnect}>
                Disconnect
              </button>
            </>
          ) : (
            <>
              <div style={{ fontSize: 12, color: 'var(--zen-secondary-text)', lineHeight: 1.5, marginBottom: 16 }}>
                Your private record of what you worked on. Sessions stay on this Mac until <em>you</em> review and post them to Basecamp's timesheet — nothing is sent automatically. Use it to remember your day, recover unbilled hours, or share with your team on your terms.
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                <input
                  className="text-input"
                  placeholder="Client ID"
                  value={bcCredentials.clientId}
                  onChange={(e) => { setBcCredentials((c) => ({ ...c, clientId: e.target.value })); setBcCredentialsSaved(false); }}
                />
                <div className="hstack" style={{ gap: 6 }}>
                  <input
                    className="text-input"
                    placeholder="Client Secret"
                    type={bcShowSecret ? 'text' : 'password'}
                    value={bcCredentials.clientSecret}
                    onChange={(e) => { setBcCredentials((c) => ({ ...c, clientSecret: e.target.value })); setBcCredentialsSaved(false); }}
                    style={{ flex: 1 }}
                  />
                  <button className="btn btn-secondary" onClick={() => setBcShowSecret((v) => !v)} style={{ flexShrink: 0, fontSize: 11 }}>
                    {bcShowSecret ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              <div style={{ fontSize: 11, color: 'var(--zen-tertiary-text)', lineHeight: 1.6, marginBottom: 12 }}>
                Register an integration at{' '}
                <span style={{ color: 'var(--zen-secondary-text)' }}>launchpad.37signals.com/integrations</span>
                {' '}and use this redirect URI:
                <br />
                <span style={{ fontFamily: 'monospace', userSelect: 'all', color: 'var(--zen-secondary-text)' }}>
                  http://127.0.0.1:53682/basecamp/callback
                </span>
              </div>

              <div className="hstack" style={{ gap: 8, marginBottom: 8 }}>
                <button
                  className="btn btn-secondary"
                  style={{ flex: 1 }}
                  onClick={handleBcSaveCredentials}
                  disabled={!bcCredentials.clientId.trim() || !bcCredentials.clientSecret.trim()}
                >
                  Save credentials
                </button>
                <button
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                  onClick={handleBcConnect}
                  disabled={!bcCredentialsSaved || bcConnecting}
                >
                  {bcConnecting
                    ? bcConnectElapsed >= 30
                      ? `Waiting… ${bcConnectElapsed}s`
                      : 'Connecting…'
                    : 'Connect'}
                </button>
                {bcConnecting && bcConnectElapsed >= 5 && (
                  <button
                    className="btn btn-secondary"
                    style={{ color: 'var(--status-focused)' }}
                    onClick={() => {
                      // Tell main to abort the in-flight OAuth flow so the
                      // callback server's port is freed up immediately and
                      // the connect Promise rejects on the renderer side.
                      window.zenstate.bcCancelConnect().catch(() => {});
                      setBcConnecting(false);
                      if (bcConnectTimer.current) { clearInterval(bcConnectTimer.current); bcConnectTimer.current = null; }
                      setBcConnectElapsed(0);
                      window.zenstate.bcGetAuthState().then(setBcAuthState).catch(() => {});
                    }}
                  >
                    Cancel
                  </button>
                )}
              </div>

              {bcStatus && (
                <div style={{ fontSize: 11, color: bcStatus.type === 'success' ? '#34C759' : '#FF3B30' }}>
                  {bcStatus.message}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* License Section */}
      {activeSection === 'license' && (
        <div className="card">
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 12 }}>License</div>

          {licenseState.isValid && licenseState.payload ? (
            <>
              <div style={{
                padding: '12px 16px',
                borderRadius: 10,
                background: 'rgba(52, 199, 89, 0.08)',
                border: '1px solid rgba(52, 199, 89, 0.2)',
                marginBottom: 16,
              }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--status-available)', marginBottom: 6 }}>
                  ZenState Pro — Active
                </div>
                <div style={{ fontSize: 11, color: 'var(--zen-secondary-text)', marginBottom: 2 }}>
                  Team: {licenseState.payload.teamName}
                </div>
                <div style={{ fontSize: 11, color: 'var(--zen-secondary-text)', marginBottom: 2 }}>
                  Seats: {licenseState.payload.seats}
                </div>
                <div style={{ fontSize: 11, color: 'var(--zen-secondary-text)' }}>
                  Expires: {new Date(licenseState.payload.expiresAt).toLocaleDateString()}
                </div>
              </div>
              <button
                className="btn btn-danger"
                style={{ width: '100%' }}
                onClick={async () => {
                  await (window as any).zenstate.deactivateLicense();
                  const state = await (window as any).zenstate.getLicenseState();
                  onLicenseStateChange(state);
                }}
              >
                Deactivate License
              </button>
            </>
          ) : (
            <>
              <div style={{
                padding: '12px 16px',
                borderRadius: 10,
                background: 'var(--zen-tertiary-bg)',
                border: '1px solid var(--zen-divider)',
                marginBottom: 16,
              }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                  Free Plan
                </div>
                <div style={{ fontSize: 11, color: 'var(--zen-secondary-text)', marginBottom: 8 }}>
                  Upgrade to ZenState Pro to unlock templates, CSV export, productivity tools, admin panel, and unlimited peers.
                </div>
                {licenseState.error && (
                  <div style={{ fontSize: 11, color: '#FF3B30', marginTop: 4 }}>
                    {licenseState.error}
                  </div>
                )}
              </div>
              <button
                className="btn btn-primary"
                style={{ width: '100%' }}
                onClick={() => setShowLicenseModal(true)}
              >
                Activate License Key
              </button>
            </>
          )}
        </div>
      )}

      {/* License Activation Modal */}
      {showLicenseModal && (
        <LicenseActivationModal
          onClose={() => setShowLicenseModal(false)}
          onActivated={(state) => {
            onLicenseStateChange(state);
            setShowLicenseModal(false);
          }}
        />
      )}

      {/* Admin Section */}
      {activeSection === 'admin' && isAdmin && (
        <>
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

        </>
      )}
    </div>
  );
}
