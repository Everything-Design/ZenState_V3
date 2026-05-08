import React, { useState, useEffect, useCallback } from 'react';
import {
  Search, Play, Square, MessageSquare, Plus, Folder, ListTodo, Briefcase, Clock3, RefreshCw,
} from 'lucide-react';
import {
  BasecampProject, BasecampTodoList, BasecampTodo, BasecampAuthState,
} from '../../../shared/types';

// ── Types ──────────────────────────────────────────────────────

interface TimerState {
  elapsed: number;
  isRunning: boolean;
  isPaused: boolean;
  taskLabel: string;
  category?: string;
}

interface Props {
  timerState: TimerState;
  onOpenSettings: () => void;
}

interface InlineEdit {
  todoId: number;
  mode: 'note' | 'subtask';
}

interface NoteState {
  [todoId: number]: { text: string; success: boolean; loading: boolean; error?: string };
}

interface SubtaskState {
  [todoId: number]: string;
}

// ── Helpers ────────────────────────────────────────────────────

function truncate(text: string, maxLen = 64): string {
  return text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
}

function formatHrs(hours: number): string {
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

// ── Column Panel ───────────────────────────────────────────────

function ColumnPanel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      overflowY: 'auto',
      borderRight: '1px solid var(--zen-divider)',
      ...style,
    }}>
      {children}
    </div>
  );
}

// ── Projects Column ────────────────────────────────────────────

interface ProjectsColumnProps {
  authState: BasecampAuthState;
  selectedId: number | null;
  refreshKey: number;
  onSelect: (p: BasecampProject) => void;
}

function ProjectsColumn({ authState, selectedId, refreshKey, onSelect }: ProjectsColumnProps) {
  const [projects, setProjects] = useState<BasecampProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    setLoading(true);
    setError(null);
    window.zenstate.bcListProjects()
      .then((res) => {
        if (res.ok && res.data) setProjects(res.data);
        else setError(res.error ?? 'Failed to load projects');
        setLoading(false);
      })
      .catch((e: Error) => { setError(e.message); setLoading(false); });
  }, [refreshKey]);

  const filtered = search
    ? projects.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    : projects;

  return (
    <ColumnPanel style={{ width: 220, flexShrink: 0 }}>
      {/* Column header */}
      <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid var(--zen-divider)', flexShrink: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--zen-secondary-text)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
          Projects
          {authState.account && (
            <span style={{ fontWeight: 400, color: 'var(--zen-tertiary-text)', marginLeft: 6, textTransform: 'none', letterSpacing: 0 }}>
              · {authState.account.name}
            </span>
          )}
        </div>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <Search size={11} style={{ position: 'absolute', left: 7, color: 'var(--zen-tertiary-text)', pointerEvents: 'none' }} />
          <input
            className="text-input"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: 22, fontSize: 12, height: 28 }}
          />
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 6px' }}>
        {loading && <div style={emptyStyle}>Loading…</div>}
        {error && <div style={{ ...emptyStyle, color: 'var(--status-focused)' }}>{error}</div>}
        {!loading && !error && filtered.length === 0 && (
          <div style={emptyStyle}>No projects</div>
        )}
        {filtered.map((p) => (
          <button
            key={p.id}
            onClick={() => onSelect(p)}
            style={{
              ...colRowStyle,
              background: selectedId === p.id ? 'var(--zen-primary)' : 'transparent',
              color: selectedId === p.id ? 'white' : 'var(--zen-text)',
            }}
            onMouseEnter={(e) => { if (selectedId !== p.id) e.currentTarget.style.background = 'var(--zen-hover)'; }}
            onMouseLeave={(e) => { if (selectedId !== p.id) e.currentTarget.style.background = 'transparent'; }}
          >
            <Folder size={12} style={{ flexShrink: 0, opacity: 0.7 }} />
            <div style={{ flex: 1, overflow: 'hidden', textAlign: 'left' }}>
              <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.name}
              </div>
              {p.description && (
                <div style={{ fontSize: 10, opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.description}
                </div>
              )}
            </div>
          </button>
        ))}
      </div>
    </ColumnPanel>
  );
}

