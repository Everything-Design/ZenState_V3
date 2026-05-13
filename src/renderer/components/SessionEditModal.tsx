import React, { useState, useEffect } from 'react';
import { DailySession, PinnedTodo, BasecampAuthState, RecentTodo } from '../../shared/types';
import { PinPicker } from '../views/dashboard/TodayTab';

type BasecampLink = NonNullable<DailySession['basecamp']>;

interface Props {
  session: DailySession;
  date: string;
  onSave: (sessionId: string, date: string, updates: { taskLabel: string; duration: number; notes: string; basecamp?: BasecampLink | null }) => void;
  onClose: () => void;
}

export default function SessionEditModal({ session, date, onSave, onClose }: Props) {
  const [taskLabel, setTaskLabel] = useState(session.taskLabel);
  const [notes, setNotes] = useState(session.notes || '');
  const [hours, setHours] = useState(Math.floor(session.duration / 3600));
  const [minutes, setMinutes] = useState(Math.floor((session.duration % 3600) / 60));

  // Basecamp linking state. We model it as either:
  //  - the original link from the saved session (read-only display until user edits)
  //  - `null` meaning the user explicitly unlinked
  //  - a new BasecampLink the user just picked
  const [linkState, setLinkState] = useState<BasecampLink | null | undefined>(session.basecamp);
  // Human-readable summary for the current link (project / todo title).
  const [linkDisplayName, setLinkDisplayName] = useState<string | null>(
    session.basecamp ? `Linked Basecamp to-do (#${session.basecamp.todoId})` : null
  );
  const [showPicker, setShowPicker] = useState(false);
  const [authState, setAuthState] = useState<BasecampAuthState | null>(null);

  useEffect(() => {
    window.zenstate.bcGetAuthState().then(setAuthState).catch(() => {});
  }, []);

  const handlePicked = (item: PinnedTodo) => {
    setLinkState({
      accountId: item.accountId,
      projectId: item.projectId,
      todoId: item.todoId,
      todoListId: item.todoListId,
      synced: false,
    });
    setLinkDisplayName(`${item.projectName} / ${item.content}`);
    setShowPicker(false);
  };

  function handleSave() {
    if (!taskLabel.trim()) return;
    const duration = hours * 3600 + minutes * 60;
    // Pass `basecamp` only if the user changed it — null on explicit unlink, the
    // new object on link, undefined to leave alone.
    const basecampChanged = linkState !== session.basecamp;
    onSave(session.id, date, {
      taskLabel: taskLabel.trim(),
      duration,
      notes: notes.trim(),
      ...(basecampChanged ? { basecamp: linkState ?? null } : {}),
    });
  }

  return (
    <>
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
                {linkDisplayName ?? `Linked Basecamp to-do (#${linkState.todoId})`}
              </span>
              <button
                className="footer-btn"
                onClick={() => setShowPicker(true)}
                style={{ fontSize: 10 }}
              >
                Change
              </button>
              <button
                className="footer-btn"
                onClick={() => { setLinkState(null); setLinkDisplayName(null); }}
                style={{ fontSize: 10, color: 'var(--status-focused)' }}
              >
                Unlink
              </button>
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

        {/* Duration — direct numeric input. The inputs clamp on blur so
            out-of-range values silently snap into bounds. */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, color: 'var(--zen-secondary-text)', display: 'block', marginBottom: 4 }}>
            Duration
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="number"
                min="0"
                max="16"
                value={hours}
                onChange={(e) => setHours(parseInt(e.target.value, 10) || 0)}
                onBlur={(e) => setHours(Math.min(16, Math.max(0, parseInt(e.target.value, 10) || 0)))}
                className="text-input"
                style={{ width: 60, padding: '6px 8px', fontSize: 14, fontFamily: 'var(--font-mono)', textAlign: 'center' }}
              />
              <span style={{ fontSize: 12, color: 'var(--zen-secondary-text)' }}>h</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="number"
                min="0"
                max="59"
                value={minutes}
                onChange={(e) => setMinutes(parseInt(e.target.value, 10) || 0)}
                onBlur={(e) => setMinutes(Math.min(59, Math.max(0, parseInt(e.target.value, 10) || 0)))}
                className="text-input"
                style={{ width: 60, padding: '6px 8px', fontSize: 14, fontFamily: 'var(--font-mono)', textAlign: 'center' }}
              />
              <span style={{ fontSize: 12, color: 'var(--zen-secondary-text)' }}>m</span>
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

    {/* PinPicker — single-select mode. Clicking a row immediately picks it,
        fires handlePicked with the full PinnedTodo, and closes. The Save
        button then passes the new basecamp link to the caller; main process
        handles delete + recreate for re-parenting (no extra prompt needed).
        Rendered outside the modal-overlay so its own overlay doesn't nest. */}
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
