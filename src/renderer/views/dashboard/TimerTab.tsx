import React, { useState, useMemo, useEffect } from 'react';
import { DailyRecord, DailySession } from '../../../shared/types';
import SessionEditModal from '../../components/SessionEditModal';

interface TimerState {
  elapsed: number;
  isRunning: boolean;
  isPaused: boolean;
  taskLabel: string;
  category?: string;
}

interface Props {
  timerState: TimerState;
  records: DailyRecord[];
  onRefreshRecords: () => void;
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
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function getTodayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function TimerTab({ timerState, records, onRefreshRecords }: Props) {
  const [showInput, setShowInput] = useState(false);
  const [taskInput, setTaskInput] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [editingSession, setEditingSession] = useState<{ session: DailySession; date: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [categories, setCategories] = useState<string[]>([]);

  useEffect(() => {
    (window as any).zenstate.getCategories?.().then((cats: string[]) => {
      setCategories(cats || []);
    }).catch(() => {});
  }, []);

  const isTimerActive = timerState.isRunning || timerState.isPaused;

  const todayRecord = useMemo(() => {
    const today = getTodayDateStr();
    return records.find((r) => r.date.startsWith(today));
  }, [records]);

  const todaySessions = useMemo(() => {
    return todayRecord?.sessions ? [...todayRecord.sessions].reverse() : [];
  }, [todayRecord]);

  function handleStartTimer() {
    if (!taskInput.trim()) return;
    window.zenstate.startTimer(taskInput.trim(), selectedCategory || undefined);
    setTaskInput('');
    setSelectedCategory('');
    setShowInput(false);
  }

  async function handleDeleteSession(sessionId: string) {
    const today = getTodayDateStr();
    await window.zenstate.deleteSession(sessionId, today);
    onRefreshRecords();
    setDeleteConfirm(null);
  }

  async function handleSaveEdit(sessionId: string, date: string, updates: { taskLabel: string; category: string; duration: number }) {
    await window.zenstate.updateSession(sessionId, date, updates);
    onRefreshRecords();
    setEditingSession(null);
  }

  return (
    <div className="fade-in">
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 20 }}>Timer</h1>

      {/* Active Timer */}
      {isTimerActive && (
        <div className="card" style={{ position: 'relative', overflow: 'hidden' }}>
          <div style={{
            position: 'absolute',
            inset: 0,
            background: timerState.isPaused
              ? 'rgba(255, 149, 0, 0.05)'
              : 'rgba(0, 122, 255, 0.05)',
          }} />
          <div style={{ position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: timerState.isPaused ? 'var(--status-occupied)' : '#FF3B30',
                animation: timerState.isPaused ? 'none' : 'pulse 2s ease-in-out infinite',
              }} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                {timerState.isPaused ? 'Paused' : 'Recording'}
              </span>
            </div>

            <div style={{ fontSize: 13, color: 'var(--zen-secondary-text)', marginBottom: 4 }}>
              {timerState.taskLabel}
            </div>
            {timerState.category && (
              <span style={{
                fontSize: 10,
                padding: '2px 8px',
                borderRadius: 10,
                background: 'var(--zen-primary)',
                color: 'white',
                display: 'inline-block',
                marginBottom: 8,
              }}>
                {timerState.category}
              </span>
            )}

            <div style={{
              fontSize: 42,
              fontWeight: 700,
              fontFamily: 'var(--font-mono)',
              color: timerState.isPaused ? 'var(--status-occupied)' : 'var(--zen-primary)',
              margin: '12px 0',
            }}>
              {formatTime(timerState.elapsed)}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
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
        </div>
      )}

      {/* Start Timer Input */}
      {!isTimerActive && showInput && (
        <div className="card fade-in">
          <div className="card-title">Start Recording</div>
          <input
            className="text-input"
            placeholder="What are you working on?"
            value={taskInput}
            onChange={(e) => setTaskInput(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleStartTimer();
            }}
          />

          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--zen-secondary-text)', marginBottom: 6 }}>Category</div>
            <div className="category-picker">
              {categories.map((cat) => (
                <button
                  key={cat}
                  className={`category-chip ${selectedCategory === cat ? 'selected' : ''}`}
                  onClick={() => setSelectedCategory(selectedCategory === cat ? '' : cat)}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button className="btn btn-secondary" onClick={() => { setShowInput(false); setTaskInput(''); setSelectedCategory(''); }}>
              Cancel
            </button>
            <div className="spacer" />
            <button className="btn btn-primary" disabled={!taskInput.trim()} onClick={handleStartTimer}>
              ● Start Recording
            </button>
          </div>
        </div>
      )}

      {/* Start Timer Button (idle) */}
      {!isTimerActive && !showInput && (
        <div
          className="card"
          style={{ textAlign: 'center', padding: 32, cursor: 'pointer', transition: 'transform 0.15s ease' }}
          onClick={() => setShowInput(true)}
          onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.01)')}
          onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
        >
          <div style={{ fontSize: 32, marginBottom: 8 }}>⏱</div>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Start Recording Time</div>
          <div style={{ fontSize: 12, color: 'var(--zen-secondary-text)' }}>
            Track what you're working on and how long it takes.
          </div>
        </div>
      )}

      {/* Today's Recordings */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          Today's Recordings
          {todayRecord && (
            <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--zen-secondary-text)' }}>
              {formatDuration(todayRecord.totalFocusTime)} total
            </span>
          )}
        </div>

        {todaySessions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 20, color: 'var(--zen-tertiary-text)', fontSize: 12 }}>
            No recordings yet today
          </div>
        ) : (
          todaySessions.map((session) => (
            <div key={session.id} className="session-row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {session.taskLabel}
                  {session.category && (
                    <span style={{
                      fontSize: 9,
                      padding: '1px 6px',
                      borderRadius: 8,
                      background: 'var(--zen-secondary-bg)',
                      color: 'var(--zen-secondary-text)',
                    }}>
                      {session.category}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 10, color: 'var(--zen-tertiary-text)', marginTop: 2 }}>
                  {session.startTime ? new Date(session.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                </div>
              </div>
              <div style={{
                fontSize: 12,
                fontFamily: 'var(--font-mono)',
                color: 'var(--zen-secondary-text)',
                marginRight: 8,
              }}>
                {formatDuration(session.duration)}
              </div>
              <div className="session-actions">
                <button
                  className="session-action-btn"
                  onClick={() => setEditingSession({ session, date: getTodayDateStr() })}
                  title="Edit"
                >
                  ✏️
                </button>
                {deleteConfirm === session.id ? (
                  <button
                    className="session-action-btn delete"
                    onClick={() => handleDeleteSession(session.id)}
                    title="Confirm delete"
                  >
                    ✓
                  </button>
                ) : (
                  <button
                    className="session-action-btn delete"
                    onClick={() => setDeleteConfirm(session.id)}
                    title="Delete"
                  >
                    🗑
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Session Edit Modal */}
      {editingSession && (
        <SessionEditModal
          session={editingSession.session}
          date={editingSession.date}
          categories={categories}
          onSave={handleSaveEdit}
          onClose={() => setEditingSession(null)}
        />
      )}
    </div>
  );
}
