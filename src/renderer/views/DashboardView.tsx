import React, { useState } from 'react';
import { Users, Timer, ClipboardList, Settings } from 'lucide-react';
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
  onRefreshRecords: () => void;
  onStatusChange: (status: AvailabilityStatus) => void;
  onUserUpdate: (updates: Partial<User>) => void;
  onSignOut: () => void;
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

type Tab = 'team' | 'timer' | 'timesheet' | 'settings';

export default function DashboardView({ currentUser, peers, timerState, records, onRefreshRecords, onStatusChange, onUserUpdate, onSignOut }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('team');
  const [editingStatus, setEditingStatus] = useState(false);
  const [statusInput, setStatusInput] = useState('');

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
            <span>{currentUser.avatarEmoji || '😊'}</span>
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
              <span>💬 {currentUser.activeStatusMessage}</span>
            ) : (
              <span style={{ color: 'var(--zen-tertiary-text)' }}>+ Set a status message...</span>
            )}
          </div>
        )}

        {/* Status Picker — colored circles */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, justifyContent: 'center' }}>
          {[AvailabilityStatus.Available, AvailabilityStatus.Occupied, AvailabilityStatus.Focused].map((status) => (
            <button
              key={status}
              onClick={() => onStatusChange(status)}
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