// ── Todo Lists Column ──────────────────────────────────────────

interface ListsColumnProps {
  project: BasecampProject;
  selectedId: number | null;
  onSelect: (list: BasecampTodoList) => void;
}

function ListsColumn({ project, selectedId, onSelect }: ListsColumnProps) {
  const [lists, setLists] = useState<BasecampTodoList[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLists([]);
    setError(null);
    if (!project.todoSetId) {
      setError('No to-do set for this project');
      setLoading(false);
      return;
    }
    setLoading(true);
    window.zenstate.bcListTodoLists(project.id, project.todoSetId)
      .then((res) => {
        if (res.ok && res.data) setLists(res.data);
        else setError(res.error ?? 'Failed to load lists');
        setLoading(false);
      })
      .catch((e: Error) => { setError(e.message); setLoading(false); });
  }, [project.id, project.todoSetId]);

  return (
    <ColumnPanel style={{ width: 200, flexShrink: 0 }}>
      <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid var(--zen-divider)', flexShrink: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--zen-secondary-text)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          To-do Lists
        </div>
        <div style={{ fontSize: 11, color: 'var(--zen-tertiary-text)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {project.name}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 6px' }}>
        {loading && <div style={emptyStyle}>Loading…</div>}
        {error && <div style={{ ...emptyStyle, color: 'var(--status-focused)' }}>{error}</div>}
        {!loading && !error && lists.length === 0 && (
          <div style={emptyStyle}>No lists</div>
        )}
        {lists.map((list) => (
          <button
            key={list.id}
            onClick={() => onSelect(list)}
            style={{
              ...colRowStyle,
              background: selectedId === list.id ? 'var(--zen-primary)' : 'transparent',
              color: selectedId === list.id ? 'white' : 'var(--zen-text)',
            }}
            onMouseEnter={(e) => { if (selectedId !== list.id) e.currentTarget.style.background = 'var(--zen-hover)'; }}
            onMouseLeave={(e) => { if (selectedId !== list.id) e.currentTarget.style.background = 'transparent'; }}
          >
            <ListTodo size={12} style={{ flexShrink: 0, opacity: 0.7 }} />
            <div style={{ flex: 1, overflow: 'hidden', textAlign: 'left' }}>
              <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {list.title}
              </div>
              {list.description && (
                <div style={{ fontSize: 10, opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {list.description}
                </div>
              )}
            </div>
          </button>
        ))}
      </div>
    </ColumnPanel>
  );
}

// ── Todos Column ───────────────────────────────────────────────

interface TodosColumnProps {
  authState: BasecampAuthState;
  project: BasecampProject;
  list: BasecampTodoList;
  timerState: TimerState;
}

function TodosColumn({ authState, project, list, timerState }: TodosColumnProps) {
  const [todos, setTodos] = useState<BasecampTodo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inlineEdit, setInlineEdit] = useState<InlineEdit | null>(null);
  const [noteState, setNoteState] = useState<NoteState>({});
  const [subtaskState, setSubtaskState] = useState<SubtaskState>({});
  const [addTaskInput, setAddTaskInput] = useState('');
  const [addingTask, setAddingTask] = useState(false);
  const [hoveredTodo, setHoveredTodo] = useState<number | null>(null);
  const [hoursByTodo, setHoursByTodo] = useState<Map<number, number>>(new Map());

  const fetchTodos = useCallback(() => {
    setLoading(true);
    window.zenstate.bcListTodos(project.id, list.id)
      .then((res) => {
        if (res.ok && res.data) setTodos(res.data);
        else setError(res.error ?? 'Failed to load todos');
        setLoading(false);
      })
      .catch((e: Error) => { setError(e.message); setLoading(false); });
  }, [project.id, list.id]);

  const fetchTimesheet = useCallback(() => {
    window.zenstate.bcGetProjectTimesheet(project.id)
      .then((res) => {
        if (res.ok && res.data) {
          const totals = new Map<number, number>();
          for (const entry of res.data) {
            const hrs = parseFloat(entry.hours) || 0;
            totals.set(entry.parentId, (totals.get(entry.parentId) ?? 0) + hrs);
          }
          setHoursByTodo(totals);
        }
      })
      .catch(() => { /* timesheet may be disabled — silently skip */ });
  }, [project.id]);

  useEffect(() => {
    setTodos([]);
    setError(null);
    setInlineEdit(null);
    setNoteState({});
    setSubtaskState({});
    setAddTaskInput('');
    fetchTodos();
    fetchTimesheet();
  }, [fetchTodos, fetchTimesheet]);

  useEffect(() => {
    const handler = (...args: unknown[]) => {
      const data = args[0] as { projectId?: number };
      if (!data || data.projectId === project.id) fetchTimesheet();
    };
    window.zenstate.on('basecamp:timesheet-updated', handler);
    return () => { window.zenstate.removeAllListeners('basecamp:timesheet-updated'); };
  }, [project.id, fetchTimesheet]);

  const isThisTodoRunning = (todo: BasecampTodo) =>
    timerState.isRunning && timerState.taskLabel === todo.content;

  const handleStartTimer = (todo: BasecampTodo) => {
    if (!authState.account) return;
    window.zenstate.startTimer(todo.content, undefined, undefined, {
      accountId: authState.account.id,
      projectId: project.id,
      todoId: todo.id,
      todoListId: list.id,
    });
  };

  const handleSubmitNote = async (todoId: number) => {
    const text = noteState[todoId]?.text?.trim();
    if (!text) return;
    setNoteState((prev) => ({ ...prev, [todoId]: { ...prev[todoId], loading: true, error: undefined } }));
    const res = await window.zenstate
      .bcPostComment({ projectId: project.id, todoId, content: text })
      .catch((e: Error) => ({ ok: false as const, error: e.message }));
    if (res.ok) {
      setNoteState((prev) => ({ ...prev, [todoId]: { text: '', success: true, loading: false } }));
      setTimeout(() => {
        setInlineEdit(null);
        setNoteState((prev) => { const n = { ...prev }; delete n[todoId]; return n; });
      }, 1200);
    } else {
      setNoteState((prev) => ({
        ...prev,
        [todoId]: { ...prev[todoId], loading: false, error: res.error || 'Failed to post note. Try again.' },
      }));
    }
  };

  const handleAddSubtask = async (parentTodo: BasecampTodo) => {
    const content = subtaskState[parentTodo.id]?.trim();
    if (!content) return;
    await window.zenstate.bcCreateTodo({ projectId: project.id, todoListId: list.id, content, parentId: parentTodo.id });
    setSubtaskState((prev) => { const n = { ...prev }; delete n[parentTodo.id]; return n; });
    setInlineEdit(null);
    fetchTodos();
  };

  const handleAddTask = async () => {
    const content = addTaskInput.trim();
    if (!content) return;
    setAddingTask(true);
    await window.zenstate.bcCreateTodo({ projectId: project.id, todoListId: list.id, content });
    setAddTaskInput('');
    setAddingTask(false);
    fetchTodos();
  };

  // Build flat + indented render list (parents first, children indented)
  const parentIds = new Set(todos.filter((t) => !t.parentId).map((t) => t.id));
  const orderedTodos: { todo: BasecampTodo; isChild: boolean }[] = [];
  for (const parent of todos.filter((t) => !t.parentId)) {
    orderedTodos.push({ todo: parent, isChild: false });
    for (const child of todos.filter((t) => t.parentId === parent.id)) {
      orderedTodos.push({ todo: child, isChild: true });
    }
  }
  for (const todo of todos) {
    if (todo.parentId && !parentIds.has(todo.parentId)) {
      orderedTodos.push({ todo, isChild: true });
    }
  }

  return (
    <ColumnPanel style={{ flex: 1, borderRight: 'none' }}>
      <div style={{ padding: '12px 16px 8px', borderBottom: '1px solid var(--zen-divider)', flexShrink: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--zen-secondary-text)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          To-dos
        </div>
        <div style={{ fontSize: 11, color: 'var(--zen-tertiary-text)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {list.title}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px' }}>
        {loading && <div style={emptyStyle}>Loading…</div>}
        {error && <div style={{ ...emptyStyle, color: 'var(--status-focused)' }}>{error}</div>}
        {!loading && !error && orderedTodos.length === 0 && (
          <div style={emptyStyle}>No to-dos in this list</div>
        )}

        {orderedTodos.map(({ todo, isChild }) => {
          const running = isThisTodoRunning(todo);
          const isEditing = inlineEdit?.todoId === todo.id;
          const noteData = noteState[todo.id];

          return (
            <div
              key={todo.id}
              style={{ marginLeft: isChild ? 18 : 0, marginBottom: 2 }}
              onMouseEnter={() => setHoveredTodo(todo.id)}
              onMouseLeave={() => { if (!isEditing) setHoveredTodo(null); }}
            >
              {/* Todo row */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                padding: '6px 8px',
                borderRadius: 7,
                background: isEditing ? 'var(--zen-secondary-bg)' : 'transparent',
                transition: 'background 0.12s',
              }}
                onMouseEnter={(e) => { if (!isEditing) e.currentTarget.style.background = 'var(--zen-tertiary-bg)'; }}
                onMouseLeave={(e) => { if (!isEditing) e.currentTarget.style.background = 'transparent'; }}
              >
                {/* Checkbox (read-only) */}
                <div style={{
                  width: 14, height: 14, borderRadius: 3.5, border: '1.5px solid var(--zen-divider)',
                  flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: todo.completed ? 'var(--zen-primary)' : 'transparent',
                }}>
                  {todo.completed && <span style={{ fontSize: 9, color: 'white', lineHeight: 1 }}>✓</span>}
                </div>

                {/* Content */}
                <span style={{
                  flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  color: todo.completed ? 'var(--zen-tertiary-text)' : 'var(--zen-text)',
                  textDecoration: todo.completed ? 'line-through' : 'none',
                }}>
                  {truncate(todo.content)}
                </span>

                {/* Tracked hours badge */}
                {hoursByTodo.has(todo.id) && (
                  <span
                    title={`${hoursByTodo.get(todo.id)!.toFixed(2)} hours tracked`}
                    style={{
                      flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 3,
                      padding: '2px 7px', borderRadius: 7, fontSize: 11, fontWeight: 500,
                      color: 'var(--status-available)',
                      background: 'rgba(52, 199, 89, 0.10)',
                      border: '1px solid rgba(52, 199, 89, 0.18)',
                    }}
                  >
                    <Clock3 size={10} />
                    {formatHrs(hoursByTodo.get(todo.id)!)}
                  </span>
                )}

                {/* Hover actions */}
                {(hoveredTodo === todo.id || isEditing) && (
                  <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                    <button
                      onClick={() => running ? window.zenstate.stopTimer() : handleStartTimer(todo)}
                      style={{ ...actionBtnStyle, color: running ? 'var(--status-focused)' : 'var(--status-available)' }}
                      title={running ? 'Stop timer' : 'Start timer'}
                    >
                      {running ? <Square size={12} /> : <Play size={12} />}
                    </button>
                    <button
                      onClick={() => setInlineEdit(isEditing && inlineEdit?.mode === 'note' ? null : { todoId: todo.id, mode: 'note' })}
                      style={{ ...actionBtnStyle, color: isEditing && inlineEdit?.mode === 'note' ? 'var(--zen-primary)' : 'var(--zen-secondary-text)' }}
                      title="Add note"
                    >
                      <MessageSquare size={12} />
                    </button>
                    {!isChild && (
                      <button
                        onClick={() => setInlineEdit(isEditing && inlineEdit?.mode === 'subtask' ? null : { todoId: todo.id, mode: 'subtask' })}
                        style={{ ...actionBtnStyle, color: isEditing && inlineEdit?.mode === 'subtask' ? 'var(--zen-primary)' : 'var(--zen-secondary-text)' }}
                        title="Add subtask"
                      >
                        <Plus size={12} />
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Inline note editor */}
              {isEditing && inlineEdit?.mode === 'note' && (
                <div style={{ margin: '4px 8px 6px 21px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <textarea
                    autoFocus
                    rows={2}
                    placeholder="Add a note…"
                    value={noteData?.text ?? ''}
                    onChange={(e) => setNoteState((prev) => ({ ...prev, [todo.id]: { text: e.target.value, success: false, loading: false } }))}
                    style={{ ...inputStyle, resize: 'none', fontSize: 12, lineHeight: 1.4, fontFamily: 'inherit' }}
                  />
                  {noteData?.error && (
                    <span style={{ fontSize: 10, color: 'var(--status-occupied, #ff453a)' }}>{noteData.error}</span>
                  )}
                  <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', alignItems: 'center' }}>
                    {noteData?.success && <span style={{ fontSize: 10, color: 'var(--status-available)' }}>✓ Saved</span>}
                    <button onClick={() => setInlineEdit(null)} style={cancelBtnStyle}>Cancel</button>
                    <button
                      onClick={() => handleSubmitNote(todo.id)}
                      disabled={noteData?.loading || !noteData?.text?.trim()}
                      style={submitBtnStyle}
                    >
                      {noteData?.loading ? '…' : 'Submit'}
                    </button>
                  </div>
                </div>
              )}

              {/* Inline subtask editor */}
              {isEditing && inlineEdit?.mode === 'subtask' && (
                <div style={{ margin: '4px 8px 6px 21px', display: 'flex', gap: 4 }}>
                  <input
                    autoFocus
                    placeholder="Subtask name…"
                    value={subtaskState[todo.id] ?? ''}
                    onChange={(e) => setSubtaskState((prev) => ({ ...prev, [todo.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddSubtask(todo);
                      if (e.key === 'Escape') setInlineEdit(null);
                    }}
                    style={{ ...inputStyle, flex: 1, fontSize: 12 }}
                  />
                  <button onClick={() => handleAddSubtask(todo)} style={submitBtnStyle}>Add</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add Task footer */}
      <div style={{ padding: '6px 12px 10px', borderTop: '1px solid var(--zen-divider)', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <Plus size={13} style={{ color: 'var(--zen-tertiary-text)', flexShrink: 0 }} />
          <input
            placeholder="Add task…"
            value={addTaskInput}
            onChange={(e) => setAddTaskInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAddTask(); }}
            style={{ ...inputStyle, flex: 1, fontSize: 12, background: 'transparent', border: 'none', padding: '2px 0', outline: 'none' }}
          />
          {addTaskInput.trim() && (
            <button onClick={handleAddTask} disabled={addingTask} style={submitBtnStyle}>
              {addingTask ? '…' : 'Add'}
            </button>
          )}
        </div>
      </div>
    </ColumnPanel>
  );
}

// ── Root ProjectsTab ───────────────────────────────────────────

export default function ProjectsTab({ timerState, onOpenSettings }: Props) {
  const [authState, setAuthState] = useState<BasecampAuthState>({ isConnected: false });
  const [authLoading, setAuthLoading] = useState(true);
  const [selectedProject, setSelectedProject] = useState<BasecampProject | null>(null);
  const [selectedList, setSelectedList] = useState<BasecampTodoList | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    window.zenstate.bcGetAuthState()
      .then((state) => { setAuthState(state); setAuthLoading(false); })
      .catch(() => setAuthLoading(false));

    const handler = (...args: unknown[]) => {
      const state = args[0] as BasecampAuthState;
      setAuthState(state);
    };
    window.zenstate.on('basecamp:auth-changed', handler);
    return () => { window.zenstate.removeAllListeners('basecamp:auth-changed'); };
  }, []);

  const handleSelectProject = (p: BasecampProject) => {
    if (p.id !== selectedProject?.id) {
      setSelectedProject(p);
      setSelectedList(null);
    }
  };

  if (authLoading) {
    return (
      <div className="fade-in" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <span style={{ color: 'var(--zen-secondary-text)', fontSize: 13 }}>Loading…</span>
      </div>
    );
  }

  if (!authState.isConnected) {
    return (
      <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 14 }}>
        <Briefcase size={36} style={{ color: 'var(--zen-tertiary-text)' }} />
        <div style={{ fontSize: 16, fontWeight: 600 }}>Connect Basecamp</div>
        <div style={{ fontSize: 12, color: 'var(--zen-secondary-text)', textAlign: 'center', lineHeight: 1.6, maxWidth: 280 }}>
          Connect Basecamp in Settings to browse your projects. Sessions stay on your Mac until you review and share them with your team.
        </div>
        <button className="btn btn-primary" style={{ marginTop: 4 }} onClick={onOpenSettings}>
          Settings → Basecamp
        </button>
      </div>
    );
  }

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Tab header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexShrink: 0 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Projects</h1>
        <button
          onClick={() => setRefreshKey((k) => k + 1)}
          title="Refresh projects"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--zen-secondary-text)',
            display: 'flex',
            alignItems: 'center',
            padding: 4,
            borderRadius: 6,
          }}
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Three-column panel */}
      <div className="card" style={{ display: 'flex', flex: 1, overflow: 'hidden', padding: 0, minHeight: 0 }}>
        <ProjectsColumn
          authState={authState}
          selectedId={selectedProject?.id ?? null}
          refreshKey={refreshKey}
          onSelect={handleSelectProject}
        />

        {selectedProject ? (
          <ListsColumn
            project={selectedProject}
            selectedId={selectedList?.id ?? null}
            onSelect={setSelectedList}
          />
        ) : (
          <div style={{ width: 200, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRight: '1px solid var(--zen-divider)' }}>
            <span style={{ fontSize: 12, color: 'var(--zen-tertiary-text)', textAlign: 'center', padding: 16 }}>
              Select a project
            </span>
          </div>
        )}

        {selectedProject && selectedList ? (
          <TodosColumn
            authState={authState}
            project={selectedProject}
            list={selectedList}
            timerState={timerState}
          />
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--zen-tertiary-text)', textAlign: 'center', padding: 16 }}>
              {selectedProject ? 'Select a to-do list' : 'Select a project to get started'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Shared styles ──────────────────────────────────────────────

const colRowStyle: React.CSSProperties = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  gap: 7,
  padding: '7px 8px',
  border: 'none',
  cursor: 'pointer',
  borderRadius: 6,
  fontFamily: 'inherit',
  transition: 'background 0.12s',
};

const actionBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: '3px 4px',
  borderRadius: 5,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  opacity: 0.85,
};

const inputStyle: React.CSSProperties = {
  background: 'var(--zen-secondary-bg)',
  border: '1px solid var(--zen-divider)',
  borderRadius: 6,
  color: 'var(--zen-text)',
  padding: '5px 9px',
  fontSize: 13,
  fontFamily: 'inherit',
  outline: 'none',
  width: '100%',
};

const submitBtnStyle: React.CSSProperties = {
  background: 'var(--zen-primary)',
  border: 'none',
  borderRadius: 5,
  color: 'white',
  cursor: 'pointer',
  fontSize: 11,
  padding: '4px 10px',
  fontFamily: 'inherit',
  fontWeight: 600,
};

const cancelBtnStyle: React.CSSProperties = {
  background: 'var(--zen-secondary-bg)',
  border: '1px solid var(--zen-divider)',
  borderRadius: 5,
  color: 'var(--zen-secondary-text)',
  cursor: 'pointer',
  fontSize: 11,
  padding: '4px 10px',
  fontFamily: 'inherit',
};

const emptyStyle: React.CSSProperties = {
  textAlign: 'center',
  padding: '24px 12px',
  color: 'var(--zen-tertiary-text)',
  fontSize: 12,
};
