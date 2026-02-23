import React, { useState, useMemo, useEffect } from 'react';
import { Settings, Timer, LayoutDashboard, MessageCircle, Hourglass } from 'lucide-react';
import { User, AvailabilityStatus, IPC, FocusTemplate, AppSettings, DailyRecord, LicenseState } from '../../shared/types';

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
  targetDuration?: number;
  remaining?: number;
}

const REVERT_OPTIONS = [
  { label: '15m', seconds: 15 * 60 },
  { label: '30m', seconds: 30 * 60 },
  { label: '1h', seconds: 60 * 60 },
  { label: '2h', seconds: 2 * 60 * 60 },
  { label: 'None', seconds: 0 },
];

interface Props {
  currentUser: User;
  peers: User[];
  timerState: TimerState;
  statusRevertRemaining?: number;
  isPro: boolean;
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

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
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

function formatRevertTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0) return `${m}:${String(s).padStart(2, '0')}`;
  return `${s}s`;
}

export default function MenuBarView({ currentUser, peers, timerState, statusRevertRemaining, isPro, onStatusChange, onUserUpdate, onOpenSettings }: Props) {
  const [searchText, setSearchText] = useState('');
  const [showTimerInput, setShowTimerInput] = useState(false);
  const [timerTaskInput, setTimerTaskInput] = useState('');
  const [timerCategory, setTimerCategory] = useState('');
  const [timerMode, setTimerMode] = useState<'stopwatch' | 'countdown'>('stopwatch');
  const [selectedDuration, setSelectedDuration] = useState(25 * 60);
  const [customMinutes, setCustomMinutes] = useState('');
  const [showStatusMessage, setShowStatusMessage] = useState(false);
  const [statusMessageInput, setStatusMessageInput] = useState('');
  const [statusDuration, setStatusDuration] = useState(DURATION_OPTIONS[0]);
  const [pendingRequests, setPendingRequests] = useState<Record<string, boolean>>({});
  const [messagePopup, setMessagePopup] = useState<string | null>(null);
  const [messageText, setMessageText] = useState('');
  const [showRevertPicker, setShowRevertPicker] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [templates, setTemplates] = useState<FocusTemplate[]>([]);
  const [dailyGoalSeconds, setDailyGoalSeconds] = useState(0);
  const [todayTotal, setTodayTotal] = useState(0);

  useEffect(() => {
    (window as any).zenstate.getCategories?.().then((cats: string[]) => {
      setCategories(cats || []);
    }).catch(() => {});
    (window as any).zenstate.getTemplates?.().then((t: FocusTemplate[]) => {
      setTemplates(t || []);
    }).catch(() => {});
    (window as any).zenstate.getSettings?.().then((s: AppSettings) => {
      setDailyGoalSeconds(s?.dailyFocusGoalSeconds || 0);
    }).catch(() => {});
    (window as any).zenstate.getRecords?.().then((records: DailyRecord[]) => {
      const d = new Date();
      const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const todayRec = records?.find((r: DailyRecord) => r.date.startsWith(todayStr));
      setTodayTotal(todayRec?.totalFocusTime || 0);
    }).catch(() => {});

    // Listen for settings changes from dashboard
    (window as any).zenstate.on('settings:updated', (settings: unknown) => {
      const s = settings as AppSettings;
      setDailyGoalSeconds(s?.dailyFocusGoalSeconds || 0);
    });

    return () => {
      (window as any).zenstate.removeAllListeners?.('settings:updated');
    };
  }, []);

  // Clear pending request when peer responds (accept or decline)
  useEffect(() => {
    const handler = (data: unknown) => {
      const response = data as { accepted: boolean; from: string };
      // Find peer by name and clear their pending state
      const peer = peers.find((p) => p.name === response.from);
      if (peer) {
        setPendingRequests((prev) => {
          const { [peer.id]: _, ...rest } = prev;
          return rest;
        });
      }
    };
    window.zenstate.on(IPC.MEETING_RESPONSE, handler);
    return () => {
      window.zenstate.removeAllListeners(IPC.MEETING_RESPONSE);
    };
  }, [peers]);

  // Online peers only (hide offline)
  const onlinePeers = useMemo(() => {
    return peers.filter((p) => p.status !== AvailabilityStatus.Offline);
  }, [peers]);

  // Presence counts (online only)
  const presenceCounts = useMemo(() => {
    const all = [currentUser, ...onlinePeers];
    return {
      available: all.filter((u) => u.status === AvailabilityStatus.Available).length,
      occupied: all.filter((u) => u.status === AvailabilityStatus.Occupied).length,
      focused: all.filter((u) => u.status === AvailabilityStatus.Focused).length,
      total: all.length,
    };
  }, [currentUser, onlinePeers]);

  // Filtered team members
  const filteredPeers = useMemo(() => {
    if (!searchText) return onlinePeers;
    const q = searchText.toLowerCase();
    return onlinePeers.filter((p) => p.name.toLowerCase().includes(q) || p.username.toLowerCase().includes(q));
  }, [onlinePeers, searchText]);

  const isTimerActive = timerState.isRunning || timerState.isPaused;

  const MENU_DURATION_PRESETS = [
    { label: '15m', seconds: 15 * 60 },
    { label: '25m', seconds: 25 * 60 },
    { label: '45m', seconds: 45 * 60 },
    { label: '1h', seconds: 60 * 60 },
  ];

  function handleStartTimer() {
    if (!timerCategory) return;
    const label = timerTaskInput.trim() || timerCategory;
    const target = timerMode === 'countdown' ? selectedDuration : undefined;
    window.zenstate.startTimer(label, timerCategory, target);
    setTimerTaskInput('');
    setTimerCategory('');
    setCustomMinutes('');
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

  function handleSendRequest(userId: string, message?: string) {
    window.zenstate.sendMeetingRequest(userId, message);
    setPendingRequests((prev) => ({ ...prev, [userId]: true }));
    setMessagePopup(null);
    setMessageText('');
  }

  function handleSendEmergencyRequest(userId: string) {
    window.zenstate.sendEmergencyRequest(userId);
    setPendingRequests((prev) => ({ ...prev, [userId]: true }));
  }

  function handleCancelRequest(userId: string) {
    window.zenstate.cancelMeetingRequest(userId);
    setPendingRequests((prev) => {
      const { [userId]: _, ...rest } = prev;
      return rest;
    });
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
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="hstack" style={{ gap: 8 }}>
            <button className="footer-btn" onClick={() => setShowTimerInput(false)}>
              ‹ Back
            </button>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Record Time</span>
          </div>

          <input
            className="text-input"
            placeholder="Task name (optional)"
            value={timerTaskInput}
            onChange={(e) => setTimerTaskInput(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleStartTimer();
            }}
          />

          {/* Focus Templates (Pro only) */}
          {templates.length > 0 && isPro && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--zen-secondary-text)', marginBottom: 4 }}>Templates</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {templates.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      window.zenstate.startTimer(t.name, t.category, t.defaultDuration);
                      setShowTimerInput(false);
                    }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '3px 10px',
                      borderRadius: 14,
                      background: 'var(--zen-secondary-bg)',
                      border: '1px solid var(--zen-divider)',
                      cursor: 'pointer',
                      fontSize: 10,
                      color: 'var(--zen-text)',
                      fontFamily: 'inherit',
                      transition: 'background 0.15s ease, border-color 0.15s ease',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--zen-hover)'; e.currentTarget.style.borderColor = 'var(--zen-primary)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--zen-secondary-bg)'; e.currentTarget.style.borderColor = 'var(--zen-divider)'; }}
                  >
                    <span style={{ fontWeight: 500 }}>{t.name}</span>
                    <span style={{ color: 'var(--zen-tertiary-text)' }}>{formatDuration(t.defaultDuration)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Category Picker */}
          <div>
            <div style={{ fontSize: 11, color: 'var(--zen-secondary-text)', marginBottom: 4 }}>Category</div>
            <div className="category-picker">
              {categories.map((cat) => (
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

          {/* Mode Toggle */}
          <div style={{ display: 'flex', gap: 4, background: 'var(--zen-tertiary-bg)', borderRadius: 6, padding: 2 }}>
            <button
              style={{
                flex: 1, padding: '4px 0', fontSize: 10, fontWeight: 600, borderRadius: 4,
                border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                background: timerMode === 'stopwatch' ? 'var(--zen-primary)' : 'transparent',
                color: timerMode === 'stopwatch' ? 'white' : 'var(--zen-secondary-text)',
              }}
              onClick={() => setTimerMode('stopwatch')}
            >
              Stopwatch
            </button>
            <button
              style={{
                flex: 1, padding: '4px 0', fontSize: 10, fontWeight: 600, borderRadius: 4,
                border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                background: timerMode === 'countdown' ? 'var(--zen-primary)' : 'transparent',
                color: timerMode === 'countdown' ? 'white' : 'var(--zen-secondary-text)',
              }}
              onClick={() => setTimerMode('countdown')}
            >
              <Hourglass size={10} style={{ marginRight: 2, verticalAlign: 'middle' }} /> Countdown
            </button>
          </div>

          {/* Duration Picker (countdown mode) */}
          {timerMode === 'countdown' && (
            <div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {MENU_DURATION_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    className={`category-chip ${selectedDuration === preset.seconds ? 'selected' : ''}`}
                    onClick={() => { setSelectedDuration(preset.seconds); setCustomMinutes(''); }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 4, marginTop: 6, alignItems: 'center' }}>
                <input
                  className="text-input"
                  placeholder="Custom..."
                  type="number"
                  min="1"
                  value={customMinutes}
                  onChange={(e) => {
                    setCustomMinutes(e.target.value);
                    const mins = parseInt(e.target.value);
                    if (mins > 0) setSelectedDuration(mins * 60);
                  }}
                  style={{ flex: 1, fontSize: 11 }}
                />
                <span style={{ fontSize: 10, color: 'var(--zen-tertiary-text)' }}>min</span>
              </div>
            </div>
          )}

          <div className="hstack" style={{ gap: 8 }}>
            <button
              className="btn btn-secondary"
              onClick={() => { setShowTimerInput(false); setTimerTaskInput(''); setTimerCategory(''); setCustomMinutes(''); }}
            >
              Cancel
            </button>
            <div className="spacer" />
            <button
              className="btn btn-primary"
              onClick={handleStartTimer}
              disabled={!timerCategory}
            >
              {timerMode === 'countdown' ? `Start ${formatDuration(selectedDuration)}` : 'Start'}
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
          {currentUser.avatarImageData ? (
            <img src={`data:image/png;base64,${currentUser.avatarImageData}`} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
          ) : currentUser.avatarEmoji ? (
            <span>{currentUser.avatarEmoji}</span>
          ) : (
            <span style={{ fontSize: 16, fontWeight: 600, color: 'white' }}>{currentUser.name.charAt(0).toUpperCase()}</span>
          )}
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
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><MessageCircle size={12} /> {currentUser.activeStatusMessage}</span>
        ) : (
          <span style={{ color: 'var(--zen-tertiary-text)' }}>+ Set a status message...</span>
        )}
      </div>

      {/* Status Picker — compact */}
      <div className="status-picker">
        {[AvailabilityStatus.Available, AvailabilityStatus.Occupied, AvailabilityStatus.Focused].map((status) => (
          <button
            key={status}
            className={`status-btn ${status} ${currentUser.status === status ? 'active' : ''}`}
            onClick={() => {
              if (status === AvailabilityStatus.Occupied || status === AvailabilityStatus.Focused) {
                onStatusChange(status);
                setShowRevertPicker(true);
              } else {
                onStatusChange(status);
                setShowRevertPicker(false);
                (window as any).zenstate.cancelStatusRevert?.();
              }
            }}
          >
            <span className={`status-dot ${status}`} />
            {status === AvailabilityStatus.Available ? 'Available' :
             status === AvailabilityStatus.Occupied ? 'Occupied' : 'Focus'}
          </button>
        ))}
      </div>

      {/* Revert picker (Pro only) */}
      {showRevertPicker && isPro && (
        <div style={{ padding: '4px 16px 0', display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 9, color: 'var(--zen-tertiary-text)' }}>Revert after:</span>
          {REVERT_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              className="category-chip"
              style={{ fontSize: 9, padding: '1px 6px' }}
              onClick={() => {
                if (opt.seconds > 0) {
                  (window as any).zenstate.setStatusRevert?.(opt.seconds);
                } else {
                  (window as any).zenstate.cancelStatusRevert?.();
                }
                setShowRevertPicker(false);
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {/* Status revert countdown */}
      {statusRevertRemaining !== undefined && statusRevertRemaining > 0 && !showRevertPicker && (
        <div style={{
          padding: '2px 16px',
          fontSize: 9,
          color: 'var(--zen-secondary-text)',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}>
          <span>⏱ Reverting in {formatRevertTime(statusRevertRemaining)}</span>
          <button
            onClick={() => (window as any).zenstate.cancelStatusRevert?.()}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--zen-tertiary-text)', fontSize: 9, fontFamily: 'inherit', padding: 0,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Active Timer Display — single row */}
      {isTimerActive && (
        <div className="timer-display" style={{ margin: '6px 16px', padding: '6px 12px' }}>
          <div className="hstack" style={{ gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--zen-secondary-text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>
              {timerState.targetDuration ? <Hourglass size={11} /> : <Timer size={11} />} {timerState.taskLabel}
            </span>
            <div className={`timer-time ${timerState.isPaused ? 'paused' : ''}`} style={{ fontSize: 14, flexShrink: 0 }}>
              {timerState.targetDuration ? formatTime(timerState.remaining ?? 0) : formatTime(timerState.elapsed)}
            </div>
            {timerState.isPaused ? (
              <button className="btn btn-primary" style={{ fontSize: 10, padding: '2px 6px', flexShrink: 0 }} onClick={() => window.zenstate.resumeTimer()}>
                Resume
              </button>
            ) : (
              <button className="btn btn-secondary" style={{ fontSize: 10, padding: '2px 6px', background: 'rgba(255,149,0,0.15)', color: 'var(--status-occupied)', border: '1px solid rgba(255,149,0,0.3)', flexShrink: 0 }} onClick={() => window.zenstate.pauseTimer()}>
                Pause
              </button>
            )}
            <button className="btn btn-danger" style={{ fontSize: 10, padding: '2px 6px', flexShrink: 0 }} onClick={() => window.zenstate.stopTimer()}>
              Stop
            </button>
          </div>
          {/* Progress bar for countdown in menu bar */}
          {timerState.targetDuration && (
            <div style={{ height: 2, borderRadius: 1, background: 'var(--zen-tertiary-bg)', marginTop: 6, overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 1,
                background: timerState.isPaused ? 'var(--status-occupied)' : 'var(--zen-primary)',
                width: `${Math.min(100, (timerState.elapsed / timerState.targetDuration) * 100)}%`,
                transition: 'width 1s linear',
              }} />
            </div>
          )}
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
            <span className="status-dot available" /> {presenceCounts.available}
          </div>
          <div className="presence-count">
            <span className="status-dot occupied" /> {presenceCounts.occupied}
          </div>
          <div className="presence-count">
            <span className="status-dot focused" /> {presenceCounts.focused}
          </div>
          <div className="spacer" />
          <span style={{ color: 'var(--zen-tertiary-text)' }}>{presenceCounts.total} online</span>
        </div>
      </div>

      <div className="divider" style={{ margin: '0 16px' }} />

      {/* Search */}
      {onlinePeers.length > 3 && (
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
            {onlinePeers.length === 0 ? 'No team members online' : 'No matches'}
          </div>
        ) : (
          filteredPeers.map((peer) => (
            <div key={peer.id}>
              <div className="team-member-row">
                <div className="member-avatar" style={{ background: peer.avatarColor || '#8E8E93' }}>
                  {peer.avatarImageData ? (
                    <img src={`data:image/png;base64,${peer.avatarImageData}`} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
                  ) : peer.avatarEmoji ? (
                    peer.avatarEmoji
                  ) : (
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'white' }}>{peer.name.charAt(0).toUpperCase()}</span>
                  )}
                </div>
                <div className="member-info">
                  <div className="member-name">{peer.name}</div>
                  {peer.activeStatusMessage ? (
                    <div className="member-message">
                      <MessageCircle size={10} /> {peer.activeStatusMessage}
                    </div>
                  ) : (
                    <div className="member-status-text" style={{ color: getStatusColor(peer.status) }}>
                      {peer.status}
                    </div>
                  )}
                </div>
                {pendingRequests[peer.id] ? (
                  <button
                    className="btn btn-secondary"
                    style={{ fontSize: 9, padding: '2px 6px', flexShrink: 0 }}
                    onClick={() => handleCancelRequest(peer.id)}
                  >
                    Cancel
                  </button>
                ) : peer.status === AvailabilityStatus.Focused ? (
                  (currentUser.canSendEmergency || currentUser.isAdmin) ? (
                    <button
                      className="btn btn-danger"
                      style={{ fontSize: 9, padding: '2px 6px', flexShrink: 0 }}
                      onClick={() => handleSendEmergencyRequest(peer.id)}
                    >
                      🚨 Urgent
                    </button>
                  ) : null
                ) : (
                  <button
                    className={messagePopup === peer.id ? 'btn btn-danger' : 'btn btn-primary'}
                    style={{ fontSize: 9, padding: '2px 6px', flexShrink: 0 }}
                    onClick={() => {
                      setMessagePopup(messagePopup === peer.id ? null : peer.id);
                      setMessageText('');
                    }}
                  >
                    {messagePopup === peer.id ? 'Close' : 'Request'}
                  </button>
                )}
                <span className={`status-dot ${peer.status}`} />
              </div>
              {/* Meeting request message popup */}
              {messagePopup === peer.id && (
                <div style={{
                  margin: '4px 12px 8px',
                  padding: 10,
                  background: 'var(--zen-tertiary-bg)',
                  borderRadius: 8,
                  border: '1px solid var(--zen-divider)',
                }}>
                  <input
                    className="text-input"
                    placeholder="Add a message (optional)..."
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleSendRequest(peer.id, messageText || undefined);
                      }
                      if (e.key === 'Escape') {
                        setMessagePopup(null);
                        setMessageText('');
                      }
                    }}
                    style={{ fontSize: 11, marginBottom: 6 }}
                  />
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: 9, padding: '2px 8px' }}
                      onClick={() => {
                        handleSendRequest(peer.id);
                      }}
                    >
                      Skip
                    </button>
                    <button
                      className="btn btn-primary"
                      style={{ fontSize: 9, padding: '2px 8px' }}
                      onClick={() => {
                        handleSendRequest(peer.id, messageText || undefined);
                      }}
                    >
                      Send
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="footer">
        <div className="footer-utils">
          <button className="footer-icon-btn" onClick={() => window.zenstate.openDashboard('settings')} title="Settings">
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
