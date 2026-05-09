import React, { useState, useMemo, useEffect } from 'react';
import { Megaphone, X } from 'lucide-react';
import { User, AvailabilityStatus, IPC, ReceivedPing } from '../../../shared/types';
import SendPingSheet from '../../components/SendPingSheet';

interface Props {
  currentUser: User;
  peers: User[];
}

function getStatusColor(status: AvailabilityStatus): string {
  switch (status) {
    case AvailabilityStatus.Available: return 'var(--status-available)';
    case AvailabilityStatus.Occupied: return 'var(--status-occupied)';
    case AvailabilityStatus.Focused: return 'var(--status-focused)';
    default: return 'var(--status-offline)';
  }
}

function getStatusLabel(status: AvailabilityStatus): string {
  switch (status) {
    case AvailabilityStatus.Available: return 'Available';
    case AvailabilityStatus.Occupied: return 'Occupied';
    case AvailabilityStatus.Focused: return 'Focus Mode';
    default: return 'Offline';
  }
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function TeamTab({ currentUser, peers }: Props) {
  const [searchText, setSearchText] = useState('');
  const [pendingRequests, setPendingRequests] = useState<Record<string, boolean>>({});
  const [cooldowns, setCooldowns] = useState<Record<string, number>>({});
  const [sentConfirms, setSentConfirms] = useState<Record<string, boolean>>({});
  const [messagePopup, setMessagePopup] = useState<string | null>(null);
  const [messageText, setMessageText] = useState('');
  const [showPingSheet, setShowPingSheet] = useState(false);
  const [recentPings, setRecentPings] = useState<ReceivedPing[]>([]);

  useEffect(() => {
    let pingArrived = false;
    const off = window.zenstate.on(IPC.TEAM_PING_RECEIVED, (...args: unknown[]) => {
      pingArrived = true;
      setRecentPings((prev) => [args[0] as ReceivedPing, ...prev].slice(0, 50));
    });
    window.zenstate.teamGetRecentPings().then((initial) => {
      if (!pingArrived) setRecentPings(initial);
    }).catch(() => {});
    return off;
  }, []);

  async function dismissPing(id: string) {
    const next = await window.zenstate.teamDismissPing(id).catch(() => null);
    if (next) setRecentPings(next);
  }

  function formatRelativeTs(iso: string): string {
    const ago = (Date.now() - new Date(iso).getTime()) / 1000;
    if (ago < 60) return 'just now';
    if (ago < 3600) return `${Math.round(ago / 60)}m ago`;
    if (ago < 86400) return `${Math.round(ago / 3600)}h ago`;
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  // Clear pending request when peer responds (accept or decline)
  useEffect(() => {
    return window.zenstate.on(IPC.MEETING_RESPONSE, (data: unknown) => {
      const response = data as { accepted: boolean; from: string };
      const peer = peers.find((p) => p.name === response.from);
      if (peer) {
        setPendingRequests((prev) => {
          const { [peer.id]: _, ...rest } = prev;
          return rest;
        });
      }
    });
  }, [peers]);

  // Online peers only (hide offline)
  const onlinePeers = useMemo(() => {
    return peers.filter((p) => p.status !== AvailabilityStatus.Offline);
  }, [peers]);

  const allMembers = useMemo(() => [currentUser, ...onlinePeers], [currentUser, onlinePeers]);

  const filteredMembers = useMemo(() => {
    if (!searchText) return onlinePeers;
    const q = searchText.toLowerCase();
    return onlinePeers.filter(
      (p) => p.name.toLowerCase().includes(q) || p.username.toLowerCase().includes(q)
    );
  }, [onlinePeers, searchText]);

  const presenceCounts = useMemo(() => ({
    available: allMembers.filter((u) => u.status === AvailabilityStatus.Available).length,
    occupied: allMembers.filter((u) => u.status === AvailabilityStatus.Occupied).length,
    focused: allMembers.filter((u) => u.status === AvailabilityStatus.Focused).length,
    total: allMembers.length,
  }), [allMembers]);

  function handleSendRequest(userId: string, message?: string) {
    window.zenstate.sendMeetingRequest(userId, message);
    setPendingRequests((prev) => ({ ...prev, [userId]: true }));
    setSentConfirms((prev) => ({ ...prev, [userId]: true }));
    setTimeout(() => {
      setSentConfirms((prev) => ({ ...prev, [userId]: false }));
    }, 1500);

    // Start cooldown
    setCooldowns((prev) => ({ ...prev, [userId]: 30 }));
    const interval = setInterval(() => {
      setCooldowns((prev) => {
        const remaining = (prev[userId] || 0) - 1;
        if (remaining <= 0) {
          clearInterval(interval);
          const { [userId]: _, ...rest } = prev;
          return rest;
        }
        return { ...prev, [userId]: remaining };
      });
    }, 1000);
  }

  function handleCancelRequest(userId: string) {
    window.zenstate.cancelMeetingRequest(userId);
    setPendingRequests((prev) => {
      const { [userId]: _, ...rest } = prev;
      return rest;
    });
  }

  function handleSendEmergency(userId: string) {
    window.zenstate.sendEmergencyRequest(userId);
    setCooldowns((prev) => ({ ...prev, [`emergency_${userId}`]: 60 }));
    const interval = setInterval(() => {
      setCooldowns((prev) => {
        const key = `emergency_${userId}`;
        const remaining = (prev[key] || 0) - 1;
        if (remaining <= 0) {
          clearInterval(interval);
          const { [key]: _, ...rest } = prev;
          return rest;
        }
        return { ...prev, [key]: remaining };
      });
    }, 1000);
  }

  return (
    <div className="fade-in">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Team</h1>
        <span style={{
          fontSize: 11,
          padding: '2px 8px',
          borderRadius: 10,
          background: 'var(--zen-secondary-bg)',
          color: 'var(--zen-secondary-text)',
        }}>
          {presenceCounts.total} online
        </span>
        <div className="spacer" style={{ flex: 1 }} />
        <button
          className="btn btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          onClick={() => setShowPingSheet(true)}
          title="Send a quick heads-up to teammates"
        >
          <Megaphone size={14} /> Send a heads-up
        </button>
      </div>

      {/* Recent pings — show all (scrollable in the card), with the sender's
          avatar colour as a tint on the left edge so it's easy to skim by who. */}
      {recentPings.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10, color: 'var(--zen-text)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Megaphone size={13} style={{ color: 'var(--zen-primary)' }} /> Recent pings
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto' }}>
            {recentPings.map((p) => {
              const sender = peers.find((peer) => peer.id === p.senderId);
              const avatarColor = sender?.avatarColor || '#8E8E93';
              const initial = (sender?.name || p.senderName).charAt(0).toUpperCase();
              return (
              <div key={p.id} style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                padding: '10px 12px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--zen-tertiary-bg)',
                border: '1px solid var(--zen-divider)',
              }}>
                {/* Sender avatar — uses peer color if known, falls back to grey */}
                <div style={{
                  width: 26, height: 26, borderRadius: '50%',
                  background: avatarColor,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                  fontSize: 12, fontWeight: 600, color: 'white',
                  overflow: 'hidden',
                }}>
                  {sender?.avatarImageData ? (
                    <img src={`data:image/png;base64,${sender.avatarImageData}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : sender?.avatarEmoji ? (
                    <span style={{ fontSize: 14 }}>{sender.avatarEmoji}</span>
                  ) : (
                    initial
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--zen-text)', lineHeight: 1.4 }}>{p.message}</div>
                  <div style={{ fontSize: 11, color: 'var(--zen-tertiary-text)', marginTop: 3, display: 'flex', gap: 6 }}>
                    <span style={{ fontWeight: 500, color: 'var(--zen-secondary-text)' }}>{p.senderName}</span>
                    <span>·</span>
                    <span>{formatRelativeTs(p.timestamp)}</span>
                  </div>
                </div>
                <button
                  onClick={() => dismissPing(p.id)}
                  title="Dismiss"
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--zen-tertiary-text)', display: 'flex', padding: 4, borderRadius: 4 }}
                  onMouseEnter={(e) => e.currentTarget.style.color = 'var(--zen-text)'}
                  onMouseLeave={(e) => e.currentTarget.style.color = 'var(--zen-tertiary-text)'}
                >
                  <X size={13} />
                </button>
              </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Presence Summary */}
      <div className="card" style={{ display: 'flex', gap: 24, padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="status-dot available" />
          <span style={{ fontSize: 12, color: 'var(--zen-secondary-text)' }}>{presenceCounts.available} Available</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="status-dot occupied" />
          <span style={{ fontSize: 12, color: 'var(--zen-secondary-text)' }}>{presenceCounts.occupied} Occupied</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="status-dot focused" />
          <span style={{ fontSize: 12, color: 'var(--zen-secondary-text)' }}>{presenceCounts.focused} Focused</span>
        </div>
      </div>

      {/* Search */}
      {onlinePeers.length > 3 && (
        <div style={{ marginBottom: 16 }}>
          <input
            className="text-input"
            placeholder="🔍 Search team members..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
        </div>
      )}

      {/* Team Grid */}
      <div className="team-grid">
        {filteredMembers.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--zen-tertiary-text)' }}>
            {onlinePeers.length === 0 ? 'No team members online' : 'No matches'}
          </div>
        ) : (
          filteredMembers.map((peer) => (
            <div key={peer.id} className="card team-card">
              {/* Avatar + Status */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <div style={{
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  background: peer.avatarColor || '#8E8E93',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 22,
                  position: 'relative',
                }}>
                  <div style={{
                    position: 'absolute',
                    inset: -3,
                    borderRadius: '50%',
                    border: `2.5px solid ${getStatusColor(peer.status)}`,
                  }} />
                  {peer.avatarImageData ? (
                    <img src={`data:image/png;base64,${peer.avatarImageData}`} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
                  ) : peer.avatarEmoji ? (
                    peer.avatarEmoji
                  ) : (
                    <span style={{ fontSize: 16, fontWeight: 600, color: 'white' }}>{peer.name.charAt(0).toUpperCase()}</span>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {peer.name}
                  </div>
                  <div style={{ fontSize: 11, color: getStatusColor(peer.status) }}>
                    ● {getStatusLabel(peer.status)}
                  </div>
                </div>
              </div>

              {/* Active session or status message */}
              {peer.currentFocusSession ? (
                <div style={{
                  fontSize: 11,
                  color: 'var(--zen-secondary-text)',
                  padding: '6px 8px',
                  background: 'var(--zen-tertiary-bg)',
                  borderRadius: 6,
                  marginBottom: 8,
                }}>
                  🎯 {peer.currentFocusSession.taskLabel}
                  <span style={{ float: 'right', fontFamily: 'var(--font-mono)', fontSize: 10 }}>
                    {formatDuration(peer.currentFocusSession.duration)}
                  </span>
                </div>
              ) : peer.activeStatusMessage ? (
                <div style={{
                  fontSize: 11,
                  color: 'var(--zen-secondary-text)',
                  padding: '6px 8px',
                  background: 'var(--zen-tertiary-bg)',
                  borderRadius: 6,
                  marginBottom: 8,
                }}>
                  💬 {peer.activeStatusMessage}
                </div>
              ) : (
                <div style={{
                  fontSize: 10,
                  color: 'var(--zen-tertiary-text)',
                  marginBottom: 8,
                }}>
                  Total focus: {formatDuration(peer.totalFocusTime)}
                </div>
              )}

              {/* Actions */}
              <div style={{ display: 'flex', gap: 6 }}>
                {pendingRequests[peer.id] ? (
                  <button
                    className="btn btn-secondary"
                    style={{ flex: 1, fontSize: 10 }}
                    onClick={() => handleCancelRequest(peer.id)}
                  >
                    {sentConfirms[peer.id] ? '✓ Sent!' : 'Cancel Request'}
                  </button>
                ) : cooldowns[peer.id] ? (
                  <button
                    className="btn btn-secondary"
                    style={{ flex: 1, fontSize: 10 }}
                    disabled
                  >
                    Wait {cooldowns[peer.id]}s
                  </button>
                ) : peer.status === AvailabilityStatus.Focused ? (
                  // Focused users: only show emergency button for authorized users
                  (currentUser.canSendEmergency || currentUser.isAdmin) && (
                    cooldowns[`emergency_${peer.id}`] ? (
                      <button
                        className="btn btn-secondary"
                        style={{ flex: 1, fontSize: 10 }}
                        disabled
                      >
                        Wait {cooldowns[`emergency_${peer.id}`]}s
                      </button>
                    ) : (
                      <button
                        className="btn btn-danger"
                        style={{ flex: 1, fontSize: 10 }}
                        onClick={() => handleSendEmergency(peer.id)}
                      >
                        🚨 Emergency Request
                      </button>
                    )
                  )
                ) : (
                  <button
                    className={messagePopup === peer.id ? 'btn btn-danger' : 'btn btn-primary'}
                    style={{ flex: 1, fontSize: 10 }}
                    onClick={() => {
                      setMessagePopup(messagePopup === peer.id ? null : peer.id);
                      setMessageText('');
                    }}
                  >
                    {messagePopup === peer.id ? 'Close' : 'Request Meeting'}
                  </button>
                )}
              </div>

              {/* Meeting request message popup */}
              {messagePopup === peer.id && (
                <div style={{
                  marginTop: 8,
                  padding: 12,
                  background: 'var(--zen-tertiary-bg)',
                  borderRadius: 10,
                  border: '1px solid var(--zen-divider)',
                }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                    Request meeting with {peer.name}
                  </div>
                  <input
                    className="text-input"
                    placeholder="Add a message (optional)..."
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleSendRequest(peer.id, messageText || undefined);
                        setMessagePopup(null);
                        setMessageText('');
                      }
                      if (e.key === 'Escape') {
                        setMessagePopup(null);
                        setMessageText('');
                      }
                    }}
                    style={{ marginBottom: 8 }}
                  />
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: 10 }}
                      onClick={() => {
                        handleSendRequest(peer.id);
                        setMessagePopup(null);
                        setMessageText('');
                      }}
                    >
                      Skip
                    </button>
                    <button
                      className="btn btn-primary"
                      style={{ fontSize: 10 }}
                      onClick={() => {
                        handleSendRequest(peer.id, messageText || undefined);
                        setMessagePopup(null);
                        setMessageText('');
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

      {showPingSheet && (
        <SendPingSheet peers={peers} onClose={() => setShowPingSheet(false)} />
      )}
    </div>
  );
}
