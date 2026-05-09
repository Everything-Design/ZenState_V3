import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Plus, Play, Square, X, Clock, Briefcase, Check, ArrowLeft, Search, MessageSquare } from 'lucide-react';
import {
  IPC, TodayPlan, PinnedTodo, RecentTodo,
  BasecampAuthState, BasecampProject, BasecampTodoList, BasecampTodo, DailyRecord,
} from '../../../shared/types';

interface TimerState {
  elapsed: number;
  isRunning: boolean;
  isPaused: boolean;
  taskLabel: string;
}

interface Props {
  timerState: TimerState;
  records: DailyRecord[];
  onOpenSettings: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────

function formatHM(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function todayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayHeader(): string {
  return new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

// ── Main view ─────────────────────────────────────────────────────

export default function TodayTab({ timerState, records, onOpenSettings }: Props) {
  const [plan, setPlan] = useState<TodayPlan>({ date: todayDateStr(), items: [] });
  const [recents, setRecents] = useState<RecentTodo[]>([]);
  const [authState, setAuthState] = useState<BasecampAuthState | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editingEstimate, setEditingEstimate] = useState<number | null>(null);

  // Initial load + reactive updates from the main process. Subscribe FIRST,
  // then fetch — otherwise an event arriving between the request and its
  // async response can be clobbered by the (stale-by-then) response.
  useEffect(() => {
    let eventArrived = false;
    const off = window.zenstate.on(IPC.TODAY_CHANGED, (...args: unknown[]) => {
      eventArrived = true;
      setPlan(args[0] as TodayPlan);
    });
    window.zenstate.todayGet().then((res) => {
      if (!eventArrived) setPlan(res.plan);
      setRecents(res.recents);
    }).catch(() => {});
    window.zenstate.bcGetAuthState().then(setAuthState).catch(() => {});
    return off;
  }, []);

  const handlePin = useCallback(async (item: PinnedTodo) => {
    const next = await window.zenstate.todayPin(item).catch(() => null);
    if (next) setPlan(next);
    setPickerOpen(false);
  }, []);

  const handleUnpin = useCallback(async (todoId: number) => {
    const next = await window.zenstate.todayUnpin(todoId).catch(() => null);
    if (next) setPlan(next);
  }, []);

  const handleSetEstimate = useCallback(async (todoId: number, minutes: number | null) => {
    const next = await window.zenstate.todaySetEstimate(todoId, minutes).catch(() => null);
    if (next) setPlan(next);
    setEditingEstimate(null);
  }, []);

  const handleStartTimer = useCallback((item: PinnedTodo) => {
    window.zenstate.startTimer(item.content, undefined, undefined, {
      accountId: item.accountId,
      projectId: item.projectId,
      todoId: item.todoId,
      todoListId: item.todoListId,
      projectName: item.projectName,
    });
  }, []);

  const handleToggleComplete = useCallback(async (todoId: number) => {
    // If the task being marked complete is the one currently being timed,
    // stop the timer too — otherwise the timer keeps running on a task the
    // user just declared "done", which is contradictory and noisy in the
    // session log. Stop kicks the standard confirm-then-post flow.
    const item = plan.items.find((p) => p.todoId === todoId);
    const wasIncomplete = item && !item.completedAt;
    const isThisRunning = item && timerState.isRunning && timerState.taskLabel === item.content;
    if (wasIncomplete && isThisRunning) {
      window.zenstate.stopTimer();
    }
    const next = await window.zenstate.todayToggleComplete(todoId).catch(() => null);
    if (next) setPlan(next);
  }, [plan.items, timerState.isRunning, timerState.taskLabel]);

  const isRunning = (item: PinnedTodo) => timerState.isRunning && timerState.taskLabel === item.content;

  // Today's sessions — for the "What you've done" section.
  const todaySessions = useMemo(() => {
    const today = todayDateStr();
    const rec = records.find((r) => r.date.startsWith(today));
    return rec ? [...rec.sessions].sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()) : [];
  }, [records]);

  const totalTrackedToday = useMemo(() => todaySessions.reduce((sum, s) => sum + s.duration, 0), [todaySessions]);

  // Compute time-tracked-today per pinned todo so each row can show progress vs. estimate.
  const trackedByTodoId = useMemo(() => {
    const map = new Map<number, number>();
    for (const s of todaySessions) {
      if (s.basecamp?.todoId) {
        map.set(s.basecamp.todoId, (map.get(s.basecamp.todoId) ?? 0) + s.duration);
      }
    }
    return map;
  }, [todaySessions]);

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', maxWidth: 720, margin: '0 auto', paddingTop: 'var(--space-3)' }}>
      {/* Header */}
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, letterSpacing: '-0.02em', margin: 0, color: 'var(--zen-text)' }}>
          {dayHeader()}
        </h1>
        <p style={{ fontSize: 'var(--text-md)', color: 'var(--zen-secondary-text)', margin: '6px 0 0', fontWeight: 400 }}>
          {plan.items.length === 0
            ? 'Pick a few things to focus on today.'
            : `Focusing on ${plan.items.length} ${plan.items.length === 1 ? 'thing' : 'things'} today.`}
        </p>
      </div>

      {/* Today's plan */}
      <section>
        <SectionTitle>Today's Plan</SectionTitle>

        {!authState?.isConnected ? (
          <EmptyState
            icon={<Briefcase size={20} />}
            title="Connect Basecamp"
            body="Today's plan pulls from your Basecamp to-dos. Connect once and you can pin a few each morning."
            action={<button className="btn btn-primary" onClick={onOpenSettings}>Open Settings</button>}
          />
        ) : plan.items.length === 0 ? (
          <EmptyState
            icon={<Plus size={20} />}
            title="What are you working on today?"
            body="Pin a few Basecamp to-dos to keep them at the top of your day. Click below to start."
            action={<button className="btn btn-primary" onClick={() => setPickerOpen(true)}>Pin a to-do</button>}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {plan.items.map((item) => (
              <PinnedRow
                key={item.todoId}
                item={item}
                running={isRunning(item)}
                trackedToday={trackedByTodoId.get(item.todoId) ?? 0}
                editingEstimate={editingEstimate === item.todoId}
                onStartEditEstimate={() => setEditingEstimate(item.todoId)}
                onSaveEstimate={(min) => handleSetEstimate(item.todoId, min)}
                onCancelEditEstimate={() => setEditingEstimate(null)}
                onStartTimer={() => handleStartTimer(item)}
                onStopTimer={() => window.zenstate.stopTimer()}
                onUnpin={() => handleUnpin(item.todoId)}
                onToggleComplete={() => handleToggleComplete(item.todoId)}
              />
            ))}
            <button
              onClick={() => setPickerOpen(true)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: 'var(--space-2)',
                padding: '10px var(--space-3)',
                borderRadius: 'var(--radius-md)',
                background: 'transparent',
                border: '1px dashed var(--zen-divider)',
                color: 'var(--zen-secondary-text)',
                fontSize: 'var(--text-sm)',
                fontWeight: 500,
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'background var(--duration-quick) var(--ease-standard), color var(--duration-quick) var(--ease-standard), border-color var(--duration-quick) var(--ease-standard)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--zen-hover)'; e.currentTarget.style.color = 'var(--zen-text)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.18)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--zen-secondary-text)'; e.currentTarget.style.borderColor = 'var(--zen-divider)'; }}
            >
              <Plus size={14} /> Pin another to-do
            </button>
          </div>
        )}
      </section>

      {/* Done today */}
      {todaySessions.length > 0 && (
        <section>
          <SectionTitle right={<span style={{ fontSize: 'var(--text-sm)', color: 'var(--zen-secondary-text)', fontWeight: 400 }}>{formatHM(totalTrackedToday)} tracked</span>}>
            What you did today
          </SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {todaySessions.map((s) => (
              <div key={s.id} style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                padding: '10px var(--space-3)', borderRadius: 'var(--radius-md)',
                background: 'var(--zen-tertiary-bg)',
              }}>
                <div style={{ width: 14, height: 14, borderRadius: '50%', background: 'var(--status-available)', opacity: 0.8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Check size={9} color="white" />
                </div>
                <span style={{ flex: 1, fontSize: 'var(--text-base)', color: 'var(--zen-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.taskLabel}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--zen-secondary-text)', fontVariantNumeric: 'tabular-nums' }}>
                  {formatHM(s.duration)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Picker modal */}
      {pickerOpen && authState?.isConnected && (
        <PinPicker
          authState={authState}
          recents={recents}
          alreadyPinned={new Set(plan.items.map((i) => i.todoId))}
          onPin={handlePin}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────

function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
      <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, margin: 0, letterSpacing: '-0.01em', color: 'var(--zen-text)' }}>{children}</h2>
      {right}
    </div>
  );
}

function EmptyState({ icon, title, body, action }: { icon: React.ReactNode; title: string; body: string; action: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: 'var(--space-3)',
      padding: 'var(--space-5) var(--space-4)',
      borderRadius: 'var(--radius-lg)',
      background: 'var(--zen-secondary-bg)',
      border: '1px solid var(--zen-divider)',
      textAlign: 'center',
    }}>
      <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--zen-tertiary-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--zen-secondary-text)' }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 'var(--text-md)', fontWeight: 600, color: 'var(--zen-text)', marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--zen-secondary-text)', maxWidth: 360, lineHeight: 'var(--leading-relaxed)' }}>{body}</div>
      </div>
      {action}
    </div>
  );
}

