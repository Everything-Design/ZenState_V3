import React, { useState, useEffect } from 'react';
import { Users, Timer, ClipboardList, Settings, MessageCircle } from 'lucide-react';
import { User, AvailabilityStatus, DailyRecord } from '../../shared/types';
import TeamTab from './dashboard/TeamTab';
import TimerTab from './dashboard/TimerTab';
import TimesheetTab from './dashboard/TimesheetTab';
import SettingsTab from './dashboard/SettingsTab';

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
  records: DailyRecord[];
  statusRevertRemaining?: number;
  requestedTab?: string;
  onRequestedTabHandled?: () => void;
  onRefreshRecords: () => void;
  onStatusChange: (status: AvailabilityStatus) => void;
  onUserUpdate: (updates: Partial<User>) => void;
  onSignOut: () => void;
}

const REVERT_OPTIONS = [
  { label: '15m', seconds: 15 * 60 },
  { label: '30m', seconds: 30 * 60 },
  { label: '1h', seconds: 60 * 60 },
  { label: '2h', seconds: 2 * 60 * 60 },
  { label: 'None', seconds: 0 },
];

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

type Tab = 'team' | 'timer' | 'timesheet' | 'settings';

function formatRevertTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0) return `${m}:${String(s).padStart(2, '0')}`;
  return `${s}s`;
}

