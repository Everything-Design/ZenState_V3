import React, { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft, Search, Play, Square, MessageSquare, Plus, Folder, ListTodo, Briefcase, Clock3,
} from 'lucide-react';
import { BasecampProject, BasecampTodoList, BasecampTodo, BasecampAuthState, BasecampTimesheetEntry } from '../../shared/types';

interface Props {
  onBack: () => void;
  onOpenSettings: () => void;
  timerState: { isRunning: boolean; isPaused: boolean; taskLabel: string; elapsed: number };
}

type Step = 'projects' | 'lists' | 'todos';

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

function truncate(text: string, maxLen = 52): string {
  return text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
}

// Format decimal hours as "Xh Ym" (e.g. 1.5 → "1h 30m", 0.05 → "3m", 46.5 → "46h 30m").
function formatHrs(hours: number): string {
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

// ── Project List Level ─────────────────────────────────────────

interface ProjectListProps {
  authState: BasecampAuthState;
  onSelectProject: (p: BasecampProject) => void;
  onBack: () => void;
}

function ProjectList({ authState, onSelectProject, onBack }: ProjectListProps) {
  const [projects, setProjects] = useState<BasecampProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    setLoading(true);
    window.zenstate.bcListProjects().then((res) => {
      if (res.ok && res.data) {
        setProjects(res.data);
      } else {
        setError(res.error ?? 'Failed to load projects');
      }
      setLoading(false);
    }).catch((e: Error) => { setError(e.message); setLoading(false); });
  }, []);

  const filtered = search
    ? projects.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    : projects;

  return (
    <div className="popover fade-in" style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '12px 16px 8px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--zen-divider)' }}>
        <button onClick={onBack} style={iconBtnStyle} title="Back">
          <ArrowLeft size={15} />
        </button>
        <Briefcase size={14} style={{ color: 'var(--zen-secondary-text)' }} />
        <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>Projects</span>
        {authState.account && (
          <span style={{ fontSize: 10, color: 'var(--zen-tertiary-text)' }}>{authState.account.name}</span>
        )}
      </div>

      <div style={{ padding: '8px 16px' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <Search size={12} style={{ position: 'absolute', left: 8, color: 'var(--zen-tertiary-text)' }} />
          <input
            className="text-input"
            placeholder="Search projects…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: 24, fontSize: 12 }}
          />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 8px' }}>
        {loading && <div style={emptyStyle}>Loading…</div>}
        {error && <div style={{ ...emptyStyle, color: 'var(--status-focused)' }}>{error}</div>}
        {!loading && !error && filtered.length === 0 && (
          <div style={emptyStyle}>No projects found</div>
        )}
        {filtered.map((p) => (
          <button key={p.id} onClick={() => onSelectProject(p)} style={rowBtnStyle}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--zen-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
            <Folder size={13} style={{ color: 'var(--zen-secondary-text)', flexShrink: 0 }} />
            <div style={{ flex: 1, overflow: 'hidden', textAlign: 'left' }}>
              <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
              {p.description && (
                <div style={{ fontSize: 10, color: 'var(--zen-tertiary-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.description}</div>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Todo List Level ────────────────────────────────────────────

interface TodoListLevelProps {
  project: BasecampProject;
  onSelectList: (list: BasecampTodoList) => void;
  onBack: () => void;
}

function TodoListLevel({ project, onSelectList, onBack }: TodoListLevelProps) {
  const [lists, setLists] = useState<BasecampTodoList[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!project.todoSetId) {
      setError('No to-do set for this project');
      setLoading(false);
      return;
    }
    setLoading(true);
    window.zenstate.bcListTodoLists(project.id, project.todoSetId).then((res) => {
      if (res.ok && res.data) {
        setLists(res.data);
      } else {
        setError(res.error ?? 'Failed to load lists');
      }
      setLoading(false);
    }).catch((e: Error) => { setError(e.message); setLoading(false); });
  }, [project]);

  return (
    <div className="popover fade-in" style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '12px 16px 8px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--zen-divider)' }}>
        <button onClick={onBack} style={iconBtnStyle} title="Back">
          <ArrowLeft size={15} />
        </button>
        <Folder size={13} style={{ color: 'var(--zen-secondary-text)' }} />
        <span style={{ fontSize: 13, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.name}</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
        {loading && <div style={emptyStyle}>Loading…</div>}
        {error && <div style={{ ...emptyStyle, color: 'var(--status-focused)' }}>{error}</div>}
        {!loading && !error && lists.length === 0 && (
          <div style={emptyStyle}>No to-do lists found</div>
        )}
        {lists.map((list) => (
          <button key={list.id} onClick={() => onSelectList(list)} style={rowBtnStyle}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--zen-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
            <ListTodo size={13} style={{ color: 'var(--zen-secondary-text)', flexShrink: 0 }} />
            <div style={{ flex: 1, overflow: 'hidden', textAlign: 'left' }}>
              <div style={{ fontSize: 12, fontWeight: 500 }}>{list.title}</div>
              {list.description && (
                <div style={{ fontSize: 10, color: 'var(--zen-tertiary-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{list.description}</div>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Todos Level ────────────────────────────────────────────────

interface TodosLevelProps {
  authState: BasecampAuthState;
  project: BasecampProject;
  list: BasecampTodoList;
  timerState: Props['timerState'];
  onBack: () => void;
}

function TodosLevel({ authState, project, list, timerState, onBack }: TodosLevelProps) {
  const [todos, setTodos] = useState<BasecampTodo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inlineEdit, setInlineEdit] = useState<InlineEdit | null>(null);
  const [noteState, setNoteState] = useState<NoteState>({});
  const [subtaskState, setSubtaskState] = useState<SubtaskState>({});
  const [addTaskInput, setAddTaskInput] = useState('');
  const [hoveredTodo, setHoveredTodo] = useState<number | null>(null);
  const [addingTask, setAddingTask] = useState(false);
  const [hoursByTodo, setHoursByTodo] = useState<Map<number, number>>(new Map());

  const fetchTodos = useCallback(() => {
    setLoading(true);
    window.zenstate.bcListTodos(project.id, list.id).then((res) => {
      if (res.ok && res.data) {
        setTodos(res.data);
      } else {
        setError(res.error ?? 'Failed to load todos');
      }
      setLoading(false);
    }).catch((e: Error) => { setError(e.message); setLoading(false); });
  }, [project.id, list.id]);

  const fetchTimesheet = useCallback(() => {
    window.zenstate.bcGetProjectTimesheet(project.id).then((res) => {
      if (res.ok && res.data) {
        const totals = new Map<number, number>();
        for (const entry of res.data) {
          const hrs = parseFloat(entry.hours) || 0;
          totals.set(entry.parentId, (totals.get(entry.parentId) ?? 0) + hrs);
        }
        setHoursByTodo(totals);
      }
    }).catch(() => {/* timesheet may be disabled — silently skip */});
  }, [project.id]);

  useEffect(() => { fetchTodos(); }, [fetchTodos]);
  useEffect(() => { fetchTimesheet(); }, [fetchTimesheet]);

  // Refresh timesheet totals when the main process reports a new entry was created.
  useEffect(() => {
    return window.zenstate.on('basecamp:timesheet-updated', (...args: unknown[]) => {
      const data = args[0] as { projectId?: number };
      if (!data || data.projectId === project.id) fetchTimesheet();
    });
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
    const res = await window.zenstate.bcPostComment({ projectId: project.id, todoId, content: text }).catch((e) => ({ ok: false as const, error: (e as Error).message }));
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
  const parentTodos = todos.filter((t) => !t.parentId);
  for (const parent of parentTodos) {
    orderedTodos.push({ todo: parent, isChild: false });
    const children = todos.filter((t) => t.parentId === parent.id);
    for (const child of children) {
      orderedTodos.push({ todo: child, isChild: true });
    }
  }
  // Add orphan children (parent not in visible list)
  for (const todo of todos) {
    if (todo.parentId && !parentIds.has(todo.parentId)) {
      orderedTodos.push({ todo, isChild: true });
    }
  }

  return (
    <div className="popover fade-in" style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '12px 16px 8px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--zen-divider)' }}>
        <button onClick={onBack} style={iconBtnStyle} title="Back">
          <ArrowLeft size={15} />
        </button>
        <ListTodo size={13} style={{ color: 'var(--zen-secondary-text)' }} />
        <span style={{ fontSize: 13, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{list.title}</span>
        <span style={{ fontSize: 10, color: 'var(--zen-tertiary-text)' }}>{project.name}</span>
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
            <div key={todo.id}
              style={{ marginLeft: isChild ? 16 : 0, marginBottom: 2 }}
              onMouseEnter={() => setHoveredTodo(todo.id)}
              onMouseLeave={() => { if (!isEditing) setHoveredTodo(null); }}>

              {/* Todo row */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '5px 6px',
                borderRadius: 6, background: isEditing ? 'var(--zen-secondary-bg)' : 'transparent',
                transition: 'background 0.12s',
              }}
                onMouseEnter={(e) => { if (!isEditing) e.currentTarget.style.background = 'var(--zen-tertiary-bg)'; }}
                onMouseLeave={(e) => { if (!isEditing) e.currentTarget.style.background = 'transparent'; }}>

                {/* Checkbox (read-only) */}
                <div style={{
                  width: 13, height: 13, borderRadius: 3, border: '1.5px solid var(--zen-divider)',
                  flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: todo.completed ? 'var(--zen-primary)' : 'transparent',
                }}>
                  {todo.completed && <span style={{ fontSize: 9, color: 'white', lineHeight: 1 }}>✓</span>}
                </div>

                {/* Content */}
                <span style={{
                  flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  color: todo.completed ? 'var(--zen-tertiary-text)' : 'var(--zen-text)',
                  textDecoration: todo.completed ? 'line-through' : 'none',
                }}>
                  {truncate(todo.content)}
                </span>

                {/* Tracked hours badge */}
                {hoursByTodo.has(todo.id) && (
                  <span title={`${hoursByTodo.get(todo.id)!.toFixed(2)} hours tracked on this to-do`}
                    style={{
                      flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 3,
                      padding: '1px 6px', borderRadius: 6, fontSize: 10, fontWeight: 500,
                      color: 'var(--status-available)',
                      background: 'rgba(52, 199, 89, 0.10)',
                      border: '1px solid rgba(52, 199, 89, 0.18)',
                    }}>
                    <Clock3 size={9} />
                    {formatHrs(hoursByTodo.get(todo.id)!)}
                  </span>
                )}

                {/* Hover actions */}
                {(hoveredTodo === todo.id || isEditing) && (
                  <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                    {/* Start/Stop timer */}
                    <button
                      onClick={() => running ? window.zenstate.stopTimer() : handleStartTimer(todo)}
                      style={{ ...actionBtnStyle, color: running ? 'var(--status-focused)' : 'var(--status-available)' }}
                      title={running ? 'Stop timer' : 'Start timer'}>
                      {running ? <Square size={11} /> : <Play size={11} />}
                    </button>

                    {/* Note */}
                    <button
                      onClick={() => {
                        setInlineEdit(isEditing && inlineEdit?.mode === 'note' ? null : { todoId: todo.id, mode: 'note' });
                      }}
                      style={{ ...actionBtnStyle, color: isEditing && inlineEdit?.mode === 'note' ? 'var(--zen-primary)' : 'var(--zen-secondary-text)' }}
                      title="Add note">
                      <MessageSquare size={11} />
                    </button>

                    {/* Subtask */}
                    {!isChild && (
                      <button
                        onClick={() => {
                          setInlineEdit(isEditing && inlineEdit?.mode === 'subtask' ? null : { todoId: todo.id, mode: 'subtask' });
                        }}
                        style={{ ...actionBtnStyle, color: isEditing && inlineEdit?.mode === 'subtask' ? 'var(--zen-primary)' : 'var(--zen-secondary-text)' }}
                        title="Add subtask">
                        <Plus size={11} />
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Inline note editor */}
              {isEditing && inlineEdit?.mode === 'note' && (
                <div style={{ margin: '4px 6px 6px 19px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <textarea
                    autoFocus
                    rows={2}
                    placeholder="Add a note…"
                    value={noteData?.text ?? ''}
                    onChange={(e) => setNoteState((prev) => ({ ...prev, [todo.id]: { text: e.target.value, success: false, loading: false } }))}
                    style={{
                      ...inputStyle, resize: 'none', fontSize: 11, lineHeight: 1.4,
                      fontFamily: 'inherit',
                    }}
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
                      style={submitBtnStyle}>
                      {noteData?.loading ? '…' : 'Submit'}
                    </button>
                  </div>
                </div>
              )}

              {/* Inline subtask editor */}
              {isEditing && inlineEdit?.mode === 'subtask' && (
                <div style={{ margin: '4px 6px 6px 19px', display: 'flex', gap: 4 }}>
                  <input
                    autoFocus
                    placeholder="Subtask name…"
                    value={subtaskState[todo.id] ?? ''}
                    onChange={(e) => setSubtaskState((prev) => ({ ...prev, [todo.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddSubtask(todo);
                      if (e.key === 'Escape') setInlineEdit(null);
                    }}
                    style={{ ...inputStyle, flex: 1, fontSize: 11 }}
                  />
                  <button onClick={() => handleAddSubtask(todo)} style={submitBtnStyle}>Add</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add Task footer */}
      <div style={{ padding: '6px 12px 10px', borderTop: '1px solid var(--zen-divider)' }}>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <Plus size={12} style={{ color: 'var(--zen-tertiary-text)', flexShrink: 0 }} />
          <input
            placeholder="Add task…"
            value={addTaskInput}
            onChange={(e) => setAddTaskInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddTask();
            }}
            style={{ ...inputStyle, flex: 1, fontSize: 11, background: 'transparent', border: 'none', padding: '2px 0', outline: 'none' }}
          />
          {addTaskInput.trim() && (
            <button onClick={handleAddTask} disabled={addingTask} style={submitBtnStyle}>
              {addingTask ? '…' : 'Add'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Root ProjectsView ──────────────────────────────────────────

export default function ProjectsView({ onBack, onOpenSettings, timerState }: Props) {
  const [step, setStep] = useState<Step>('projects');
  const [authState, setAuthState] = useState<BasecampAuthState>({ isConnected: false });
  const [authLoading, setAuthLoading] = useState(true);
  const [selectedProject, setSelectedProject] = useState<BasecampProject | undefined>();
  const [selectedList, setSelectedList] = useState<BasecampTodoList | undefined>();

  useEffect(() => {
    window.zenstate.bcGetAuthState().then((state) => {
      setAuthState(state);
      setAuthLoading(false);
    }).catch(() => setAuthLoading(false));

    return window.zenstate.on('basecamp:auth-changed', (...args: unknown[]) => {
      setAuthState(args[0] as BasecampAuthState);
    });
  }, []);

  if (authLoading) {
    return (
      <div className="popover" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: 'var(--zen-secondary-text)', fontSize: 12 }}>Loading…</span>
      </div>
    );
  }

  if (!authState.isConnected) {
    return (
      <div className="popover fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }}>
        <Briefcase size={28} style={{ color: 'var(--zen-tertiary-text)' }} />
        <span style={{ fontSize: 13, fontWeight: 600, textAlign: 'center' }}>Connect Basecamp</span>
        <span style={{ fontSize: 11, color: 'var(--zen-secondary-text)', textAlign: 'center', lineHeight: 1.5 }}>
          Connect Basecamp in Settings to see your projects. Your sessions stay private until you choose to share them.
        </span>
        <button className="btn btn-primary" style={{ fontSize: 11, marginTop: 4 }} onClick={onOpenSettings}>
          Open Settings
        </button>
      </div>
    );
  }

  if (step === 'todos' && selectedProject && selectedList) {
    return (
      <TodosLevel
        authState={authState}
        project={selectedProject}
        list={selectedList}
        timerState={timerState}
        onBack={() => setStep('lists')}
      />
    );
  }

  if (step === 'lists' && selectedProject) {
    return (
      <TodoListLevel
        project={selectedProject}
        onSelectList={(list) => { setSelectedList(list); setStep('todos'); }}
        onBack={() => { setSelectedProject(undefined); setStep('projects'); }}
      />
    );
  }

  return (
    <ProjectList
      authState={authState}
      onSelectProject={(p) => { setSelectedProject(p); setStep('lists'); }}
      onBack={onBack}
    />
  );
}

// ── Shared styles ──────────────────────────────────────────────

const iconBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--zen-secondary-text)',
  padding: 4,
  borderRadius: 6,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

const rowBtnStyle: React.CSSProperties = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '7px 8px',
  border: 'none',
  background: 'transparent',
  color: 'var(--zen-text)',
  cursor: 'pointer',
  borderRadius: 6,
  fontFamily: 'inherit',
  transition: 'background 0.12s',
};

const actionBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: '2px 3px',
  borderRadius: 4,
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
  padding: '4px 8px',
  fontSize: 12,
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
  fontSize: 10,
  padding: '3px 8px',
  fontFamily: 'inherit',
  fontWeight: 600,
};

const cancelBtnStyle: React.CSSProperties = {
  background: 'var(--zen-secondary-bg)',
  border: '1px solid var(--zen-divider)',
  borderRadius: 5,
  color: 'var(--zen-secondary-text)',
  cursor: 'pointer',
  fontSize: 10,
  padding: '3px 8px',
  fontFamily: 'inherit',
};

const emptyStyle: React.CSSProperties = {
  textAlign: 'center',
  padding: '24px 16px',
  color: 'var(--zen-tertiary-text)',
  fontSize: 12,
};
