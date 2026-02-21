import React, { useState, useMemo, useEffect } from 'react';
import { Pencil, Trash2, Hourglass, FileText } from 'lucide-react';
import { DailyRecord, DailySession, FocusTemplate, AppSettings } from '../../../shared/types';
import SessionEditModal from '../../components/SessionEditModal';
import { getCategoryColor, categoryTagStyle } from '../../utils/categoryColors';
import { ProBadge } from '../../components/ProGate';


interface TimerState {
  elapsed: number;
  isRunning: boolean;
  isPaused: boolean;
  taskLabel: string;
  category?: string;
  targetDuration?: number;
  remaining?: number;
}

interface Props {
  timerState: TimerState;
  records: DailyRecord[];
  isPro: boolean;
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

const DURATION_PRESETS = [
  { label: '15m', seconds: 15 * 60 },
  { label: '25m', seconds: 25 * 60 },
  { label: '30m', seconds: 30 * 60 },
  { label: '45m', seconds: 45 * 60 },
  { label: '1h', seconds: 60 * 60 },
  { label: '1.5h', seconds: 90 * 60 },
  { label: '2h', seconds: 120 * 60 },
];

export default function TimerTab({ timerState, records, isPro, onRefreshRecords }: Props) {
  const [showInput, setShowInput] = useState(false);
  const [taskInput, setTaskInput] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [timerMode, setTimerMode] = useState<'stopwatch' | 'countdown'>('stopwatch');
  const [selectedDuration, setSelectedDuration] = useState<number>(25 * 60);
  const [customMinutes, setCustomMinutes] = useState('');
  const [editingSession, setEditingSession] = useState<{ session: DailySession; date: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [categoryColors, setCategoryColors] = useState<Record<string, string>>({});
  const [templates, setTemplates] = useState<FocusTemplate[]>([]);
  const [dailyGoalSeconds, setDailyGoalSeconds] = useState(0);

  useEffect(() => {
    (window as any).zenstate.getCategories?.().then((cats: string[]) => {
      setCategories(cats || []);
    }).catch(() => {});
    (window as any).zenstate.getCategoryColors?.().then((colors: Record<string, string>) => {
      setCategoryColors(colors || {});
    }).catch(() => {});
    (window as any).zenstate.getTemplates?.().then((t: FocusTemplate[]) => {
      setTemplates(t || []);
    }).catch(() => {});
    (window as any).zenstate.getSettings?.().then((s: AppSettings) => {
      setDailyGoalSeconds(s?.dailyFocusGoalSeconds || 0);
    }).catch(() => {});
  }, []);

  const isTimerActive = timerState.isRunning || timerState.isPaused;
  const isCountdown = !!timerState.targetDuration;

  const todayRecord = useMemo(() => {
    const today = getTodayDateStr();
    return records.find((r) => r.date.startsWith(today));
  }, [records]);

  const todaySessions = useMemo(() => {
    return todayRecord?.sessions ? [...todayRecord.sessions].reverse() : [];
  }, [todayRecord]);

  const todayTotal = (todayRecord?.totalFocusTime || 0) + (timerState.isRunning || timerState.isPaused ? timerState.elapsed : 0);
  const dailyProgress = dailyGoalSeconds > 0 ? Math.min(1, todayTotal / dailyGoalSeconds) : 0;
  const goalComplete = dailyGoalSeconds > 0 && todayTotal >= dailyGoalSeconds;

  function handleStartTimer() {
    if (!selectedCategory) return;
    const label = taskInput.trim() || selectedCategory;
    const target = timerMode === 'countdown' ? selectedDuration : undefined;
    window.zenstate.startTimer(label, selectedCategory, target);
    setTaskInput('');
    setSelectedCategory('');
    setCustomMinutes('');
    setShowInput(false);
  }

  async function handleDeleteSession(sessionId: string) {
    const today = getTodayDateStr();
    await window.zenstate.deleteSession(sessionId, today);
    onRefreshRecords();
    setDeleteConfirm(null);
  }

  async function handleSaveEdit(sessionId: string, date: string, updates: { taskLabel: string; category: string; duration: number; notes: string }) {
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
                {timerState.isPaused ? 'Paused' : isCountdown ? 'Countdown' : 'Recording'}
              </span>
              {isCountdown && (
                <span style={{ fontSize: 11, color: 'var(--zen-tertiary-text)' }}>
                  {formatDuration(timerState.targetDuration!)} session
                </span>
              )}
            </div>

            <div style={{ fontSize: 13, color: 'var(--zen-secondary-text)', marginBottom: 4 }}>
              {timerState.taskLabel}
            </div>
            {timerState.category && (() => {
              const catColor = getCategoryColor(timerState.category, categoryColors, categories);
              return (
                <span style={{
                  fontSize: 10,
                  padding: '2px 8px',
                  borderRadius: 10,
                  background: `${catColor}40`,
                  color: catColor,
                  border: `1px solid ${catColor}55`,
                  display: 'inline-block',
                  marginBottom: 8,
                }}>
                  {timerState.category}
                </span>
              );
            })()}

            <div style={{
              fontSize: 42,
              fontWeight: 700,
              fontFamily: 'var(--font-mono)',
              color: timerState.isPaused ? 'var(--status-occupied)' : 'var(--zen-primary)',
              margin: '12px 0',
            }}>
              {isCountdown ? formatTime(timerState.remaining ?? 0) : formatTime(timerState.elapsed)}
            </div>

            {/* Progress bar for countdown */}
            {isCountdown && timerState.targetDuration && (
              <div style={{
                height: 4,
                borderRadius: 2,
                background: 'var(--zen-tertiary-bg)',
                marginBottom: 12,
                overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%',
                  borderRadius: 2,
                  background: timerState.isPaused ? 'var(--status-occupied)' : 'var(--zen-primary)',
                  width: `${Math.min(100, (timerState.elapsed / timerState.targetDuration) * 100)}%`,
                  transition: 'width 1s linear',
                }} />
              </div>
            )}

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
            placeholder="Task name (optional)"
            value={taskInput}
            onChange={(e) => setTaskInput(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleStartTimer();
            }}
          />

          {/* Mode Toggle */}
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--zen-secondary-text)', marginBottom: 6 }}>Mode</div>
            <div style={{ display: 'flex', gap: 4, background: 'var(--zen-tertiary-bg)', borderRadius: 8, padding: 2 }}>
              <button
                style={{
                  flex: 1,
                  padding: '6px 0',
                  fontSize: 11,
                  fontWeight: 600,
                  borderRadius: 6,
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  background: timerMode === 'stopwatch' ? 'var(--zen-primary)' : 'transparent',
                  color: timerMode === 'stopwatch' ? 'white' : 'var(--zen-secondary-text)',
                  transition: 'all 0.15s ease',
                }}
                onClick={() => setTimerMode('stopwatch')}
              >
                Stopwatch
              </button>
              <button
                style={{
                  flex: 1,
                  padding: '6px 0',
                  fontSize: 11,
                  fontWeight: 600,
                  borderRadius: 6,
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  background: timerMode === 'countdown' ? 'var(--zen-primary)' : 'transparent',
                  color: timerMode === 'countdown' ? 'white' : 'var(--zen-secondary-text)',
                  transition: 'all 0.15s ease',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                }}
                onClick={() => setTimerMode('countdown')}
              >
                <Hourglass size={12} /> Countdown
              </button>
            </div>
          </div>

          {/* Duration Picker (countdown mode) */}
          {timerMode === 'countdown' && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--zen-secondary-text)', marginBottom: 6 }}>Duration</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {DURATION_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    className={`category-chip ${selectedDuration === preset.seconds ? 'selected' : ''}`}
                    onClick={() => { setSelectedDuration(preset.seconds); setCustomMinutes(''); }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
                <input
                  className="text-input"
                  placeholder="Custom minutes..."
                  type="number"
                  min="1"
                  value={customMinutes}
                  onChange={(e) => {
                    setCustomMinutes(e.target.value);
                    const mins = parseInt(e.target.value);
                    if (mins > 0) setSelectedDuration(mins * 60);
                  }}
                  style={{ flex: 1, fontSize: 12 }}
                />
                <span style={{ fontSize: 11, color: 'var(--zen-tertiary-text)' }}>min</span>
              </div>
            </div>
          )}

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
            <button className="btn btn-secondary" onClick={() => { setShowInput(false); setTaskInput(''); setSelectedCategory(''); setCustomMinutes(''); }}>
              Cancel
            </button>
            <div className="spacer" />
            <button className="btn btn-primary" onClick={handleStartTimer} disabled={!selectedCategory}>
              {timerMode === 'countdown' ? `Start ${formatDuration(selectedDuration)}` : 'Start Recording'}
            </button>
          </div>
        </div>
      )}

      {/* Focus Templates (idle state) — Pro only */}
      {!isTimerActive && !showInput && (
        <>
          {templates.length > 0 && !isPro && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 14px', borderRadius: 10,
              background: 'var(--zen-tertiary-bg)', marginBottom: 12,
              border: '1px solid var(--zen-divider)',
            }}>
              <span style={{ fontSize: 12, color: 'var(--zen-secondary-text)', flex: 1 }}>
                Focus Templates <ProBadge />
              </span>
              <span style={{ fontSize: 10, color: 'var(--zen-tertiary-text)' }}>Upgrade to unlock</span>
            </div>
          )}
          {templates.length > 0 && isPro && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {templates.map((t) => (
                <button
                  key={t.id}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 14px',
                    borderRadius: 20,
                    background: 'var(--zen-secondary-bg)',
                    border: '1px solid var(--zen-divider)',
                    cursor: 'pointer',
                    fontSize: 12,
                    transition: 'background 0.15s ease, border-color 0.15s ease',
                    fontFamily: 'inherit',
                    color: 'var(--zen-text)',
                  }}
                  onClick={() => {
                    window.zenstate.startTimer(t.name, t.category, t.defaultDuration);
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--zen-hover)'; e.currentTarget.style.borderColor = 'var(--zen-primary)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--zen-secondary-bg)'; e.currentTarget.style.borderColor = 'var(--zen-divider)'; }}
                >
                  <span style={{ fontWeight: 500 }}>{t.name}</span>
                  <span style={{ fontSize: 10, color: 'var(--zen-tertiary-text)' }}>{formatDuration(t.defaultDuration)}</span>
                </button>
              ))}
            </div>
          )}

          <button
            className="btn btn-secondary"
            style={{ width: '100%', fontSize: 12, marginBottom: 12 }}
            onClick={() => setShowInput(true)}
          >
            + Custom Recording
          </button>
        </>
      )}

      {/* Daily Focus Goal Progress (Pro only) */}
      {dailyGoalSeconds > 0 && isPro && (
        <div className="card" style={{ marginBottom: 12, padding: '12px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>
              {goalComplete ? '🎉' : '🎯'} Daily Goal
            </span>
            <span style={{ fontSize: 11, color: goalComplete ? 'var(--status-available)' : 'var(--zen-secondary-text)' }}>
              {formatDuration(todayTotal)} / {formatDuration(dailyGoalSeconds)}
              {goalComplete && ' — Complete!'}
            </span>
          </div>
          <div style={{
            height: 6,
            borderRadius: 3,
            background: 'var(--zen-tertiary-bg)',
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              borderRadius: 3,
              background: goalComplete ? 'var(--status-available)' : 'var(--zen-primary)',
              width: `${dailyProgress * 100}%`,
              transition: 'width 0.5s ease',
            }} />
          </div>
          <div style={{ fontSize: 10, color: 'var(--zen-tertiary-text)', marginTop: 4, textAlign: 'right' }}>
            {Math.round(dailyProgress * 100)}%
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
                    <span style={categoryTagStyle(getCategoryColor(session.category, categoryColors, categories))}>
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
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}>
                {formatDuration(session.duration)}
                {session.notes && (
                  <span title={session.notes} style={{ cursor: 'default', display: 'flex', alignItems: 'center' }}><FileText size={12} /></span>
                )}
              </div>
              <div className="session-actions">
                <button
                  className="session-action-btn"
                  onClick={() => setEditingSession({ session, date: getTodayDateStr() })}
                  title="Edit"
                >
                  <Pencil size={13} />
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
                    <Trash2 size={13} />
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
