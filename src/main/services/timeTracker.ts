import crypto from 'crypto';
import { DailyRecord, DailySession } from '../../shared/types';

function uuidv4(): string {
  return crypto.randomUUID();
}
import { PersistenceService } from './persistence';

export class TimeTracker {
  private persistence: PersistenceService;

  constructor(persistence: PersistenceService) {
    this.persistence = persistence;
  }

  getAllRecords(): DailyRecord[] {
    return this.persistence.getRecords();
  }

  getRecordsForMonth(monthStr: string): DailyRecord[] {
    const records = this.persistence.getRecords();
    // monthStr may be "YYYY-MM" — match by prefix
    const prefix = monthStr.slice(0, 7); // "YYYY-MM"

    return records.filter((r) => {
      const datePrefix = r.date.split('T')[0].slice(0, 7); // handles both YYYY-MM-DD and ISO
      return datePrefix === prefix;
    });
  }

  getTodayRecord(): DailyRecord {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dateStr = today.toISOString().split('T')[0];

    const records = this.persistence.getRecords();
    const existing = records.find((r) => r.date.startsWith(dateStr));
    if (existing) return existing;

    return {
      id: uuidv4(),
      date: dateStr, // Store as YYYY-MM-DD for reliable matching
      totalFocusTime: 0,
      sessions: [],
    };
  }

  addSession(data: { taskLabel: string; category?: string; duration: number; startTime: string; endTime: string }) {
    const records = this.persistence.getRecords();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dateStr = today.toISOString().split('T')[0];

    let record = records.find((r) => r.date.startsWith(dateStr));
    if (!record) {
      record = {
        id: uuidv4(),
        date: dateStr, // Store as YYYY-MM-DD for reliable matching
        totalFocusTime: 0,
        sessions: [],
      };
      records.push(record);
    }

    const session: DailySession = {
      id: uuidv4(),
      taskLabel: data.taskLabel,
      startTime: data.startTime,
      endTime: data.endTime,
      duration: data.duration,
      category: data.category,
    };

    record.sessions.push(session);
    record.totalFocusTime = record.sessions.reduce((sum, s) => sum + s.duration, 0);

    this.persistence.saveRecords(records);
  }

  deleteSession(sessionId: string, dateStr: string) {
    const records = this.persistence.getRecords();
    const record = records.find((r) => r.date.startsWith(dateStr.split('T')[0]));
    if (!record) return;

    record.sessions = record.sessions.filter((s) => s.id !== sessionId);
    record.totalFocusTime = record.sessions.reduce((sum, s) => sum + s.duration, 0);

    this.persistence.saveRecords(records);
  }

  updateSession(sessionId: string, dateStr: string, updates: Partial<{ taskLabel: string; category: string; duration: number }>) {
    const records = this.persistence.getRecords();
    const record = records.find((r) => r.date.startsWith(dateStr.split('T')[0]));
    if (!record) return;

    const session = record.sessions.find((s) => s.id === sessionId);
    if (!session) return;

    if (updates.taskLabel !== undefined) session.taskLabel = updates.taskLabel;
    if (updates.category !== undefined) session.category = updates.category;
    if (updates.duration !== undefined) {
      session.duration = updates.duration;
      // Recalculate end time based on new duration
      const startMs = new Date(session.startTime).getTime();
      session.endTime = new Date(startMs + updates.duration * 1000).toISOString();
    }

    record.totalFocusTime = record.sessions.reduce((sum, s) => sum + s.duration, 0);
    this.persistence.saveRecords(records);
  }

  generateCSV(monthStr: string): string {
    const records = this.getRecordsForMonth(monthStr);
    const lines: string[] = ['Date,Day,Task,Category,Start Time,End Time,Duration (minutes),Duration (formatted)'];

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    for (const record of records.sort((a, b) => a.date.localeCompare(b.date))) {
      // Use T00:00:00 to avoid UTC timezone shift when parsing YYYY-MM-DD
      const date = new Date(record.date.split('T')[0] + 'T00:00:00');
      const dateFormatted = date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
      const dayName = dayNames[date.getDay()];

      for (const session of record.sessions.filter((s) => s.duration > 0)) {
        const startFormatted = new Date(session.startTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        const endFormatted = session.endTime ? new Date(session.endTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '';
        const durationMin = Math.round(session.duration / 60);
        const hours = Math.floor(session.duration / 3600);
        const mins = Math.floor((session.duration % 3600) / 60);
        const durationFormatted = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

        lines.push([
          escapeCSV(dateFormatted),
          escapeCSV(dayName),
          escapeCSV(session.taskLabel),
          escapeCSV(session.category || ''),
          escapeCSV(startFormatted),
          escapeCSV(endFormatted),
          String(durationMin),
          escapeCSV(durationFormatted),
        ].join(','));
      }
    }

    return lines.join('\n');
  }
}

function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
