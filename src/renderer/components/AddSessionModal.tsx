import React, { useState, useEffect } from 'react';
import { DailySession, PinnedTodo, BasecampAuthState, RecentTodo } from '../../shared/types';
import { PinPicker } from '../views/dashboard/TodayTab';

type BasecampLink = NonNullable<DailySession['basecamp']>;

interface Props {
  // Optional pre-fill — used when launching from a pinned todo's "Log time"
  // button. Locks the Basecamp link with an "unlink" affordance.
  prefill?: {
    taskLabel: string;
    basecamp?: { accountId: number; projectId: number; todoId: number; todoListId?: number };
  };
  onClose: () => void;
  onSaved: (sessionId: string, dateStr: string) => void;
}

function todayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Construct an ISO string for the chosen date at 9am local time. Manual entries
// don't have a real start moment — anchoring at 9am keeps them in the right
// daily bucket without claiming to be precise.
function makeStartTime(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d, 9, 0, 0);
  return dt.toISOString();
}

export default function AddSessionModal({ prefill, onClose, onSaved }: Props) {
  const [date, setDate] = useState(todayDateStr());
  const [taskLabel, setTaskLabel] = useState(prefill?.taskLabel ?? '');
  const [hours, setHours] = useState(0);
  const [minutes, setMinutes] = useState(30);
  const [notes, setNotes] = useState('');
  const [linkState, setLinkState] = useState<BasecampLink | null>(
    prefill?.basecamp
      ? { ...prefill.basecamp, synced: false }
      : null
  );
  // Display name for the linked todo (populated when user picks via PinPicker)
  const [linkDisplayName, setLinkDisplayName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // PinPicker state
  const [showPicker, setShowPicker] = useState(false);
  const [authState, setAuthState] = useState<BasecampAuthState | null>(null);

  useEffect(() => {
    window.zenstate.bcGetAuthState().then(setAuthState).catch(() => {});
  }, []);

  // When launched from a prefill with a known Basecamp link, show a reasonable
  // display name immediately (content comes from the prefill taskLabel).
  useEffect(() => {
    if (prefill?.basecamp && prefill.taskLabel) {
      setLinkDisplayName(prefill.taskLabel);
    }
  }, [prefill]);

  const handlePicked = (item: PinnedTodo) => {
    setLinkState({
      accountId: item.accountId,
      projectId: item.projectId,
      todoId: item.todoId,
      todoListId: item.todoListId,
      synced: false,
    });
    setLinkDisplayName(`${item.projectName} / ${item.content}`);
    setTaskLabel((prev) => prev || item.content);
    setShowPicker(false);
  };

  async function handleSave() {
    setError(null);
    const totalSec = hours * 3600 + minutes * 60;
    if (!taskLabel.trim()) { setError('Task label required.'); return; }
    if (totalSec <= 0) { setError('Duration must be greater than zero.'); return; }
    setSaving(true);
    const res = await window.zenstate.addSession({
      taskLabel: taskLabel.trim(),
      duration: totalSec,
      startTime: makeStartTime(date),
      notes: notes.trim() || undefined,
      basecamp: linkState ?? null,
    }).catch((e) => ({ ok: false as const, error: (e as Error).message }));
    setSaving(false);
    if (!res.ok) {
      setError(res.error || 'Failed to add session.');
      return;
    }
    onSaved(res.sessionId!, res.dateStr!);
  }

  return (
    <>
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ width: 460 }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Add session</div>
        <div style={{ fontSize: 11, color: 'var(--zen-tertiary-text)', marginBottom: 16, lineHeight: 1.5 }}>
          Log time you spent without having to start a timer. Linked sessions post to Basecamp immediately.
        </div>

        {/* Task label */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, color: 'var(--zen-secondary-text)', display: 'block', marginBottom: 4 }}>
            What did you work on?
          </label>
          <input
            className="text-input"
            value={taskLabel}
            onChange={(e) => setTaskLabel(e.target.value)}
            placeholder="e.g. Reviewed L3 wireframes"
            autoFocus
          />
        </div>

        {/* Basecamp link */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, color: 'var(--zen-secondary-text)', display: 'block', marginBottom: 4 }}>
            Basecamp
          </label>
          {!authState?.isConnected ? (
            <div style={{ fontSize: 11, color: 'var(--zen-tertiary-text)', padding: '6px 8px' }}>
              Connect Basecamp in Settings to link this session to a to-do.
            </div>
          ) : linkState ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', background: 'var(--zen-tertiary-bg)', borderRadius: 6 }}>
              <span style={{ fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--zen-text)' }}>
                {linkDisplayName ?? `Linked to-do #${linkState.todoId}`}
              </span>
              <button className="footer-btn" onClick={() => setShowPicker(true)} style={{ fontSize: 10 }}>Change</button>
              <button className="footer-btn" onClick={() => { setLinkState(null); setLinkDisplayName(null); }} style={{ fontSize: 10, color: 'var(--status-focused)' }}>Unlink</button>
            </div>
          ) : (
            <button
              className="btn btn-secondary"
              style={{ width: '100%', fontSize: 12 }}
              onClick={() => setShowPicker(true)}
            >
              + Link to a Basecamp to-do
            </button>
          )}
        </div>

        {/* Duration + Date side-by-side */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--zen-secondary-text)', display: 'block', marginBottom: 4 }}>Duration</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="number"
                  min="0"
                  max="16"
                  value={hours}
                  onChange={(e) => setHours(parseInt(e.target.value, 10) || 0)}
                  onBlur={(e) => setHours(Math.min(16, Math.max(0, parseInt(e.target.value, 10) || 0)))}
                  className="text-input"
                  style={{ width: 56, padding: '6px 8px', fontSize: 14, fontFamily: 'var(--font-mono)', textAlign: 'center' }}
                />
                <span style={{ fontSize: 12, color: 'var(--zen-secondary-text)' }}>h</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="number"
                  min="0"
                  max="59"
                  value={minutes}
                  onChange={(e) => setMinutes(parseInt(e.target.value, 10) || 0)}
                  onBlur={(e) => setMinutes(Math.min(59, Math.max(0, parseInt(e.target.value, 10) || 0)))}
                  className="text-input"
                  style={{ width: 56, padding: '6px 8px', fontSize: 14, fontFamily: 'var(--font-mono)', textAlign: 'center' }}
                />
                <span style={{ fontSize: 12, color: 'var(--zen-secondary-text)' }}>m</span>
              </div>
            </div>
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--zen-secondary-text)', display: 'block', marginBottom: 4 }}>Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              max={todayDateStr()}
              className="text-input"
              style={{ padding: '6px 8px', fontSize: 13, fontFamily: 'inherit' }}
            />
          </div>
        </div>

        {/* Notes */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, color: 'var(--zen-secondary-text)', display: 'block', marginBottom: 4 }}>Notes</label>
          <textarea
            className="text-input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="What did you work on? (optional — becomes the Basecamp timesheet description)"
            style={{ resize: 'vertical' }}
          />
        </div>

        {error && (
          <div style={{ fontSize: 11, color: 'var(--status-focused)', marginBottom: 12 }}>{error}</div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving || !taskLabel.trim() || (hours * 60 + minutes) === 0}
          >
            {saving ? 'Saving…' : 'Save session'}
          </button>
        </div>
      </div>
    </div>

    {/* PinPicker — single-select: clicking a todo immediately picks it and
        closes. We pass onPin which receives the full PinnedTodo so we can
        extract projectId / todoListId / accountId for the session's basecamp
        field without any additional fetch. Rendered outside the modal-overlay
        so its own overlay doesn't nest inside ours. */}
    {showPicker && authState?.isConnected && authState.account && (
      <PinPicker
        open={showPicker}
        mode="single"
        target="today"
        recents={[] as RecentTodo[]}
        alreadyPinned={new Set<number>()}
        accountId={authState.account.id}
        onPickedItem={handlePicked}
        onClose={() => setShowPicker(false)}
        title="Link to a Basecamp to-do"
      />
    )}
    </>
  );
}