interface PinnedRowProps {
  item: PinnedTodo;
  running: boolean;
  trackedToday: number;
  editingEstimate: boolean;
  onStartEditEstimate: () => void;
  onSaveEstimate: (minutes: number | null) => void;
  onCancelEditEstimate: () => void;
  onStartTimer: () => void;
  onStopTimer: () => void;
  onUnpin: () => void;
  onToggleComplete: () => void;
}

function PinnedRow({
  item, running, trackedToday, editingEstimate,
  onStartEditEstimate, onSaveEstimate, onCancelEditEstimate,
  onStartTimer, onStopTimer, onUnpin, onToggleComplete,
}: PinnedRowProps) {
  const [estimateInput, setEstimateInput] = useState(String(item.estimateMinutes ?? ''));
  const [hovered, setHovered] = useState(false);
  const isComplete = !!item.completedAt;

  const estimateSec = (item.estimateMinutes ?? 0) * 60;
  const progress = estimateSec > 0 ? Math.min(1, trackedToday / estimateSec) : 0;
  const overEstimate = estimateSec > 0 && trackedToday > estimateSec;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', flexDirection: 'column',
        padding: '12px var(--space-4)',
        borderRadius: 'var(--radius-lg)',
        background: running ? 'rgba(48, 209, 88, 0.08)' : 'var(--zen-secondary-bg)',
        border: `1px solid ${running ? 'rgba(48, 209, 88, 0.25)' : 'var(--zen-divider)'}`,
        opacity: isComplete ? 0.55 : 1,
        transition: 'background var(--duration-quick) var(--ease-standard), border-color var(--duration-quick) var(--ease-standard), opacity var(--duration-quick) var(--ease-standard)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        {/* Completion checkbox — clicking toggles done/undone. Local-only flag,
            not pushed to Basecamp; drives midnight rollover (completed items
            don't carry into the next day). */}
        <button
          onClick={onToggleComplete}
          title={isComplete ? 'Mark as not done' : 'Mark complete'}
          style={{
            width: 18, height: 18, borderRadius: 5,
            border: isComplete ? 'none' : '1.5px solid var(--zen-tertiary-text)',
            background: isComplete ? 'var(--status-available)' : 'transparent',
            flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', padding: 0,
            transition: 'background var(--duration-quick) var(--ease-standard), border-color var(--duration-quick) var(--ease-standard)',
          }}
          onMouseEnter={(e) => { if (!isComplete) e.currentTarget.style.borderColor = 'var(--zen-text)'; }}
          onMouseLeave={(e) => { if (!isComplete) e.currentTarget.style.borderColor = 'var(--zen-tertiary-text)'; }}
        >
          {isComplete && <Check size={11} color="white" strokeWidth={3} />}
        </button>

        {/* Title + project */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 'var(--text-md)', fontWeight: 500,
            color: 'var(--zen-text)',
            textDecoration: isComplete ? 'line-through' : 'none',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {item.content}
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--zen-tertiary-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
            {item.projectName || `Project #${item.projectId}`}
          </div>
        </div>

        {/* Estimate / tracked */}
        {editingEstimate ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              type="number"
              min="0"
              max="600"
              value={estimateInput}
              autoFocus
              onChange={(e) => setEstimateInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const n = parseInt(estimateInput);
                  onSaveEstimate(Number.isFinite(n) && n > 0 ? n : null);
                } else if (e.key === 'Escape') {
                  onCancelEditEstimate();
                }
              }}
              onBlur={() => {
                const n = parseInt(estimateInput);
                onSaveEstimate(Number.isFinite(n) && n > 0 ? n : null);
              }}
              className="text-input"
              style={{ width: 64, padding: '4px 8px', fontSize: 'var(--text-sm)', textAlign: 'right' }}
            />
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--zen-tertiary-text)' }}>min</span>
          </div>
        ) : (
          <button
            onClick={onStartEditEstimate}
            title={item.estimateMinutes ? 'Click to edit estimate' : 'Click to set estimate'}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 'var(--text-xs)', fontVariantNumeric: 'tabular-nums',
              fontFamily: 'var(--font-mono)',
              color: overEstimate ? 'var(--status-occupied)' : 'var(--zen-secondary-text)',
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: '4px 8px', borderRadius: 6,
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--zen-hover)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <Clock size={11} />
            {item.estimateMinutes
              ? `${formatHM(trackedToday)} / ${item.estimateMinutes}m`
              : trackedToday > 0
                ? formatHM(trackedToday)
                : 'Set estimate'}
          </button>
        )}

        {/* Start/Stop button — Start is disabled on completed tasks; user
            must un-check first if they want to keep working on something
            they marked done. */}
        {running ? (
          <button onClick={onStopTimer} className="btn btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 12px' }}>
            <Square size={11} /> Stop
          </button>
        ) : (
          <button
            onClick={onStartTimer}
            className="btn btn-primary"
            disabled={isComplete}
            title={isComplete ? 'Un-check this task to restart the timer' : undefined}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 12px',
              opacity: isComplete ? 0.4 : 1,
              cursor: isComplete ? 'not-allowed' : 'pointer',
            }}
          >
            <Play size={11} /> Start
          </button>
        )}

        {/* Unpin (visible on hover) */}
        <button
          onClick={onUnpin}
          title="Unpin from today"
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--zen-tertiary-text)',
            padding: 4, borderRadius: 4,
            opacity: hovered ? 0.85 : 0,
            transition: 'opacity var(--duration-quick) var(--ease-standard)',
          }}
          onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
          onMouseLeave={(e) => e.currentTarget.style.opacity = hovered ? '0.85' : '0'}
        >
          <X size={14} />
        </button>
      </div>

      {/* Progress bar (only when there's an estimate) */}
      {estimateSec > 0 && (
        <div style={{
          height: 3, marginTop: 10, borderRadius: 2,
          background: 'rgba(255, 255, 255, 0.06)', overflow: 'hidden',
        }}>
          <div style={{
            height: '100%',
            width: `${progress * 100}%`,
            background: overEstimate ? 'var(--status-occupied)' : 'var(--zen-primary)',
            borderRadius: 2,
            transition: 'width var(--duration-slow) var(--ease-out)',
          }} />
        </div>
      )}
    </div>
  );
}

