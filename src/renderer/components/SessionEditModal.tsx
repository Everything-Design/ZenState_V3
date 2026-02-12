import React, { useState } from 'react';
import { DailySession } from '../../shared/types';

interface Props {
  session: DailySession;
  date: string;
  categories: string[];
  onSave: (sessionId: string, date: string, updates: { taskLabel: string; category: string; duration: number; notes: string }) => void;
  onClose: () => void;
}

export default function SessionEditModal({ session, date, categories, onSave, onClose }: Props) {
  const [taskLabel, setTaskLabel] = useState(session.taskLabel);
  const [category, setCategory] = useState(session.category || '');
  const [notes, setNotes] = useState(session.notes || '');
  const [hours, setHours] = useState(Math.floor(session.duration / 3600));
  const [minutes, setMinutes] = useState(Math.floor((session.duration % 3600) / 60));

  function handleSave() {
    if (!taskLabel.trim()) return;
    const duration = hours * 3600 + minutes * 60;
    onSave(session.id, date, {
      taskLabel: taskLabel.trim(),
      category,
      duration,
      notes: notes.trim(),
    });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Edit Session</div>

        {/* Task Label */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, color: 'var(--zen-secondary-text)', display: 'block', marginBottom: 4 }}>
            Task
          </label>
          <input
            className="text-input"
            value={taskLabel}
            onChange={(e) => setTaskLabel(e.target.value)}
            autoFocus
          />
        </div>

        {/* Category */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, color: 'var(--zen-secondary-text)', display: 'block', marginBottom: 4 }}>
            Category
          </label>
          <select
            className="text-input"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            style={{ cursor: 'pointer' }}
          >
            <option value="">None</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>

        {/* Duration */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, color: 'var(--zen-secondary-text)', display: 'block', marginBottom: 4 }}>
            Duration
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button className="btn btn-secondary" onClick={() => setHours(Math.max(0, hours - 1))}>−</button>
              <span style={{ fontSize: 14, fontFamily: 'var(--font-mono)', width: 28, textAlign: 'center' }}>{hours}</span>
              <button className="btn btn-secondary" onClick={() => setHours(Math.min(23, hours + 1))}>+</button>
              <span style={{ fontSize: 11, color: 'var(--zen-secondary-text)' }}>h</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button className="btn btn-secondary" onClick={() => setMinutes(Math.max(0, minutes - 1))}>−</button>
              <span style={{ fontSize: 14, fontFamily: 'var(--font-mono)', width: 28, textAlign: 'center' }}>{minutes}</span>
              <button className="btn btn-secondary" onClick={() => setMinutes(Math.min(59, minutes + 1))}>+</button>
              <span style={{ fontSize: 11, color: 'var(--zen-secondary-text)' }}>m</span>
            </div>
          </div>
        </div>

        {/* Notes */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, color: 'var(--zen-secondary-text)', display: 'block', marginBottom: 4 }}>
            Notes
          </label>
          <textarea
            className="text-input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Add session notes (optional)"
            style={{ resize: 'vertical' }}
          />
        </div>

        {/* Started at (display only) */}
        {session.startTime && (
          <div style={{ fontSize: 11, color: 'var(--zen-tertiary-text)', marginBottom: 16 }}>
            Started: {new Date(session.startTime).toLocaleString()}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={!taskLabel.trim()}>Save</button>
        </div>
      </div>
    </div>
  );
}
