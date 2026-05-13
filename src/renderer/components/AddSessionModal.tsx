import React, { useState, useEffect, useCallback } from 'react';
import { DailySession, BasecampProject, BasecampTodoList, BasecampTodo, BasecampAuthState } from '../../shared/types';

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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Basecamp picker state — only shown if user clicks "Link to a to-do".
  const [showPicker, setShowPicker] = useState(false);
  const [authState, setAuthState] = useState<BasecampAuthState | null>(null);
  const [projects, setProjects] = useState<BasecampProject[]>([]);
  const [lists, setLists] = useState<BasecampTodoList[]>([]);
  const [todos, setTodos] = useState<BasecampTodo[]>([]);
  const [pickerProjectId, setPickerProjectId] = useState<number | undefined>(undefined);
  const [pickerListId, setPickerListId] = useState<number | undefined>(undefined);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingLists, setLoadingLists] = useState(false);
  const [loadingTodos, setLoadingTodos] = useState(false);

  useEffect(() => {
    window.zenstate.bcGetAuthState().then(setAuthState).catch(() => {});
  }, []);

  useEffect(() => {
    if (!showPicker || projects.length > 0 || !authState?.isConnected) return;
    setLoadingProjects(true);
    window.zenstate.bcListProjects().then((res) => {
      if (res.ok && res.data) setProjects(res.data);
    }).finally(() => setLoadingProjects(false));
  }, [showPicker, projects.length, authState]);

  useEffect(() => {
    if (!pickerProjectId || !showPicker) return;
    const project = projects.find((p) => p.id === pickerProjectId);
    if (!project?.todoSetId) return;
    setLoadingLists(true);
    setLists([]); setTodos([]); setPickerListId(undefined);
    window.zenstate.bcListTodoLists(pickerProjectId, project.todoSetId).then((res) => {
      if (res.ok && res.data) setLists(res.data);
    }).finally(() => setLoadingLists(false));
  }, [pickerProjectId, projects, showPicker]);

  useEffect(() => {
    if (!pickerListId || !pickerProjectId || !showPicker) return;
    setLoadingTodos(true);
    setTodos([]);
    window.zenstate.bcListTodos(pickerProjectId, pickerListId).then((res) => {
      if (res.ok && res.data) setTodos(res.data);
    }).finally(() => setLoadingTodos(false));
  }, [pickerListId, pickerProjectId, showPicker]);

  const handlePickTodo = useCallback((todo: BasecampTodo) => {
    if (!authState?.account || !pickerProjectId || !pickerListId) return;
    setLinkState({
      accountId: authState.account.id,
      projectId: pickerProjectId,
      todoId: todo.id,
      todoListId: pickerListId,
      synced: false,
    });
    setTaskLabel((prev) => prev || todo.content);
    setShowPicker(false);
  }, [authState, pickerProjectId, pickerListId]);

  const linkedProjectName = (() => {
    if (!linkState) return null;
    const proj = projects.find((p) => p.id === linkState.projectId);
    return proj?.name ?? `Project #${linkState.projectId}`;
  })();

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
          ) : linkState && !showPicker ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', background: 'var(--zen-tertiary-bg)', borderRadius: 6 }}>
              <span style={{ fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--zen-text)' }}>
                {linkedProjectName ? `${linkedProjectName} / ` : ''}
                Linked to-do #{linkState.todoId}
              </span>
              <button className="footer-btn" onClick={() => setShowPicker(true)} style={{ fontSize: 10 }}>Change</button>
              <button className="footer-btn" onClick={() => setLinkState(null)} style={{ fontSize: 10, color: 'var(--status-focused)' }}>Unlink</button>
            </div>
          ) : !showPicker ? (
            <button
              className="btn btn-secondary"
              style={{ width: '100%', fontSize: 12 }}
              onClick={() => setShowPicker(true)}
            >
              + Link to a Basecamp to-do
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8, background: 'var(--zen-tertiary-bg)', borderRadius: 6 }}>
              <select
                className="text-input"
                value={pickerProjectId ?? ''}
                onChange={(e) => setPickerProjectId(Number(e.target.value) || undefined)}
                style={{ fontSize: 12 }}
                disabled={loadingProjects}
              >
                <option value="">{loadingProjects ? 'Loading projects…' : 'Pick a project…'}</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {pickerProjectId && (
                <select
                  className="text-input"
                  value={pickerListId ?? ''}
                  onChange={(e) => setPickerListId(Number(e.target.value) || undefined)}
                  style={{ fontSize: 12 }}
                  disabled={loadingLists}
                >
                  <option value="">{loadingLists ? 'Loading lists…' : 'Pick a to-do list…'}</option>
                  {lists.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
                </select>
              )}
              {pickerListId && (
                <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--zen-divider)', borderRadius: 6, padding: 4 }}>
                  {loadingTodos && <div style={{ fontSize: 11, color: 'var(--zen-tertiary-text)', padding: 6 }}>Loading to-dos…</div>}
                  {!loadingTodos && todos.length === 0 && <div style={{ fontSize: 11, color: 'var(--zen-tertiary-text)', padding: 6 }}>No to-dos in this list.</div>}
                  {todos.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => handlePickTodo(t)}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '6px 8px', borderRadius: 4, fontSize: 12,
                        background: 'transparent', border: 'none', cursor: 'pointer',
                        color: 'var(--zen-text)', fontFamily: 'inherit',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--zen-hover)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      {t.content}
                    </button>
                  ))}
                </div>
              )}
              <button
                className="footer-btn"
                style={{ alignSelf: 'flex-end', fontSize: 10 }}
                onClick={() => setShowPicker(false)}
              >
                Cancel picker
              </button>
            </div>
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
  );
}
