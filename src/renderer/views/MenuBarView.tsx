import React, { useState, useMemo, useEffect } from 'react';
import { Settings, LayoutDashboard, MessageCircle, Hourglass, Briefcase, Play, Megaphone, X } from 'lucide-react';
import { User, AvailabilityStatus, IPC, LicenseState, TodayPlan, PinnedTodo, ReceivedPing } from '../../shared/types';
import SendPingSheet from '../components/SendPingSheet';

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
  onOpenProjects?: () => void;
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

// "5m ago", "1h ago", "yesterday" — for short relative timestamps in the
// recent-pings list. Anything older than 24h shouldn't appear (TTL cleanup
// in main process), but defensive fallback included.
function formatRelative(iso: string): string {
  const ago = (Date.now() - new Date(iso).getTime()) / 1000;
  if (ago < 60) return 'just now';
  if (ago < 3600) return `${Math.round(ago / 60)}m ago`;
  if (ago < 86400) return `${Math.round(ago / 3600)}h ago`;
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function MenuBarView({ currentUser, peers, timerState, statusRevertRemaining, isPro, onStatusChange, onUserUpdate, onOpenSettings, onOpenProjects }: Props) {
  const [searchText, setSearchText] = useState('');
  const [showStatusMessage, setShowStatusMessage] = useState(false);
  const [statusMessageInput, setStatusMessageInput] = useState('');
  const [statusDuration, setStatusDuration] = useState(DURATION_OPTIONS[0]);
  const [pendingRequests, setPendingRequests] = useState<Record<string, boolean>>({});
  const [messagePopup, setMessagePopup] = useState<string | null>(null);
  const [messageText, setMessageText] = useState('');
  const [showRevertPicker, setShowRevertPicker] = useState(false);
  const [todayPlan, setTodayPlan] = useState<TodayPlan | null>(null);
  // Two modes for the popover body: "today" (your plan) vs "team" (peer presence).
  // Default to Today since that's the daily-ritual surface. A useEffect below
  // falls through to Team on first open if there are no pinned to-dos but peers
  // are around.
  const [popoverTab, setPopoverTab] = useState<'today' | 'team'>('today');
  const [tabAutoChosen, setTabAutoChosen] = useState(false);
  const [showPingSheet, setShowPingSheet] = useState(false);
  const [recentPings, setRecentPings] = useState<ReceivedPing[]>([]);

  // Load Today's plan and stay subscribed to changes so the popover shows
  // pinned to-dos as soon as the user pins/unpins from the Dashboard.
  useEffect(() => {
    (window as any).zenstate.todayGet?.().then((res: { plan: TodayPlan }) => setTodayPlan(res?.plan ?? null)).catch(() => {});
    const onChanged = (...args: unknown[]) => setTodayPlan(args[0] as TodayPlan);
    window.zenstate.on('today:changed', onChanged);
    return () => { window.zenstate.removeAllListeners('today:changed'); };
  }, []);

  // First-load default: if Today is empty but peers are around, open on Team.
  // After the user has manually picked a tab, we leave their choice alone.
  useEffect(() => {
    if (tabAutoChosen) return;
    if (!todayPlan) return; // still loading
    if (todayPlan.items.length === 0 && peers.length > 0) {
      setPopoverTab('team');
    }
    setTabAutoChosen(true);
  }, [todayPlan, peers.length, tabAutoChosen]);

  // Recent received pings — load on mount and stay subscribed for new ones.
  useEffect(() => {
    window.zenstate.teamGetRecentPings().then(setRecentPings).catch(() => {});
    const onPing = (...args: unknown[]) => {
      const ping = args[0] as ReceivedPing;
      setRecentPings((prev) => [ping, ...prev].slice(0, 20));
    };
    window.zenstate.on(IPC.TEAM_PING_RECEIVED, onPing);
    return () => { window.zenstate.removeAllListeners(IPC.TEAM_PING_RECEIVED); };
  }, []);

  async function dismissPing(id: string) {
    const next = await window.zenstate.teamDismissPing(id).catch(() => null);
    if (next) setRecentPings(next);
  }

  function handleStartFromPinned(p: PinnedTodo) {
    window.zenstate.startTimer(p.content, undefined, undefined, {
      accountId: p.accountId,
      projectId: p.projectId,
      todoId: p.todoId,
      todoListId: p.todoListId,
      projectName: p.projectName,
    });
  }

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

      {/* Tab bar — segmented control switching the body between Today and Team.
          Status (above) applies to both modes globally; the active timer banner (above)
          stays visible across tabs as important context. */}
      <div style={{ padding: '8px 16px 4px' }}>
        <div style={{
          display: 'flex',
          background: 'var(--zen-tertiary-bg)',
          border: '1px solid var(--zen-divider)',
          borderRadius: 'var(--radius-sm)',
          padding: 2,
          gap: 2,
        }}>
          <button
            onClick={() => setPopoverTab('today')}
            style={{
              flex: 1,
              padding: '5px 0',
              borderRadius: 6,
              border: 'none',
              background: popoverTab === 'today' ? 'rgba(10, 132, 255, 0.16)' : 'transparent',
              color: popoverTab === 'today' ? 'var(--zen-primary)' : 'var(--zen-secondary-text)',
              fontSize: 'var(--text-sm)',
              fontWeight: 600,
              fontFamily: 'inherit',
              cursor: 'pointer',
              transition: 'background var(--duration-quick) var(--ease-standard), color var(--duration-quick) var(--ease-standard)',
            }}
          >
            Today{todayPlan && todayPlan.items.length > 0 ? ` · ${todayPlan.items.length}` : ''}
          </button>
          <button
            onClick={() => setPopoverTab('team')}
            style={{
              flex: 1,
              padding: '5px 0',
              borderRadius: 6,
              border: 'none',
              background: popoverTab === 'team' ? 'rgba(10, 132, 255, 0.16)' : 'transparent',
              color: popoverTab === 'team' ? 'var(--zen-primary)' : 'var(--zen-secondary-text)',
              fontSize: 'var(--text-sm)',
              fontWeight: 600,
              fontFamily: 'inherit',
              cursor: 'pointer',
              transition: 'background var(--duration-quick) var(--ease-standard), color var(--duration-quick) var(--ease-standard)',
            }}
          >
            Team{presenceCounts.total > 0 ? ` · ${presenceCounts.total}` : ''}
          </button>
        </div>
      </div>

      {/* TODAY tab content */}
      {popoverTab === 'today' && (
      <>
      {todayPlan && todayPlan.items.length > 0 ? (
        <div style={{ padding: '6px 16px 0', flex: 1, overflowY: 'auto' }}>
          {todayPlan.items.length > 3 && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
              <button
                onClick={() => { window.zenstate.openDashboard('today'); window.zenstate.closePopover(); }}
                style={{ background: 'transparent', border: 'none', color: 'var(--zen-tertiary-text)', fontSize: 'var(--text-xs)', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}
              >
                +{todayPlan.items.length - 3} more in Dashboard →
              </button>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {todayPlan.items.slice(0, 3).map((p) => {
              const running = isTimerActive && timerState.taskLabel === p.content;
              return (
                <div
                  key={p.todoId}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 10px',
                    borderRadius: 'var(--radius-sm)',
                    background: running ? 'rgba(48, 209, 88, 0.08)' : 'var(--zen-tertiary-bg)',
                    border: `1px solid ${running ? 'rgba(48, 209, 88, 0.25)' : 'var(--zen-divider)'}`,
                    transition: 'background var(--duration-quick) var(--ease-standard)',
                  }}
                >
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: running ? 'var(--status-available)' : 'transparent',
                    border: running ? 'none' : '1.5px solid var(--zen-tertiary-text)',
                    flexShrink: 0,
                    boxShadow: running ? '0 0 6px rgba(48, 209, 88, 0.5)' : 'none',
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--zen-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.content}
                    </div>
                    {p.projectName && (
                      <div style={{ fontSize: 10, color: 'var(--zen-tertiary-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
                        {p.projectName}
                      </div>
                    )}
                  </div>
                  {running ? (
                    <button onClick={() => window.zenstate.stopTimer()} title="Stop"
                      style={{ background: 'rgba(255,149,0,0.18)', border: '1px solid rgba(255,149,0,0.32)', color: 'var(--status-occupied)', cursor: 'pointer', padding: '4px 9px', borderRadius: 6, fontSize: 10, fontWeight: 600, fontFamily: 'inherit', flexShrink: 0 }}>
                      Stop
                    </button>
                  ) : (
                    <button onClick={() => handleStartFromPinned(p)} title="Start timer"
                      disabled={isTimerActive}
                      style={{ background: 'var(--zen-primary)', border: 'none', color: 'white', cursor: isTimerActive ? 'not-allowed' : 'pointer', opacity: isTimerActive ? 0.4 : 1, padding: '4px 9px', borderRadius: 6, fontSize: 10, fontWeight: 600, fontFamily: 'inherit', flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      <Play size={9} /> Start
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div style={{ padding: '24px 16px', textAlign: 'center', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <Briefcase size={20} style={{ color: 'var(--zen-tertiary-text)' }} />
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--zen-secondary-text)', lineHeight: 'var(--leading-relaxed)', maxWidth: 240 }}>
            No to-dos pinned for today.<br />Plan your day in the Dashboard.
          </div>
          <button
            className="btn btn-secondary"
            style={{ fontSize: 'var(--text-sm)' }}
            onClick={() => { window.zenstate.openDashboard('today'); window.zenstate.closePopover(); }}
          >
            Open Today
          </button>
        </div>
      )}
      </>
      )}

      {/* TEAM tab content */}
      {popoverTab === 'team' && (
      <>
      {/* Recent pings — shown above the presence bar so users catching up see
          what they missed first. Auto-clears server-side after 6h. */}
      {recentPings.length > 0 && (
        <div style={{ padding: '6px 16px 0' }}>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--zen-tertiary-text)', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600, marginBottom: 6 }}>
            Recent pings
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 140, overflowY: 'auto' }}>
            {recentPings.slice(0, 5).map((p) => (
              <div key={p.id} style={{
                display: 'flex', alignItems: 'flex-start', gap: 8,
                padding: '7px 10px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--zen-tertiary-bg)',
                border: '1px solid var(--zen-divider)',
              }}>
                <Megaphone size={11} style={{ color: 'var(--zen-primary)', flexShrink: 0, marginTop: 2 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 'var(--text-sm)', color: 'var(--zen-text)', lineHeight: 1.35 }}>{p.message}</div>
                  <div style={{ fontSize: 10, color: 'var(--zen-tertiary-text)', marginTop: 2, display: 'flex', gap: 6 }}>
                    <span>{p.senderName}</span>
                    <span>·</span>
                    <span>{formatRelative(p.timestamp)}</span>
                  </div>
                </div>
                <button
                  onClick={() => dismissPing(p.id)}
                  title="Dismiss"
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--zen-tertiary-text)', display: 'flex', padding: 2, borderRadius: 4, flexShrink: 0 }}
                  onMouseEnter={(e) => e.currentTarget.style.color = 'var(--zen-text)'}
                  onMouseLeave={(e) => e.currentTarget.style.color = 'var(--zen-tertiary-text)'}
                >
                  <X size={11} />
                </button>
              </div>
            ))}
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
      </>
      )}

      {/* Footer */}
      <div className="footer">
        <div className="footer-utils">
          <button className="footer-icon-btn" onClick={() => window.zenstate.openDashboard('settings')} title="Settings">
            <Settings size={15} />
          </button>
          {onOpenProjects && (
            <button className="footer-icon-btn" onClick={onOpenProjects} title="Projects">
              <Briefcase size={15} />
            </button>
          )}
          <button className="footer-icon-btn" onClick={() => setShowPingSheet(true)} title="Send a quick heads-up to teammates">
            <Megaphone size={15} />
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

      {/* Send Ping sheet — opens above the popover content. The peer list passed
          here is the full discovered set (online + recently offline) so users
          can include offline teammates in groups; only currently-connected peers
          actually receive the ping. */}
      {showPingSheet && (
        <SendPingSheet peers={peers} onClose={() => setShowPingSheet(false)} />
      )}
    </div>
  );
}
