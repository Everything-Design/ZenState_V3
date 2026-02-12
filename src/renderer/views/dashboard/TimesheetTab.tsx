import React, { useState, useMemo, useEffect } from 'react';
import { DailyRecord, DailySession } from '../../../shared/types';
import SessionEditModal from '../../components/SessionEditModal';

interface Props {
  records: DailyRecord[];
  onRefreshRecords: () => void;
}

type StatPeriod = 'all' | 'month' | 'week' | 'today';

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
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

function getMonthStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

function getStartOfWeek(): Date {
  const d = new Date();
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

const CATEGORY_COLORS: Record<string, string> = {
  Development: '#007AFF',
  Design: '#FF9500',
  Meetings: '#FF3B30',
  Writing: '#34C759',
  Research: '#5856D6',
  Planning: '#AF52DE',
  Admin: '#8E8E93',
  Other: '#AEAEB2',
};

export default function TimesheetTab({ records, onRefreshRecords }: Props) {
  const [statPeriod, setStatPeriod] = useState<StatPeriod>('today');
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showCalendar, setShowCalendar] = useState(true);
  const [editingSession, setEditingSession] = useState<{ session: DailySession; date: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [categories, setCategories] = useState<string[]>([]);

  useEffect(() => {
    (window as any).zenstate.getCategories?.().then((cats: string[]) => {
      setCategories(cats || []);
    }).catch(() => {});
  }, []);

  // Filter records by period
  const filteredRecords = useMemo(() => {
    const today = getTodayDateStr();
    const weekStart = getStartOfWeek();
    const monthStr = getMonthStr(new Date());

    switch (statPeriod) {
      case 'today':
        return records.filter((r) => r.date.startsWith(today));
      case 'week':
        return records.filter((r) => new Date(r.date.split('T')[0] + 'T00:00:00') >= weekStart);
      case 'month':
        return records.filter((r) => r.date.startsWith(monthStr));
      default:
        return records;
    }
  }, [records, statPeriod]);

  // Stats
  const stats = useMemo(() => {
    const totalTime = filteredRecords.reduce((sum, r) => sum + r.totalFocusTime, 0);
    const totalSessions = filteredRecords.reduce((sum, r) => sum + r.sessions.length, 0);
    const avgSession = totalSessions > 0 ? totalTime / totalSessions : 0;

    // Category breakdown
    const categoryMap: Record<string, number> = {};
    filteredRecords.forEach((r) => {
      r.sessions.forEach((s) => {
        const cat = s.category || 'Uncategorized';
        categoryMap[cat] = (categoryMap[cat] || 0) + s.duration;
      });
    });

    const categories = Object.entries(categoryMap)
      .map(([name, time]) => ({ name, time, percentage: totalTime > 0 ? (time / totalTime) * 100 : 0 }))
      .sort((a, b) => b.time - a.time);

    return { totalTime, totalSessions, avgSession, categories };
  }, [filteredRecords]);

  // Today's data
  const todayRecord = useMemo(() => {
    const today = getTodayDateStr();
    return records.find((r) => r.date.startsWith(today)) || null;
  }, [records]);

  const todaySessions = useMemo(() => {
    return todayRecord?.sessions ? [...todayRecord.sessions].reverse() : [];
  }, [todayRecord]);

  const todayCategoryBreakdown = useMemo(() => {
    if (!todayRecord) return [];
    const catMap: Record<string, number> = {};
    todayRecord.sessions.forEach((s) => {
      const cat = s.category || 'Uncategorized';
      catMap[cat] = (catMap[cat] || 0) + s.duration;
    });
    return Object.entries(catMap)
      .map(([name, time]) => ({ name, time, percentage: todayRecord.totalFocusTime > 0 ? (time / todayRecord.totalFocusTime) * 100 : 0 }))
      .sort((a, b) => b.time - a.time);
  }, [todayRecord]);

  // Calendar data
  const calYear = calendarMonth.getFullYear();
  const calMonth = calendarMonth.getMonth();
  const daysInMonth = getDaysInMonth(calYear, calMonth);
  const firstDay = getFirstDayOfWeek(calYear, calMonth);
  const todayStr = getTodayDateStr();

  const calendarRecordMap = useMemo(() => {
    const map: Record<string, DailyRecord> = {};
    records.forEach((r) => map[r.date.split('T')[0]] = r);
    return map;
  }, [records]);

  // Selected day record
  const selectedRecord = useMemo(() => {
    if (!selectedDate) return null;
    return calendarRecordMap[selectedDate] || null;
  }, [selectedDate, calendarRecordMap]);

  function navigateMonth(delta: number) {
    const next = new Date(calYear, calMonth + delta, 1);
    setCalendarMonth(next);
  }

  async function handleExportCSV() {
    const monthStr = getMonthStr(calendarMonth);
    const csv = await window.zenstate.exportCSV(monthStr);
    // Create a download link
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ZenState_Timesheet_${monthStr}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleDeleteSession(sessionId: string, date: string) {
    await window.zenstate.deleteSession(sessionId, date);
    onRefreshRecords();
    setDeleteConfirm(null);
  }

  async function handleSaveEdit(sessionId: string, date: string, updates: { taskLabel: string; category: string; duration: number }) {
    await window.zenstate.updateSession(sessionId, date, updates);
    onRefreshRecords();
    setEditingSession(null);
  }

  function getActivityLevel(dateStr: string): number {
    const record = calendarRecordMap[dateStr];
    if (!record) return 0;
    const hours = record.totalFocusTime / 3600;
    if (hours >= 6) return 1;
    if (hours >= 4) return 0.8;
    if (hours >= 2) return 0.5;
    return 0.2;
  }

  return (
    <div className="fade-in">
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 20 }}>Timesheet</h1>

      {/* Overall Stats */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span className="card-title" style={{ margin: 0 }}>Statistics</span>
          <div className="spacer" />
          {(['today', 'week', 'month', 'all'] as StatPeriod[]).map((period) => (
            <button
              key={period}
              className={`category-chip ${statPeriod === period ? 'selected' : ''}`}
              onClick={() => setStatPeriod(period)}
            >
              {period === 'today' ? 'Today' : period === 'week' ? 'This Week' : period === 'month' ? 'This Month' : 'All Time'}
            </button>
          ))}
        </div>

        {/* Stat Cards */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          <div style={{
            flex: 1,
            padding: 12,
            background: 'var(--zen-tertiary-bg)',
            borderRadius: 8,
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--zen-primary)' }}>
              {formatTime(stats.totalTime)}
            </div>
            <div style={{ fontSize: 10, color: 'var(--zen-secondary-text)', marginTop: 4 }}>Total Time</div>
          </div>
          <div style={{
            flex: 1,
            padding: 12,
            background: 'var(--zen-tertiary-bg)',
            borderRadius: 8,
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--zen-text)' }}>
              {stats.totalSessions}
            </div>
            <div style={{ fontSize: 10, color: 'var(--zen-secondary-text)', marginTop: 4 }}>Sessions</div>
          </div>
          <div style={{
            flex: 1,
            padding: 12,
            background: 'var(--zen-tertiary-bg)',
            borderRadius: 8,
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--zen-text)' }}>
              {formatDuration(stats.avgSession)}
            </div>
            <div style={{ fontSize: 10, color: 'var(--zen-secondary-text)', marginTop: 4 }}>Avg Session</div>
          </div>
        </div>

        {/* Time by Category */}
        {stats.categories.length > 0 && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Time by Category</div>
            {stats.categories.map((cat) => (
              <div key={cat.name} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <div style={{ width: 80, fontSize: 11, color: 'var(--zen-secondary-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {cat.name}
                </div>
                <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--zen-tertiary-bg)', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${cat.percentage}%`,
                    background: CATEGORY_COLORS[cat.name] || 'var(--zen-primary)',
                    borderRadius: 3,
                    transition: 'width 0.3s ease',
                  }} />
                </div>
                <div style={{ width: 60, fontSize: 10, color: 'var(--zen-secondary-text)', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                  {formatTime(cat.time)}
                </div>
                <div style={{ width: 35, fontSize: 10, color: 'var(--zen-tertiary-text)', textAlign: 'right' }}>
                  {Math.round(cat.percentage)}%
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Today's Sessions */}
      <div className="card">
        <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          Today's Sessions
          {todayRecord && (
            <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--zen-secondary-text)' }}>
              {formatDuration(todayRecord.totalFocusTime)} total · {todaySessions.length} sessions
            </span>
          )}
        </div>

        {/* Today's category summary */}
        {todayCategoryBreakdown.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {todayCategoryBreakdown.map((cat) => (
              <div key={cat.name} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 10,
                padding: '3px 8px',
                borderRadius: 8,
                background: 'var(--zen-tertiary-bg)',
              }}>
                <div style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: CATEGORY_COLORS[cat.name] || 'var(--zen-primary)',
                }} />
                <span style={{ color: 'var(--zen-secondary-text)' }}>{cat.name}</span>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--zen-tertiary-text)' }}>
                  {formatDuration(cat.time)}
                </span>
              </div>
            ))}
          </div>
        )}

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
                      background: CATEGORY_COLORS[session.category]
                        ? `${CATEGORY_COLORS[session.category]}22`
                        : 'var(--zen-secondary-bg)',
                      color: CATEGORY_COLORS[session.category] || 'var(--zen-secondary-text)',
                    }}>
                      {session.category}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 10, color: 'var(--zen-tertiary-text)', marginTop: 2 }}>
                  {session.startTime ? new Date(session.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                  {session.endTime ? ` — ${new Date(session.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
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
                    onClick={() => handleDeleteSession(session.id, getTodayDateStr())}
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

      {/* CSV Export */}
      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="btn btn-secondary" onClick={() => navigateMonth(-1)}>◀</button>
        <span style={{ fontSize: 13, fontWeight: 600 }}>
          {calendarMonth.toLocaleDateString('en-US', { year: 'numeric', month: 'long' })}
        </span>
        <button className="btn btn-secondary" onClick={() => navigateMonth(1)}>▶</button>
        <div className="spacer" />
        <button className="btn btn-primary" onClick={handleExportCSV}>
          📥 Export CSV
        </button>
      </div>

      {/* Calendar */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <span className="card-title" style={{ margin: 0 }}>Activity Calendar</span>
          <div className="spacer" />
          <button
            className="btn btn-secondary"
            style={{ fontSize: 10 }}
            onClick={() => setShowCalendar(!showCalendar)}
          >
            {showCalendar ? 'Hide' : 'Show'}
          </button>
        </div>

        {showCalendar && (
          <>
            {/* Day headers */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                <div key={day} style={{
                  textAlign: 'center',
                  fontSize: 9,
                  color: 'var(--zen-tertiary-text)',
                  padding: 2,
                }}>
                  {day}
                </div>
              ))}
            </div>

            {/* Calendar grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
              {/* Empty cells before first day */}
              {Array.from({ length: firstDay }).map((_, i) => (
                <div key={`empty-${i}`} style={{ aspectRatio: '1' }} />
              ))}

              {/* Day cells */}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const dayNum = i + 1;
                const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
                const level = getActivityLevel(dateStr);
                const isToday = dateStr === todayStr;
                const isSelected = dateStr === selectedDate;

                return (
                  <div
                    key={dayNum}
                    onClick={() => setSelectedDate(isSelected ? null : dateStr)}
                    style={{
                      aspectRatio: '1',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontSize: 10,
                      background: level > 0
                        ? `rgba(0, 122, 255, ${level * 0.4})`
                        : 'var(--zen-tertiary-bg)',
                      border: isSelected
                        ? '2px solid var(--zen-primary)'
                        : '2px solid transparent',
                      color: level > 0.5 ? 'white' : 'var(--zen-secondary-text)',
                      transition: 'all 0.15s ease',
                      position: 'relative',
                    }}
                  >
                    {dayNum}
                    {isToday && (
                      <div style={{
                        position: 'absolute',
                        bottom: 2,
                        width: 4,
                        height: 4,
                        borderRadius: '50%',
                        background: 'var(--zen-primary)',
                      }} />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Legend */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, justifyContent: 'center' }}>
              <span style={{ fontSize: 9, color: 'var(--zen-tertiary-text)' }}>Less</span>
              {[0.2, 0.5, 0.8, 1].map((level) => (
                <div
                  key={level}
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 2,
                    background: `rgba(0, 122, 255, ${level * 0.4})`,
                  }}
                />
              ))}
              <span style={{ fontSize: 9, color: 'var(--zen-tertiary-text)' }}>More</span>
            </div>
          </>
        )}
      </div>

      {/* Selected Day Detail */}
      {selectedDate && (
        <div className="card fade-in">
          <div className="card-title">{formatDateLabel(selectedDate)}</div>
          {selectedRecord ? (
            <>
              <div style={{ fontSize: 12, color: 'var(--zen-secondary-text)', marginBottom: 12 }}>
                {formatDuration(selectedRecord.totalFocusTime)} total · {selectedRecord.sessions.length} sessions
              </div>
              {[...selectedRecord.sessions].reverse().map((session) => (
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
                      onClick={() => setEditingSession({ session, date: selectedDate })}
                      title="Edit"
                    >
                      ✏️
                    </button>
                    {deleteConfirm === session.id ? (
                      <button
                        className="session-action-btn delete"
                        onClick={() => handleDeleteSession(session.id, selectedDate)}
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
              ))}
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: 20, color: 'var(--zen-tertiary-text)', fontSize: 12 }}>
              No recordings on this day
            </div>
          )}
        </div>
      )}

      {/* Edit Modal */}
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