// ── Picker (modal, three-stage cascade with Recents row at top) ─────

export interface PinPickerProps {
  authState: BasecampAuthState;
  recents: RecentTodo[];
  alreadyPinned: Set<number>;
  onPin: (item: PinnedTodo) => void;
  onClose: () => void;
  // Title shown in the picker header — defaults to "Pin a to-do" but Tomorrow
  // can override with "Pin to tomorrow" so the surface labels itself correctly.
  title?: string;
}

export function PinPicker({ authState, recents, alreadyPinned, onPin, onClose, title }: PinPickerProps) {
  const [step, setStep] = useState<'recents' | 'projects' | 'lists' | 'todos'>('recents');
  const [projects, setProjects] = useState<BasecampProject[]>([]);
  const [lists, setLists] = useState<BasecampTodoList[]>([]);
  const [todos, setTodos] = useState<BasecampTodo[]>([]);
  const [project, setProject] = useState<BasecampProject | null>(null);
  const [list, setList] = useState<BasecampTodoList | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  // Inline note editor — keyed by todoId so only one note panel is open at a time.
  // Mirrors the popover Projects view's note flow (write → bcPostComment → ✓).
  const [noteOpenFor, setNoteOpenFor] = useState<number | null>(null);
  const [noteText, setNoteText] = useState('');
  const [notePosting, setNotePosting] = useState(false);
  const [noteJustSentFor, setNoteJustSentFor] = useState<number | null>(null);

  // Reset search + close any open note editor when navigating between steps.
  // Each step has its own scope of "what you're searching for."
  useEffect(() => { setSearch(''); setNoteOpenFor(null); setNoteText(''); }, [step]);

  const fetchProjects = useCallback(() => {
    setLoading(true); setError(null);
    window.zenstate.bcListProjects().then((res) => {
      if (res.ok && res.data) setProjects(res.data);
      else setError(res.error ?? 'Failed to load projects');
      setLoading(false);
    });
  }, []);

  const goToProjects = () => { setStep('projects'); if (projects.length === 0) fetchProjects(); };
  const goToLists = (p: BasecampProject) => {
    setProject(p); setStep('lists'); setLists([]); setLoading(true); setError(null);
    if (!p.todoSetId) { setError('Project has no to-do set'); setLoading(false); return; }
    window.zenstate.bcListTodoLists(p.id, p.todoSetId).then((res) => {
      if (res.ok && res.data) setLists(res.data);
      else setError(res.error ?? 'Failed to load lists');
      setLoading(false);
    });
  };
  const goToTodos = (l: BasecampTodoList) => {
    if (!project) return;
    setList(l); setStep('todos'); setTodos([]); setLoading(true); setError(null);
    window.zenstate.bcListTodos(project.id, l.id).then((res) => {
      if (res.ok && res.data) setTodos(res.data);
      else setError(res.error ?? 'Failed to load to-dos');
      setLoading(false);
    });
  };

  const pickRecent = (r: RecentTodo) => {
    onPin({
      todoId: r.todoId, projectId: r.projectId, todoListId: r.todoListId, accountId: r.accountId,
      content: r.content, projectName: r.projectName,
    });
  };

  const pickTodo = (t: BasecampTodo) => {
    if (!project || !list || !authState.account) return;
    onPin({
      todoId: t.id, projectId: project.id, todoListId: list.id, accountId: authState.account.id,
      content: t.content, projectName: project.name,
    });
  };

  // Filter recents by search
  const filteredRecents = useMemo(() =>
    recents.filter((r) => !alreadyPinned.has(r.todoId))
           .filter((r) => !search || r.content.toLowerCase().includes(search.toLowerCase()) || r.projectName.toLowerCase().includes(search.toLowerCase())),
  [recents, alreadyPinned, search]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ width: 480 }}>
        {/* Header with breadcrumb */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
          {step !== 'recents' && (
            <button
              onClick={() => {
                if (step === 'todos') setStep('lists');
                else if (step === 'lists') setStep('projects');
                else if (step === 'projects') setStep('recents');
              }}
              style={{ background: 'transparent', border: 'none', color: 'var(--zen-secondary-text)', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center', borderRadius: 4 }}
              onMouseEnter={(e) => e.currentTarget.style.color = 'var(--zen-text)'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'var(--zen-secondary-text)'}
            >
              <ArrowLeft size={16} />
            </button>
          )}
          <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, margin: 0, flex: 1, letterSpacing: '-0.01em' }}>
            {step === 'recents' && (title ?? 'Pin a to-do')}
            {step === 'projects' && 'Pick a project'}
            {step === 'lists' && project?.name}
            {step === 'todos' && list?.title}
          </h3>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--zen-tertiary-text)', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center', borderRadius: 4 }}>
            <X size={16} />
          </button>
        </div>

        {/* Search — present on every step. Scope is whatever's visible:
            recents step searches recents, projects step searches projects, etc. */}
        <div style={{ position: 'relative', marginBottom: 'var(--space-3)' }}>
          <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--zen-tertiary-text)' }} />
          <input
            className="text-input"
            placeholder={
              step === 'recents' ? 'Search recently used to-dos…'
                : step === 'projects' ? 'Search projects…'
                : step === 'lists' ? 'Search to-do lists…'
                : 'Search to-dos…'
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: 30 }}
          />
        </div>

        {/* Body */}
        <div style={{ maxHeight: 380, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {error && <div style={{ color: 'var(--status-focused)', fontSize: 'var(--text-sm)', padding: 'var(--space-2)' }}>{error}</div>}

          {step === 'recents' && (
            <>
              {filteredRecents.length === 0 ? (
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--zen-tertiary-text)', padding: 'var(--space-3)', textAlign: 'center' }}>
                  {search ? 'No matching recent to-dos.' : 'Recently-used to-dos appear here.'}
                </div>
              ) : (
                filteredRecents.map((r) => (
                  <PickerRow key={r.todoId} title={r.content} subtitle={r.projectName} onClick={() => pickRecent(r)} />
                ))
              )}
              <button
                onClick={goToProjects}
                style={{
                  marginTop: 'var(--space-3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  gap: 'var(--space-2)',
                  padding: '10px var(--space-3)',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--zen-tertiary-bg)',
                  border: '1px solid var(--zen-divider)',
                  color: 'var(--zen-text)',
                  fontSize: 'var(--text-sm)', fontWeight: 500,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                <Briefcase size={14} /> Browse all projects
              </button>
            </>
          )}

          {step === 'projects' && (loading
            ? <div style={{ fontSize: 'var(--text-sm)', color: 'var(--zen-tertiary-text)', padding: 'var(--space-3)' }}>Loading projects…</div>
            : (() => {
                const filtered = search
                  ? projects.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()) || (p.description ?? '').toLowerCase().includes(search.toLowerCase()))
                  : projects;
                if (filtered.length === 0) {
                  return <div style={{ fontSize: 'var(--text-sm)', color: 'var(--zen-tertiary-text)', padding: 'var(--space-3)', textAlign: 'center' }}>No projects match.</div>;
                }
                return filtered.map((p) => <PickerRow key={p.id} title={p.name} subtitle={p.description ?? undefined} onClick={() => goToLists(p)} />);
              })()
          )}

          {step === 'lists' && (loading
            ? <div style={{ fontSize: 'var(--text-sm)', color: 'var(--zen-tertiary-text)', padding: 'var(--space-3)' }}>Loading to-do lists…</div>
            : (() => {
                const filtered = search
                  ? lists.filter((l) => l.title.toLowerCase().includes(search.toLowerCase()) || (l.description ?? '').toLowerCase().includes(search.toLowerCase()))
                  : lists;
                if (filtered.length === 0) {
                  return <div style={{ fontSize: 'var(--text-sm)', color: 'var(--zen-tertiary-text)', padding: 'var(--space-3)', textAlign: 'center' }}>No lists match.</div>;
                }
                return filtered.map((l) => <PickerRow key={l.id} title={l.title} subtitle={l.description ?? undefined} onClick={() => goToTodos(l)} />);
              })()
          )}

          {step === 'todos' && (loading
            ? <div style={{ fontSize: 'var(--text-sm)', color: 'var(--zen-tertiary-text)', padding: 'var(--space-3)' }}>Loading to-dos…</div>
            : (() => {
                const filtered = (search
                  ? todos.filter((t) => t.content.toLowerCase().includes(search.toLowerCase()))
                  : todos
                ).filter((t) => !alreadyPinned.has(t.id));
                if (filtered.length === 0) {
                  return <div style={{ fontSize: 'var(--text-sm)', color: 'var(--zen-tertiary-text)', padding: 'var(--space-3)', textAlign: 'center' }}>
                    {search ? 'No to-dos match.' : 'No to-dos in this list.'}
                  </div>;
                }
                return filtered.map((t) => (
                  <PickerTodoRow
                    key={t.id}
                    todo={t}
                    onPin={() => pickTodo(t)}
                    isNoteOpen={noteOpenFor === t.id}
                    onToggleNote={() => {
                      if (noteOpenFor === t.id) { setNoteOpenFor(null); setNoteText(''); }
                      else { setNoteOpenFor(t.id); setNoteText(''); }
                    }}
                    noteText={noteText}
                    onNoteTextChange={setNoteText}
                    notePosting={notePosting && noteOpenFor === t.id}
                    noteJustSent={noteJustSentFor === t.id}
                    onNoteSubmit={async () => {
                      if (!project || !noteText.trim() || notePosting) return;
                      setNotePosting(true);
                      const res = await window.zenstate.bcPostComment({
                        projectId: project.id, todoId: t.id, content: noteText.trim(),
                      }).catch((e) => ({ ok: false as const, error: (e as Error).message }));
                      setNotePosting(false);
                      if (res.ok) {
                        setNoteJustSentFor(t.id);
                        setNoteText('');
                        setTimeout(() => {
                          setNoteOpenFor(null);
                          setNoteJustSentFor(null);
                        }, 1100);
                      }
                    }}
                  />
                ));
              })()
          )}
        </div>
      </div>
    </div>
  );
}

