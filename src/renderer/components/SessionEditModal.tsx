import React, { useState, useEffect, useCallback } from 'react';
import { DailySession, BasecampProject, BasecampTodoList, BasecampTodo, BasecampAuthState } from '../../shared/types';

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
  const [showPicker, setShowPicker] = useState(false);

  // Auth + cascade data
  const [authState, setAuthState] = useState<BasecampAuthState | null>(null);
  const [projects, setProjects] = useState<BasecampProject[]>([]);
  const [lists, setLists] = useState<BasecampTodoList[]>([]);
  const [todos, setTodos] = useState<BasecampTodo[]>([]);
  const [pickerProjectId, setPickerProjectId] = useState<number | undefined>(linkState?.projectId);
  const [pickerListId, setPickerListId] = useState<number | undefined>(linkState?.todoListId);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingLists, setLoadingLists] = useState(false);
  const [loadingTodos, setLoadingTodos] = useState(false);

  useEffect(() => {
    window.zenstate.bcGetAuthState().then(setAuthState).catch(() => {});
  }, []);

  // Lazy-load projects when the picker opens
  useEffect(() => {
    if (showPicker && projects.length === 0 && authState?.isConnected) {
      setLoadingProjects(true);
      window.zenstate.bcListProjects().then((res) => {
        if (res.ok && res.data) setProjects(res.data);
      }).finally(() => setLoadingProjects(false));
    }
  }, [showPicker, authState, projects.length]);

  // Load lists when a project is selected in the picker
  useEffect(() => {
    if (!pickerProjectId || !showPicker) return;
    const project = projects.find((p) => p.id === pickerProjectId);
    if (!project?.todoSetId) return;
    setLoadingLists(true);
    setLists([]);
    setTodos([]);
    window.zenstate.bcListTodoLists(pickerProjectId, project.todoSetId).then((res) => {
      if (res.ok && res.data) setLists(res.data);
    }).finally(() => setLoadingLists(false));
  }, [pickerProjectId, projects, showPicker]);

  // Load todos when a list is selected
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
      synced: false, // marked unsynced so the next backfill picks it up
    });
    setShowPicker(false);
  }, [authState, pickerProjectId, pickerListId]);

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

  // Render the current link as a readable summary
  const linkedTodo = linkState ? todos.find((t) => t.id === linkState.todoId) : undefined;
  const linkedProject = linkState ? projects.find((p) => p.id === linkState.projectId) : undefined;
  const linkSummary = linkState
    ? (linkedTodo && linkedProject
      ? `${linkedProject.name} / ${linkedTodo.content}`
      : `Linked Basecamp to-do (#${linkState.todoId})`)
    : null;

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
                {linkSummary}
              </span>
              <button
                className="footer-btn"
                onClick={() => { setShowPicker(true); }}
                style={{ fontSize: 10 }}
              >
                Change
              </button>
              <button
                className="footer-btn"
                onClick={() => { setLinkState(null); setShowPicker(false); }}
                style={{ fontSize: 10, color: 'var(--status-focused)' }}
              >
                Unlink
              </button>
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
                onChange={(e) => { setPickerProjectId(Number(e.target.value) || undefined); setPickerListId(undefined); }}
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
