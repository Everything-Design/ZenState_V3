import React, { useState, useMemo } from 'react';
import { Settings, Timer, LayoutDashboard } from 'lucide-react';
import { User, AvailabilityStatus } from '../../shared/types';

const CATEGORIES = ['Development', 'Design', 'Meetings', 'Writing', 'Research', 'Planning', 'Admin', 'Other'];
const STATUS_SUGGESTIONS = ['In a meeting', 'Lunch break', 'Be right back', 'Deep work'];
const DURATION_OPTIONS = [
  { label: '30 min', ms: 30 * 60 * 1000 },
  { label: '1 hour', ms: 60 * 60 * 1000 },
  { label: '4 hours', ms: 4 * 60 * 60 * 1000 },
  { label: 'Today', ms: -1 }, // special: end of day
  { label: "Don't clear", ms: 0 },
];

interface TimerState {
  elapsed: number;
  isRunning: boolean;
  isPaused: boolean;
  taskLabel: string;
  category?: string;
}

interface Props {
  currentUser: User;
  peers: User[];
  timerState: TimerState;
  onStatusChange: (status: AvailabilityStatus) => void;
  onUserUpdate: (updates: Partial<User>) => void;
  onOpenSettings?: () => void;
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function getStatusColor(status: AvailabilityStatus): string {
  switch (status) {
    case AvailabilityStatus.Available: return 'var(--status-available)';
    case AvailabilityStatus.Occupied: return 'var(--status-occupied)';
    case AvailabilityStatus.Focused: return 'var(--status-focused)';
    default: return 'var(--status-offline)';
  }
}

function getEndOfDay(): string {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

export default function MenuBarView({ currentUser, peers, timerState, onStatusChange, onUserUpdate, onOpenSettings }: Props) {
  const [searchText, setSearchText] = useState('');
  const [showTimerInput, setShowTimerInput] = useState(false);
  const [timerTaskInput, setTimerTaskInput] = useState('');
  const [timerCategory, setTimerCategory] = useState('');
  const [showStatusMessage, setShowStatusMessage] = useState(false);
  const [statusMessageInput, setStatusMessageInput] = useState('');
  const [statusDuration, setStatusDuration] = useState(DURATION_OPTIONS[0]);

  // Presence counts
  const presenceCounts = useMemo(() => {
    const all = [currentUser, ...peers];
    return {
      available: all.filter((u) => u.status === AvailabilityStatus.Available).length,
      occupied: all.filter((u) => u.status === AvailabilityStatus.Occupied).length,
      focused: all.filter((u) => u.status === AvailabilityStatus.Focused).length,
      total: all.length,
    };
  }, [currentUser, peers]);

  // Filtered team members
  const filteredPeers = useMemo(() => {
    if (!searchText) return peers;
    const q = searchText.toLowerCase();
    return peers.filter((p) => p.name.toLowerCase().includes(q) || p.username.toLowerCase().includes(q));
  }, [peers, searchText]);

  const isTimerActive = timerState.isRunning || timerState.isPaused;

  function handleStartTimer() {
    if (!timerTaskInput.trim()) return;
    window.zenstate.startTimer(timerTaskInput.trim(), timerCategory || undefined);
    setTimerTaskInput('');
    setTimerCategory('');
    setShowTimerInput(false);
  }

  function handleSetStatusMessage() {
    if (!statusMessageInput.trim()) return;
    let expiry: string | undefined;
    if (statusDuration.ms === -1) {
      expiry = getEndOfDay();
    } else if (statusDuration.ms > 0) {
      expiry = new Date(Date.now() + statusDuration.ms).toISOString();
    }
    // ms === 0 means "Don't clear" → no expiry
    onUserUpdate({
      activeStatusMessage: statusMessageInput.trim(),
      statusMessageExpiry: expiry,
    });
    setStatusMessageInput('');
    setShowStatusMessage(false);
  }

  function handleClearStatusMessage() {
    onUserUpdate({
      activeStatusMessage: undefined,
      statusMessageExpiry: undefined,
    });
    setShowStatusMessage(false);
  }

  // ── Status Message Input View ───────
  if (showStatusMessage) {
    return (
      <div className="popover fade-in">
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="hstack" style={{ gap: 8 }}>
            <button className="footer-btn" onClick={() => setShowStatusMessage(false)}>
              ‹ Back
            </button>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Status Message</span>
          </div>

          <input
            className="text-input"
            placeholder="What's your status?"
            value={statusMessageInput}
            onChange={(e) => setStatusMessageInput(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSetStatusMessage();
            }}
          />

          {/* Quick Suggestions */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {STATUS_SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                className={`category-chip ${statusMessageInput === suggestion ? 'selected' : ''}`}
                onClick={() => setStatusMessageInput(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>

          {/* Duration */}
          <div>
            <div style={{ fontSize: 11, color: 'var(--zen-secondary-text)', marginBottom: 4 }}>Clear after</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {DURATION_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  className={`category-chip ${statusDuration.label === opt.label ? 'selected' : ''}`}
                  onClick={() => setStatusDuration(opt)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="hstack" style={{ gap: 8 }}>
            {currentUser.activeStatusMessage && (
              <button className="btn btn-danger" onClick={handleClearStatusMessage}>
                Clear
              </button>
            )}
            <div className="spacer" />
            <button className="btn btn-secondary" onClick={() => setShowStatusMessage(false)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={!statusMessageInput.trim()}
              onClick={handleSetStatusMessage}
            >
              Set
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Timer Input View ───────
  if (showTimerInput && !isTimerActive) {
    return (
      <div className="popover fade-in">
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="hstack" style={{ gap: 8 }}>
            <button className="footer-btn" onClick={() => setShowTimerInput(false)}>
              ‹ Back
            </button>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Record Time</span>
          </div>

          <input
            className="text-input"
            placeholder="What are you working on?"
            value={timerTaskInput}
            onChange={(e) => setTimerTaskInput(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && timerTaskInput.trim()) handleStartTimer();
            }}
          />

          {/* Category Picker */}
          <div>
            <div style={{ fontSize: 11, color: 'var(--zen-secondary-text)', marginBottom: 4 }}>Category</div>
            <div className="category-picker">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  className={`category-chip ${timerCategory === cat ? 'selected' : ''}`}
                  onClick={() => setTimerCategory(timerCategory === cat ? '' : cat)}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="hstack" style={{ gap: 8 }}>
            <button
              className="btn btn-secondary"
              onClick={() => { setShowTimerInput(false); setTimerTaskInput(''); setTimerCategory(''); }}
            >
              Cancel
            </button>
            <div className="spacer" />
            <button
              className="btn btn-primary"
              disabled={!timerTaskInput.trim()}
              onClick={handleStartTimer}
            >
              Start
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="popover">
      {/* User Header */}
      <div className="user-header">
        <div className="avatar" style={{ background: currentUser.avatarColor || '#007AFF' }}>
          <div className={`status-ring ${currentUser.status}`} />
          <span>{currentUser.avatarEmoji || '😊'}</span>
        </div>
        <div className="user-info">
          <div className="user-name">{currentUser.name}</div>
          <div className="user-status" style={{ color: getStatusColor(currentUser.status) }}>
            {currentUser.status === AvailabilityStatus.Available ? '● Available' :
             currentUser.status === AvailabilityStatus.Occupied ? '● Occupied' :
             currentUser.status === AvailabilityStatus.Focused ? '● Focus Mode' : '● Offline'}
          </div>
        </div>
      </div>

      {/* Status Message — clickable to edit */}
      <div
        style={{
          padding: '0 16px 8px',
          fontSize: 11,
          color: 'var(--zen-secondary-text)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
        onClick={() => setShowStatusMessage(true)}
      >
        {currentUser.activeStatusMessage ? (
          <span>💬 {currentUser.activeStatusMessage}</span>
        ) : (
          <span style={{ color: 'var(--zen-tertiary-text)' }}>+ Set a status message...</span>
        )}
      </div>

      {/* Status Picker */}
      <div className="status-picker">
        {[AvailabilityStatus.Available, AvailabilityStatus.Occupied, AvailabilityStatus.Focused].map((status) => (
          <button
            key={status}
            className={`status-btn ${status} ${currentUser.status === status ? 'active' : ''}`}
            onClick={() => onStatusChange(status)}
          >
            <span className={`status-dot ${status}`} />
            {status === AvailabilityStatus.Available ? 'Available' :
             status === AvailabilityStatus.Occupied ? 'Occupied' : 'Focus'}
          </button>
        ))}
      </div>

      {/* Active Timer Display */}
      {isTimerActive && (
        <div className="timer-display" style={{ margin: '12px 16px' }}>
          <div className="hstack" style={{ gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--zen-secondary-text)' }}>
              ⏱ {timerState.taskLabel}
            </span>
            {timerState.isPaused && (
              <span style={{ fontSize: 9, color: 'var(--status-occupied)', fontWeight: 700, letterSpacing: 1 }}>
                PAUSED
              </span>
            )}
          </div>
          <div className={`timer-time ${timerState.isPaused ? 'paused' : ''}`}>
            {formatTime(timerState.elapsed)}
          </div>
          <div className="timer-controls">
            {timerState.isPaused ? (
              <button className="btn btn-primary" onClick={() => window.zenstate.resumeTimer()}>
                ▶ Resume
              </button>
            ) : (
              <button className="btn btn-secondary" onClick={() => window.zenstate.pauseTimer()}>
                ⏸ Pause
              </button>
            )}
            <button className="btn btn-danger" onClick={() => window.zenstate.stopTimer()}>
              ■ Stop
            </button>
          </div>
        </div>
      )}

      {/* Presence Bar */}
      <div className="presence-bar">
        <div className="presence-track">
          <div className="presence-segment" style={{ width: `${(presenceCounts.available / presenceCounts.total) * 100}%`, background: 'var(--status-available)' }} />
          <div className="presence-segment" style={{ width: `${(presenceCounts.occupied / presenceCounts.total) * 100}%`, background: 'var(--status-occupied)' }} />
          <div className="presence-segment" style={{ width: `${(presenceCounts.focused / presenceCounts.total) * 100}%`, background: 'var(--status-focused)' }} />
        </div>
        <div className="presence-counts">
          <div className="presence-count">
            <span className="status-dot available" /> {presenceCounts.available} Available
          </div>
          <div className="presence-count">
            <span className="status-dot occupied" /> {presenceCounts.occupied} Occupied
          </div>
          <div className="presence-count">
            <span className="status-dot focused" /> {presenceCounts.focused} Focus
          </div>
          <div className="spacer" />
          <span style={{ color: 'var(--zen-tertiary-text)' }}>{presenceCounts.total} online</span>
        </div>
      </div>

      <div className="divider" style={{ margin: '0 16px' }} />

      {/* Search */}
      {peers.length > 3 && (
        <div style={{ padding: '4px 16px' }}>
          <input
            className="search-input"
            placeholder="🔍 Search team..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
        </div>
      )}

      {/* Team List */}
      <div className="team-list">
        {filteredPeers.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 20, color: 'var(--zen-tertiary-text)', fontSize: 12 }}>
            {peers.length === 0 ? 'No team members found on this network' : 'No matches'}
          </div>
        ) : (
          filteredPeers.map((peer) => (
            <div key={peer.id} className="team-member-row">
              <div className="member-avatar" style={{ background: peer.avatarColor || '#8E8E93' }}>
                {peer.avatarEmoji || '👤'}
              </div>
              <div className="member-info">
                <div className="member-name">{peer.name}</div>
                {peer.activeStatusMessage ? (
                  <div className="member-message">
                    💬 {peer.activeStatusMessage}
                  </div>
                ) : (
                  <div className="member-status-text" style={{ color: getStatusColor(peer.status) }}>
                    {peer.status}
                  </div>
                )}
              </div>
              <span className={`status-dot ${peer.status}`} />
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="footer">
        <div className="footer-utils">
          <button className="footer-icon-btn" onClick={() => onOpenSettings?.()} title="Settings">
            <Settings size={15} />
          </button>
          <button className="footer-icon-btn" onClick={() => setShowTimerInput(true)} title="Record Time">
            <Timer size={15} />
          </button>
        </div>
        <button className="footer-action-btn" onClick={() => window.zenstate.openDashboard()}>
          <LayoutDashboard size={13} />
          <span>Dashboard</span>
        </button>
        <button className="footer-quit-btn" onClick={() => window.zenstate.quit()}>
          Quit
        </button>
      </div>
    </div>
  );
}
