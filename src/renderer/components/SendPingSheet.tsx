import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { X, Plus, Check, Users, Trash2, Edit2 } from 'lucide-react';
import { User, AvailabilityStatus, PeerGroup } from '../../shared/types';

interface Props {
  peers: User[];
  onClose: () => void;
}

type Mode = 'send' | 'manage-groups' | 'edit-group';

// Generate a uuid without pulling in a dep — we already use crypto.randomUUID
// in the renderer environment (it's available on browser globals in modern Electron).
function uuid(): string {
  return (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

export default function SendPingSheet({ peers, onClose }: Props) {
  const [mode, setMode] = useState<Mode>('send');
  const [message, setMessage] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [groups, setGroups] = useState<PeerGroup[]>([]);
  const [editingGroup, setEditingGroup] = useState<PeerGroup | null>(null);
  const [sending, setSending] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Online peers — we only ping discovered peers.
  const onlinePeers = useMemo(
    () => peers.filter((p) => p.status !== AvailabilityStatus.Offline),
    [peers]
  );

  useEffect(() => {
    window.zenstate.groupsGet().then(setGroups).catch(() => {});
  }, []);

  const togglePeer = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAllOnline = useCallback(() => {
    setSelectedIds(new Set(onlinePeers.map((p) => p.id)));
  }, [onlinePeers]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const applyGroup = useCallback((group: PeerGroup) => {
    // Add the group's members to the current selection (don't replace) so users
    // can stack multiple groups, and only members who are currently online apply.
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const onlineSet = new Set(onlinePeers.map((p) => p.id));
      for (const id of group.memberIds) if (onlineSet.has(id)) next.add(id);
      return next;
    });
  }, [onlinePeers]);

  const handleSend = useCallback(async () => {
    if (sending) return;
    const trimmed = message.trim();
    if (!trimmed || selectedIds.size === 0) return;
    setSending(true);
    const res = await window.zenstate.teamSendPing({
      recipientIds: Array.from(selectedIds),
      message: trimmed,
    }).catch((e) => ({ ok: false, delivered: 0, error: (e as Error).message }));
    setSending(false);
    if (res.ok) {
      const count = res.delivered;
      setStatusMsg(count === 1 ? 'Sent to 1 person' : `Sent to ${count} people`);
      setTimeout(onClose, 800); // brief confirmation, then close
    } else {
      setStatusMsg(res.error ?? 'Failed to send');
    }
  }, [sending, message, selectedIds, onClose]);

  // ── Manage groups ──
  const handleNewGroup = () => {
    setEditingGroup({ id: uuid(), name: '', memberIds: [] });
    setMode('edit-group');
  };

  const handleEditGroup = (group: PeerGroup) => {
    setEditingGroup({ ...group, memberIds: [...group.memberIds] });
    setMode('edit-group');
  };

  const handleSaveGroup = async () => {
    if (!editingGroup || !editingGroup.name.trim() || editingGroup.memberIds.length === 0) return;
    const next = await window.zenstate.groupsSave({ ...editingGroup, name: editingGroup.name.trim() });
    setGroups(next);
    setEditingGroup(null);
    setMode('manage-groups');
  };

  const handleDeleteGroup = async (id: string) => {
    if (!confirm('Delete this group?')) return;
    const next = await window.zenstate.groupsDelete(id);
    setGroups(next);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ width: 460, padding: 0 }}>
        {/* Header */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--zen-divider)', display: 'flex', alignItems: 'center', gap: 10 }}>
          {mode !== 'send' && (
            <button
              onClick={() => { setMode(mode === 'edit-group' ? 'manage-groups' : 'send'); setEditingGroup(null); }}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--zen-secondary-text)', display: 'flex', padding: 0 }}
              title="Back"
            >
              ‹ Back
            </button>
          )}
          <h3 style={{ flex: 1, margin: 0, fontSize: 'var(--text-lg)', fontWeight: 600, letterSpacing: '-0.01em' }}>
            {mode === 'send' && 'Send a heads-up'}
            {mode === 'manage-groups' && 'Groups'}
            {mode === 'edit-group' && (editingGroup?.name ? 'Edit group' : 'New group')}
          </h3>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--zen-tertiary-text)', display: 'flex', padding: 4 }} title="Close">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 18 }}>
          {mode === 'send' && (
            <>
              {/* Message */}
              <input
                className="text-input"
                placeholder="What's the heads-up? e.g. Standup in 5 min"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter' && message.trim() && selectedIds.size > 0) handleSend(); }}
                style={{ marginBottom: 14 }}
              />

              {/* Groups row */}
              {groups.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--zen-tertiary-text)', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600, marginBottom: 6 }}>
                    Groups
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {groups.map((g) => (
                      <button
                        key={g.id}
                        className="category-chip"
                        onClick={() => applyGroup(g)}
                        title={`Add ${g.memberIds.length} ${g.memberIds.length === 1 ? 'person' : 'people'} to selection`}
                      >
                        <Users size={9} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                        {g.name} · {g.memberIds.length}
                      </button>
                    ))}
                    <button
                      onClick={() => setMode('manage-groups')}
                      className="category-chip"
                      style={{ borderStyle: 'dashed' }}
                    >
                      Manage
                    </button>
                  </div>
                </div>
              )}

              {/* Recipients */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--zen-tertiary-text)', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600 }}>
                    Send to {selectedIds.size > 0 && <span style={{ color: 'var(--zen-primary)', textTransform: 'none', fontWeight: 600 }}>· {selectedIds.size}</span>}
                  </span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {selectedIds.size > 0 && (
                      <button onClick={clearSelection} style={linkBtnStyle}>Clear</button>
                    )}
                    <button onClick={selectAllOnline} style={linkBtnStyle}>All online</button>
                    {groups.length === 0 && (
                      <button onClick={() => setMode('manage-groups')} style={linkBtnStyle}>+ New group</button>
                    )}
                  </div>
                </div>

                {onlinePeers.length === 0 ? (
                  <div style={{ fontSize: 'var(--text-sm)', color: 'var(--zen-tertiary-text)', padding: '12px 0' }}>
                    No teammates online right now.
                  </div>
                ) : (
                  <div style={{
                    display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4,
                    maxHeight: 220, overflowY: 'auto',
                    padding: 2,
                  }}>
                    {onlinePeers.map((p) => {
                      const checked = selectedIds.has(p.id);
                      return (
                        <button
                          key={p.id}
                          onClick={() => togglePeer(p.id)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            padding: '6px 10px',
                            borderRadius: 'var(--radius-sm)',
                            background: checked ? 'rgba(10, 132, 255, 0.14)' : 'transparent',
                            border: `1px solid ${checked ? 'rgba(10, 132, 255, 0.45)' : 'var(--zen-divider)'}`,
                            color: 'var(--zen-text)',
                            cursor: 'pointer', fontFamily: 'inherit',
                            fontSize: 'var(--text-sm)',
                            textAlign: 'left',
                            transition: 'background var(--duration-quick) var(--ease-standard), border-color var(--duration-quick) var(--ease-standard)',
                          }}
                        >
                          <PeerAvatar peer={p} size={20} />
                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                          {checked && <Check size={12} style={{ color: 'var(--zen-primary)' }} />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {statusMsg && (
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--status-available)', marginBottom: 12, textAlign: 'center' }}>
                  ✓ {statusMsg}
                </div>
              )}

              <button
                className="btn btn-primary"
                style={{ width: '100%' }}
                onClick={handleSend}
                disabled={sending || !message.trim() || selectedIds.size === 0}
              >
                {sending ? 'Sending…' : selectedIds.size === 0 ? 'Pick at least one teammate' : `Send to ${selectedIds.size} ${selectedIds.size === 1 ? 'person' : 'people'}`}
              </button>
            </>
          )}

          {/* ── Manage groups list ── */}
          {mode === 'manage-groups' && (
            <>
              {groups.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                  <Users size={28} style={{ color: 'var(--zen-tertiary-text)' }} />
                  <div style={{ fontSize: 'var(--text-sm)', color: 'var(--zen-secondary-text)', margin: '12px 0', lineHeight: 'var(--leading-relaxed)' }}>
                    No groups yet. Save sets of people you ping often<br />— like "Design Team" or "Standup".
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                  {groups.map((g) => (
                    <div key={g.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 12px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--zen-tertiary-bg)',
                      border: '1px solid var(--zen-divider)',
                    }}>
                      <Users size={14} style={{ color: 'var(--zen-secondary-text)', flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--zen-text)' }}>{g.name}</div>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--zen-tertiary-text)', marginTop: 1 }}>
                          {g.memberIds.length} {g.memberIds.length === 1 ? 'person' : 'people'}
                        </div>
                      </div>
                      <button onClick={() => handleEditGroup(g)} style={iconActionStyle} title="Edit">
                        <Edit2 size={13} />
                      </button>
                      <button onClick={() => handleDeleteGroup(g.id)} style={{ ...iconActionStyle, color: 'var(--status-focused)' }} title="Delete">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleNewGroup}>
                <Plus size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} /> New group
              </button>
            </>
          )}

          {/* ── Edit/create group ── */}
          {mode === 'edit-group' && editingGroup && (
            <>
              <input
                className="text-input"
                placeholder="Group name (e.g. Design Team)"
                value={editingGroup.name}
                onChange={(e) => setEditingGroup({ ...editingGroup, name: e.target.value })}
                autoFocus
                style={{ marginBottom: 12 }}
              />
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--zen-tertiary-text)', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600, marginBottom: 6 }}>
                Members · {editingGroup.memberIds.length}
              </div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--zen-tertiary-text)', marginBottom: 8, lineHeight: 'var(--leading-relaxed)' }}>
                Pick from teammates currently discovered on the network. Members who go offline later will still be in the group — they just won't receive pings until they're back online.
              </div>
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4,
                maxHeight: 220, overflowY: 'auto', marginBottom: 14,
                padding: 2,
              }}>
                {peers.length === 0 ? (
                  <div style={{ gridColumn: '1 / -1', padding: 12, fontSize: 'var(--text-sm)', color: 'var(--zen-tertiary-text)', textAlign: 'center' }}>
                    No teammates discovered yet.
                  </div>
                ) : peers.map((p) => {
                  const checked = editingGroup.memberIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      onClick={() => {
                        setEditingGroup({
                          ...editingGroup,
                          memberIds: checked
                            ? editingGroup.memberIds.filter((id) => id !== p.id)
                            : [...editingGroup.memberIds, p.id],
                        });
                      }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '6px 10px',
                        borderRadius: 'var(--radius-sm)',
                        background: checked ? 'rgba(10, 132, 255, 0.14)' : 'transparent',
                        border: `1px solid ${checked ? 'rgba(10, 132, 255, 0.45)' : 'var(--zen-divider)'}`,
                        color: 'var(--zen-text)',
                        cursor: 'pointer', fontFamily: 'inherit',
                        fontSize: 'var(--text-sm)',
                        textAlign: 'left',
                      }}
                    >
                      <PeerAvatar peer={p} size={20} />
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                      {checked && <Check size={12} style={{ color: 'var(--zen-primary)' }} />}
                    </button>
                  );
                })}
              </div>
              <button
                className="btn btn-primary"
                style={{ width: '100%' }}
                onClick={handleSaveGroup}
                disabled={!editingGroup.name.trim() || editingGroup.memberIds.length === 0}
              >
                Save group
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components / styles ────────────────────────────────────

function PeerAvatar({ peer, size }: { peer: User; size: number }) {
  const initial = peer.name.charAt(0).toUpperCase();
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: peer.avatarColor || '#0A84FF',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.round(size * 0.5), fontWeight: 600, color: 'white',
      flexShrink: 0,
      overflow: 'hidden',
    }}>
      {peer.avatarImageData ? (
        <img src={`data:image/png;base64,${peer.avatarImageData}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : peer.avatarEmoji ? (
        <span style={{ fontSize: Math.round(size * 0.6) }}>{peer.avatarEmoji}</span>
      ) : (
        <span>{initial}</span>
      )}
    </div>
  );
}

const linkBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--zen-primary)',
  fontSize: 'var(--text-xs)',
  fontWeight: 500,
  cursor: 'pointer',
  padding: 0,
  fontFamily: 'inherit',
};

const iconActionStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--zen-secondary-text)',
  display: 'flex',
  alignItems: 'center',
  padding: 4,
  borderRadius: 4,
};
