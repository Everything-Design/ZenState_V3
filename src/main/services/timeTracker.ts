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
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

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

  addSession(data: { taskLabel: string; category?: string; duration: number; startTime: string; endTime: string; basecamp?: DailySession['basecamp'] }): { sessionId: string; dateStr: string } {
    const records = this.persistence.getRecords();
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

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
      basecamp: data.basecamp,
    };

    record.sessions.push(session);
    record.totalFocusTime = record.sessions.reduce((sum, s) => sum + s.duration, 0);

    this.persistence.saveRecords(records);
    return { sessionId: session.id, dateStr };
  }

  markSessionSynced(sessionId: string, dateStr: string) {
    const records = this.persistence.getRecords();
    const record = records.find((r) => r.date.startsWith(dateStr.split('T')[0]));
    if (!record) return;
    const session = record.sessions.find((s) => s.id === sessionId);
    if (!session?.basecamp) return;
    session.basecamp = { ...session.basecamp, synced: true };
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

  updateSession(sessionId: string, dateStr: string, updates: Partial<{ taskLabel: string; category: string; duration: number; notes: string; basecamp: DailySession['basecamp'] | null }>) {
    const records = this.persistence.getRecords();
    const record = records.find((r) => r.date.startsWith(dateStr.split('T')[0]));
    if (!record) return;

    const session = record.sessions.find((s) => s.id === sessionId);
    if (!session) return;

    if (updates.taskLabel !== undefined) session.taskLabel = updates.taskLabel;
    if (updates.category !== undefined) session.category = updates.category;
    if (updates.notes !== undefined) session.notes = updates.notes;
    if (updates.duration !== undefined) {
      session.duration = updates.duration;
      // Recalculate end time based on new duration
      const startMs = new Date(session.startTime).getTime();
      session.endTime = new Date(startMs + updates.duration * 1000).toISOString();
    }
    // `null` = explicit unlink; `undefined` = no change; an object replaces the link.
    if (updates.basecamp === null) {
      session.basecamp = undefined;
    } else if (updates.basecamp !== undefined) {
      session.basecamp = updates.basecamp;
    }

    record.totalFocusTime = record.sessions.reduce((sum, s) => sum + s.duration, 0);
    this.persistence.saveRecords(records);
  }

}