export default function DashboardView({ currentUser, peers, timerState, records, statusRevertRemaining, requestedTab, onRequestedTabHandled, onRefreshRecords, onStatusChange, onUserUpdate, onSignOut }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('team');

  useEffect(() => {
    if (requestedTab && ['team', 'timer', 'timesheet', 'settings'].includes(requestedTab)) {
      setActiveTab(requestedTab as Tab);
      onRequestedTabHandled?.();
    }
  }, [requestedTab]);
  const [editingStatus, setEditingStatus] = useState(false);
  const [statusInput, setStatusInput] = useState('');
  const [showRevertPicker, setShowRevertPicker] = useState<AvailabilityStatus | null>(null);

  function handleSetStatusMessage() {
    if (!statusInput.trim()) return;
    onUserUpdate({
      activeStatusMessage: statusInput.trim(),
      statusMessageExpiry: undefined,
    });
    setStatusInput('');
    setEditingStatus(false);
  }

  function handleClearStatusMessage() {
    onUserUpdate({
      activeStatusMessage: undefined,
      statusMessageExpiry: undefined,
    });
    setEditingStatus(false);
  }

  return (
    <div className="dashboard">
      {/* Sidebar */}
      <div className="dashboard-sidebar">
        {/* Drag region for macOS traffic lights */}
        <div className="drag-region" style={{ height: (window as any).zenstate?.platform === 'darwin' ? 52 : 16, flexShrink: 0 }} />

        {/* Profile */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <div className="avatar" style={{
            width: 44,
            height: 44,
            background: currentUser.avatarColor || '#007AFF',
            fontSize: 22,
            flexShrink: 0,
          }}>
            <div className={`status-ring ${currentUser.status}`} />
            {currentUser.avatarImageData ? (
              <img src={`data:image/png;base64,${currentUser.avatarImageData}`} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
            ) : currentUser.avatarEmoji ? (
              <span>{currentUser.avatarEmoji}</span>
            ) : (
              <span style={{ fontSize: 18, fontWeight: 600, color: 'white' }}>{currentUser.name.charAt(0).toUpperCase()}</span>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {currentUser.name}
            </div>
            <div style={{ fontSize: 11, color: getStatusColor(currentUser.status), display: 'flex', alignItems: 'center', gap: 4 }}>
              <span className={`status-dot ${currentUser.status}`} />
              {getStatusLabel(currentUser.status)}
            </div>
          </div>
        </div>

        {/* Status Message */}
        {editingStatus ? (
          <div style={{ marginBottom: 10 }}>
            <input
              className="text-input"
              placeholder="What's your status?"
              value={statusInput}
              onChange={(e) => setStatusInput(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSetStatusMessage();
                if (e.key === 'Escape') setEditingStatus(false);
              }}
              style={{ fontSize: 11, marginBottom: 6 }}
            />
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="btn btn-primary" style={{ flex: 1, fontSize: 10 }} onClick={handleSetStatusMessage} disabled={!statusInput.trim()}>
                Set
              </button>
              {currentUser.activeStatusMessage && (
                <button className="btn btn-danger" style={{ fontSize: 10 }} onClick={handleClearStatusMessage}>
                  Clear
                </button>
              )}
              <button className="btn btn-secondary" style={{ fontSize: 10 }} onClick={() => setEditingStatus(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div
            onClick={() => { setStatusInput(currentUser.activeStatusMessage || ''); setEditingStatus(true); }}
            style={{
              fontSize: 11,
              color: 'var(--zen-secondary-text)',
              cursor: 'pointer',
              marginBottom: 10,
              padding: '4px 0',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            {currentUser.activeStatusMessage ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><MessageCircle size={12} /> {currentUser.activeStatusMessage}</span>
            ) : (
              <span style={{ color: 'var(--zen-tertiary-text)' }}>+ Set a status message...</span>
            )}
          </div>
        )}

        {/* Status Picker — colored circles */}
        <div style={{ display: 'flex', gap: 8, marginBottom: statusRevertRemaining && statusRevertRemaining > 0 ? 4 : 16, justifyContent: 'center' }}>
          {[AvailabilityStatus.Available, AvailabilityStatus.Occupied, AvailabilityStatus.Focused].map((status) => (
            <button
              key={status}
              onClick={() => {
                if (status === AvailabilityStatus.Occupied || status === AvailabilityStatus.Focused) {
                  if (showRevertPicker === status) {
                    setShowRevertPicker(null);
                  } else {
                    onStatusChange(status);
                    setShowRevertPicker(status);
                  }
                } else {
                  onStatusChange(status);
                  setShowRevertPicker(null);
                  (window as any).zenstate.cancelStatusRevert?.();
                }
              }}
              title={getStatusLabel(status)}
              style={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                border: currentUser.status === status ? '2.5px solid white' : '2px solid transparent',
                background: getStatusColor(status),
                cursor: 'pointer',
                transition: 'border-color 0.15s ease, transform 0.15s ease',
                transform: currentUser.status === status ? 'scale(1.1)' : 'scale(1)',
                boxShadow: currentUser.status === status ? '0 0 0 2px rgba(255,255,255,0.15)' : 'none',
                padding: 0,
              }}
            />
          ))}
        </div>

        {/* Revert time picker */}
        {showRevertPicker && (
          <div style={{ display: 'flex', gap: 4, justifyContent: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, color: 'var(--zen-tertiary-text)', width: '100%', textAlign: 'center', marginBottom: 2 }}>
              Auto-revert to Available after:
            </span>
            {REVERT_OPTIONS.map((opt) => (
              <button
                key={opt.label}
                className="category-chip"
                style={{ fontSize: 10, padding: '2px 8px' }}
                onClick={() => {
                  if (opt.seconds > 0) {
                    (window as any).zenstate.setStatusRevert?.(opt.seconds);
                  } else {
                    (window as any).zenstate.cancelStatusRevert?.();
                  }
                  setShowRevertPicker(null);
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}

        {/* Status revert countdown */}
        {statusRevertRemaining !== undefined && statusRevertRemaining > 0 && (
          <div style={{
            textAlign: 'center',
            fontSize: 10,
            color: 'var(--zen-secondary-text)',
            marginBottom: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}>
            <span>⏱ Reverting in {formatRevertTime(statusRevertRemaining)}</span>
            <button
              onClick={() => (window as any).zenstate.cancelStatusRevert?.()}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--zen-tertiary-text)', fontSize: 10, fontFamily: 'inherit',
                padding: '0 2px',
              }}
            >
              ✕
            </button>
          </div>
        )}

        <div className="divider" style={{ margin: '0 0 12px' }} />

        {/* Navigation */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <button
            className={`tab-btn ${activeTab === 'team' ? 'active' : ''}`}
            onClick={() => setActiveTab('team')}
          >
            <Users size={16} /> Team
          </button>
          <button
            className={`tab-btn ${activeTab === 'timer' ? 'active' : ''}`}
            onClick={() => setActiveTab('timer')}
          >
            <Timer size={16} /> Timer
          </button>
          <button
            className={`tab-btn ${activeTab === 'timesheet' ? 'active' : ''}`}
            onClick={() => setActiveTab('timesheet')}
          >
            <ClipboardList size={16} /> Timesheet
          </button>
          <button
            className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            <Settings size={16} /> Settings
          </button>
        </div>

        <div className="spacer" />
      </div>

      {/* Main Content */}
      <div className="dashboard-content">
        {/* Drag strip at top for window dragging */}
        <div className="drag-strip" />
        {activeTab === 'team' && (
          <TeamTab currentUser={currentUser} peers={peers} />
        )}
        {activeTab === 'timer' && (
          <TimerTab
            timerState={timerState}
            records={records}
            onRefreshRecords={onRefreshRecords}
          />
        )}
        {activeTab === 'timesheet' && (
          <TimesheetTab
            records={records}
            onRefreshRecords={onRefreshRecords}
          />
        )}
        {activeTab === 'settings' && (
          <SettingsTab
            currentUser={currentUser}
            peers={peers}
            onUserUpdate={onUserUpdate}
            onSignOut={onSignOut}
          />
        )}
      </div>
    </div>
  );
}
