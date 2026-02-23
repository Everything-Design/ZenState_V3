import React, { useState, useMemo, useEffect } from 'react';
import { User, AvailabilityStatus, IPC } from '../../../shared/types';

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

  // Clear pending request when peer responds (accept or decline)
  useEffect(() => {
    const handler = (data: unknown) => {
      const response = data as { accepted: boolean; from: string };
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
      </div>

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
                    className="btn btn-primary"
                    style={{ flex: 1, fontSize: 10 }}
                    onClick={() => handleSendRequest(peer.id)}
                  >
                    💬 Request Meeting
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
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
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
    </div>
  );
}