// Todo row with two actions: Pin (primary) and Note (secondary, expands inline).
// Mirrors the popover Projects view's per-todo affordances so users can
// optionally jot a note before pinning without leaving the picker.
interface PickerTodoRowProps {
  todo: BasecampTodo;
  onPin: () => void;
  isNoteOpen: boolean;
  onToggleNote: () => void;
  noteText: string;
  onNoteTextChange: (s: string) => void;
  onNoteSubmit: () => void;
  notePosting: boolean;
  noteJustSent: boolean;
}

function PickerTodoRow({ todo, onPin, isNoteOpen, onToggleNote, noteText, onNoteTextChange, onNoteSubmit, notePosting, noteJustSent }: PickerTodoRowProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        borderRadius: 'var(--radius-sm)',
        background: isNoteOpen ? 'var(--zen-secondary-bg)' : 'transparent',
        border: `1px solid ${isNoteOpen ? 'var(--zen-divider)' : 'transparent'}`,
        transition: 'background var(--duration-quick) var(--ease-standard), border-color var(--duration-quick) var(--ease-standard)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px var(--space-3)' }}>
        {/* Read-only checkbox so completed todos look completed */}
        <div style={{
          width: 13, height: 13, borderRadius: 3, border: '1.5px solid var(--zen-divider)',
          flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: todo.completed ? 'var(--zen-primary)' : 'transparent',
        }}>
          {todo.completed && <span style={{ fontSize: 9, color: 'white', lineHeight: 1 }}>✓</span>}
        </div>

        {/* Title (click-through to pin) */}
        <button
          onClick={onPin}
          style={{
            flex: 1, minWidth: 0, textAlign: 'left',
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: todo.completed ? 'var(--zen-tertiary-text)' : 'var(--zen-text)',
            textDecoration: todo.completed ? 'line-through' : 'none',
            fontFamily: 'inherit',
            fontSize: 'var(--text-base)',
            padding: 0,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
          title={todo.completed ? 'Pin completed to-do' : 'Pin to today'}
        >
          {todo.content}
        </button>

        {/* Hover actions: Pin + Note */}
        {(hovered || isNoteOpen) && (
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            <button
              onClick={onToggleNote}
              title={isNoteOpen ? 'Close note' : 'Add a note to this to-do'}
              style={{
                background: isNoteOpen ? 'rgba(10, 132, 255, 0.16)' : 'transparent',
                border: 'none', cursor: 'pointer', padding: 5, borderRadius: 4,
                color: isNoteOpen ? 'var(--zen-primary)' : 'var(--zen-secondary-text)',
                display: 'flex', alignItems: 'center',
              }}
            >
              <MessageSquare size={12} />
            </button>
            <button
              onClick={onPin}
              title="Pin to today"
              className="btn btn-primary"
              style={{ padding: '4px 10px', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              <Plus size={11} /> Pin
            </button>
          </div>
        )}
      </div>

      {/* Inline note editor */}
      {isNoteOpen && (
        <div style={{ padding: '0 var(--space-3) 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <textarea
            autoFocus
            rows={2}
            placeholder="Add a comment to this Basecamp to-do…"
            value={noteText}
            onChange={(e) => onNoteTextChange(e.target.value)}
            className="text-input"
            style={{ resize: 'none', fontSize: 'var(--text-sm)', fontFamily: 'inherit', lineHeight: 1.4 }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onNoteSubmit();
            }}
          />
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
            {noteJustSent && (
              <span style={{ fontSize: 11, color: 'var(--status-available)' }}>✓ Posted</span>
            )}
            <button
              onClick={onNoteSubmit}
              disabled={!noteText.trim() || notePosting}
              className="btn btn-secondary"
              style={{ padding: '4px 10px', fontSize: 11 }}
            >
              {notePosting ? 'Posting…' : 'Post note'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PickerRow({ title, subtitle, onClick }: { title: string; subtitle?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'block', width: '100%', textAlign: 'left',
        padding: '10px var(--space-3)', borderRadius: 'var(--radius-sm)',
        background: 'transparent', border: 'none', cursor: 'pointer',
        color: 'var(--zen-text)', fontFamily: 'inherit',
        transition: 'background var(--duration-quick) var(--ease-standard)',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--zen-hover)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <div style={{ fontSize: 'var(--text-base)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
      {subtitle && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--zen-tertiary-text)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subtitle}</div>}
    </button>
  );
}
