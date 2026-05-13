import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Plus, Play, Pause, Square, X, Clock, Briefcase, Check, ArrowLeft, Search, Timer, ChevronDown } from 'lucide-react';
import {
  IPC, TodayPlan, PinnedTodo, RecentTodo,
  BasecampAuthState, BasecampProject, BasecampTodoList, BasecampTodo, DailyRecord,
  MyAssignment, MyAssignmentsResponse, MyAssignmentsDueScope, TodoSearchResult,
} from '../../../shared/types';

// Bridge type — avoids `(window as any)` at every call site.
const zs = window.zenstate as unknown as {
  bcGetMyAssignments: () => Promise<{ ok: true; data: MyAssignmentsResponse } | { ok: false; error: string }>;
  bcGetMyAssignmentsDue: (scope: string) => Promise<{ ok: true; data: MyAssignment[] } | { ok: false; error: string }>;
  bcSearchTodos: (query: string) => Promise<{ ok: true; data: TodoSearchResult[] } | { ok: false; error: string }>;
  bcListProjects: () => Promise<{ ok: true; data: BasecampProject[] } | { ok: false; error: string }>;
  bcListTodoLists: (projectId: number, todoSetId: number) => Promise<{ ok: true; data: BasecampTodoList[] } | { ok: false; error: string }>;
  bcListTodos: (projectId: number, todoListId: number) => Promise<{ ok: true; data: BasecampTodo[] } | { ok: false; error: string }>;
  bcCreateTodo: (data: { projectId: number; todoListId: number; content: string }) => Promise<{ ok: true; data: BasecampTodo } | { ok: false; error: string }>;
  bcPostComment: (data: { projectId: number; todoId: number; content: string }) => Promise<{ ok: true } | { ok: false; error: string }>;
  todayPinMany: (items: PinnedTodo[]) => Promise<{ plan: TodayPlan; added: number }>;
  tomorrowPinMany: (items: PinnedTodo[]) => Promise<{ plan: unknown; added: number }>;
};
import AddSessionModal from '../../components/AddSessionModal';

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
  onRefreshRecords: () => void;
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

export default function TodayTab({ timerState, records, onOpenSettings, onRefreshRecords }: Props) {
  const [plan, setPlan] = useState<TodayPlan>({ date: todayDateStr(), items: [] });
  const [recents, setRecents] = useState<RecentTodo[]>([]);
  const [authState, setAuthState] = useState<BasecampAuthState | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editingEstimate, setEditingEstimate] = useState<number | null>(null);
  // "Log time" — manual session entry pre-filled with the clicked todo.
  // Lets the user record time they spent on a pinned task without having
  // started the live timer.
  const [logTimeFor, setLogTimeFor] = useState<PinnedTodo | null>(null);

  // Initial load + reactive updates from the main process. Subscribe FIRST,
  // then fetch — otherwise an event arriving between the request and its
  // async response can be clobbered by the (stale-by-then) response.
  useEffect(() => {
    let eventArrived = false;
    const offChanged = window.zenstate.on(IPC.TODAY_CHANGED, (...args: unknown[]) => {
      eventArrived = true;
      setPlan(args[0] as TodayPlan);
    });
    // Main process triggers this when the user clicks "Pin another to-do"
    // from the mini-timer pill — open the picker directly so they don't
    // need to find the button themselves.
    const offPicker = window.zenstate.on('plan:open-picker', () => {
      setPickerOpen(true);
    });
    window.zenstate.todayGet().then((res) => {
      if (!eventArrived) setPlan(res.plan);
      setRecents(res.recents);
    }).catch(() => {});
    window.zenstate.bcGetAuthState().then(setAuthState).catch(() => {});
    return () => { offChanged(); offPicker(); };
  }, []);

  const handlePinned = useCallback(async (pinnedTodoIds: number[]) => {
    // After batch pin, refresh plan from main process via today:get so the
    // items appear in the plan list. todayPinMany already updated the store;
    // we subscribe to TODAY_CHANGED so this is belt-and-suspenders.
    void pinnedTodoIds;
    const res = await window.zenstate.todayGet().catch(() => null);
    if (res) { setPlan(res.plan); setRecents(res.recents); }
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
    if (!item) return;
    const wasIncomplete = !item.completedAt;
    const isThisRunning = timerState.isRunning && timerState.taskLabel === item.content;

    if (wasIncomplete && isThisRunning) {
      // Wait for the stop to land in main + the timer-update broadcast to come back,
      // THEN toggle. This guarantees the records refresh fires after the session save.
      await new Promise<void>((resolve) => {
        const off = window.zenstate.on(IPC.TIMER_UPDATE as string, (state: unknown) => {
          const s = state as { isRunning: boolean };
          if (!s.isRunning) { off(); resolve(); }
        });
        window.zenstate.stopTimer();
        // Safety timeout — don't hang forever.
        setTimeout(() => { off(); resolve(); }, 2000);
      });
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
                paused={isRunning(item) && timerState.isPaused}
                trackedToday={trackedByTodoId.get(item.todoId) ?? 0}
                editingEstimate={editingEstimate === item.todoId}
                onStartEditEstimate={() => setEditingEstimate(item.todoId)}
                onSaveEstimate={(min) => handleSetEstimate(item.todoId, min)}
                onCancelEditEstimate={() => setEditingEstimate(null)}
                onStartTimer={() => handleStartTimer(item)}
                onPauseTimer={() => window.zenstate.pauseTimer()}
                onResumeTimer={() => window.zenstate.resumeTimer()}
                onStopTimer={() => window.zenstate.stopTimer()}
                onUnpin={() => handleUnpin(item.todoId)}
                onToggleComplete={() => handleToggleComplete(item.todoId)}
                onLogTime={() => setLogTimeFor(item)}
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
      {pickerOpen && authState?.isConnected && authState.account && (
        <PinPicker
          open={pickerOpen}
          mode="multi"
          target="today"
          recents={recents}
          alreadyPinned={new Set(plan.items.map((i) => i.todoId))}
          accountId={authState.account.id}
          onClose={() => setPickerOpen(false)}
          onPinned={handlePinned}
        />
      )}

      {/* Log time modal — pre-filled with the clicked todo's Basecamp link
          and label. The user just enters duration + optional notes. */}
      {logTimeFor && (
        <AddSessionModal
          prefill={{
            taskLabel: logTimeFor.content,
            basecamp: {
              accountId: logTimeFor.accountId,
              projectId: logTimeFor.projectId,
              todoId: logTimeFor.todoId,
              todoListId: logTimeFor.todoListId,
            },
          }}
          onClose={() => setLogTimeFor(null)}
          onSaved={() => {
            setLogTimeFor(null);
            onRefreshRecords();
          }}
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
  paused: boolean;
  trackedToday: number;
  editingEstimate: boolean;
  onStartEditEstimate: () => void;
  onSaveEstimate: (minutes: number | null) => void;
  onCancelEditEstimate: () => void;
  onStartTimer: () => void;
  onPauseTimer: () => void;
  onResumeTimer: () => void;
  onStopTimer: () => void;
  onUnpin: () => void;
  onToggleComplete: () => void;
  onLogTime: () => void;
}

function PinnedRow({
  item, running, paused, trackedToday, editingEstimate,
  onStartEditEstimate, onSaveEstimate, onCancelEditEstimate,
  onStartTimer, onPauseTimer, onResumeTimer, onStopTimer, onUnpin, onToggleComplete, onLogTime,
}: PinnedRowProps) {
  // Two-field estimate (hours + minutes). The stored value is still a single
  // minutes integer — we just split for the UI so anyone planning a 2h+ task
  // doesn't have to type "120" minutes.
  const initialEstH = Math.floor((item.estimateMinutes ?? 0) / 60);
  const initialEstM = (item.estimateMinutes ?? 0) % 60;
  const [estH, setEstH] = useState(initialEstH);
  const [estM, setEstM] = useState(initialEstM);
  const [hovered, setHovered] = useState(false);
  const isComplete = !!item.completedAt;

  const estimateSec = (item.estimateMinutes ?? 0) * 60;
  const progress = estimateSec > 0 ? Math.min(1, trackedToday / estimateSec) : 0;
  const overEstimate = estimateSec > 0 && trackedToday > estimateSec;

  // Pretty-print the estimate value next to tracked time. Examples:
  //   30 min → "30m"
  //   90 min → "1h 30m"
  //   120 min → "2h"
  function formatEstimate(mins: number): string {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
  }

  function commitEstimate() {
    const total = estH * 60 + estM;
    onSaveEstimate(total > 0 ? total : null);
  }

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

        {/* Estimate / tracked. Editing splits into two number inputs (hours
            and minutes) so a 2h+ task doesn't need typing "120". The stored
            value is still a single minutes integer. */}
        {editingEstimate ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              type="number"
              min="0"
              max="16"
              value={estH}
              autoFocus
              onChange={(e) => setEstH(parseInt(e.target.value, 10) || 0)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitEstimate();
                else if (e.key === 'Escape') onCancelEditEstimate();
              }}
              className="text-input"
              style={{ width: 44, padding: '4px 6px', fontSize: 'var(--text-sm)', textAlign: 'right' }}
            />
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--zen-tertiary-text)' }}>h</span>
            <input
              type="number"
              min="0"
              max="59"
              value={estM}
              onChange={(e) => setEstM(parseInt(e.target.value, 10) || 0)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitEstimate();
                else if (e.key === 'Escape') onCancelEditEstimate();
              }}
              onBlur={commitEstimate}
              className="text-input"
              style={{ width: 44, padding: '4px 6px', fontSize: 'var(--text-sm)', textAlign: 'right' }}
            />
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--zen-tertiary-text)' }}>m</span>
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
              ? `${formatHM(trackedToday)} / ${formatEstimate(item.estimateMinutes)}`
              : trackedToday > 0
                ? formatHM(trackedToday)
                : 'Set estimate'}
          </button>
        )}

        {/* Start / Pause / Resume / Stop. When the timer is running on this
            task, show both Pause (or Resume) and Stop so the user doesn't
            need to open the pill to pause. Start is disabled on completed
            tasks — uncheck first to reuse. */}
        {running ? (
          <div style={{ display: 'inline-flex', gap: 6 }}>
            <button
              onClick={paused ? onResumeTimer : onPauseTimer}
              className="btn btn-secondary"
              title={paused ? 'Resume' : 'Pause'}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 12px' }}
            >
              {paused ? <Play size={11} /> : <Pause size={11} />}
              {paused ? 'Resume' : 'Pause'}
            </button>
            <button onClick={onStopTimer} className="btn btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 12px' }}>
              <Square size={11} /> Stop
            </button>
          </div>
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

        {/* Log time (visible on hover) — manual session entry pre-filled
            with this todo. For times worked outside the live timer. */}
        <button
          onClick={onLogTime}
          title="Log time spent on this task without starting the timer"
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
          <Timer size={14} />
        </button>

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

// ── PinPicker v2 ───────────────────────────────────────────────────
// Multi-tab picker: My Todos / Due / Recents / Search / Browse.
// Supports single (click-to-pin-close) and multi (checkmark + batch) modes.

export interface PinPickerProps {
  open: boolean;
  mode: 'multi' | 'single';
  target: 'today' | 'tomorrow';
  recents: RecentTodo[];
  alreadyPinned: Set<number>;
  accountId: number;
  onClose: () => void;
  onPinned?: (pinnedTodoIds: number[]) => void;
  // v5.1.0 — when present (single mode), the picker hands the constructed
  // PinnedTodo back to the caller WITHOUT calling todayPinMany/tomorrowPinMany.
  // Used by AddSessionModal/SessionEditModal where the user is picking a
  // Basecamp link for a session, not pinning to Today/Tomorrow.
  onPickedItem?: (item: PinnedTodo) => void;
  title?: string;
}

type PickerTab = 'mine' | 'due' | 'recents' | 'search' | 'browse';
type BrowseStep = 'projects' | 'lists' | 'todos';
const DUE_SCOPE_LABELS: { scope: MyAssignmentsDueScope; label: string }[] = [
  { scope: 'overdue', label: 'Overdue' },
  { scope: 'due_today', label: 'Today' },
  { scope: 'due_tomorrow', label: 'Tomorrow' },
  { scope: 'due_later_this_week', label: 'This week' },
  { scope: 'due_next_week', label: 'Next week' },
  { scope: 'due_later', label: 'Later' },
];

function stripEmTags(s: string): string {
  return s.replace(/<\/?em>/g, '');
}

function assignmentToPinned(a: MyAssignment, accountId: number): PinnedTodo | null {
  if (!a.parent?.id) return null;
  return {
    todoId: a.id, projectId: a.bucket.id, todoListId: a.parent.id,
    accountId, content: a.content, projectName: a.bucket.name,
  };
}

function searchResultToPinned(r: TodoSearchResult, accountId: number): PinnedTodo | null {
  if (!r.parent?.id) return null;
  return {
    todoId: r.id, projectId: r.bucket.id, todoListId: r.parent.id,
    accountId, content: stripEmTags(r.title), projectName: r.bucket.name,
  };
}

export function PinPicker({ open, mode, target, recents, alreadyPinned, accountId, onClose, onPinned, onPickedItem, title }: PinPickerProps) {
  const [tab, setTab] = useState<PickerTab>('browse');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 520, display: 'flex', flexDirection: 'column', maxHeight: '80vh', padding: 0, overflow: 'hidden' }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '16px 16px 0', gap: 8 }}>
          <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, margin: 0, flex: 1, letterSpacing: '-0.01em' }}>
            {title ?? (target === 'tomorrow' ? 'Pin to tomorrow' : 'Pin a to-do')}
          </h3>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: 'var(--zen-tertiary-text)', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center', borderRadius: 4 }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 2, padding: '12px 16px 0', borderBottom: '1px solid var(--zen-divider)', flexShrink: 0 }}>
          {(['browse', 'search', 'mine', 'recents', 'due'] as PickerTab[]).map((t) => {
            const labels: Record<PickerTab, string> = { mine: 'My Todos', due: 'Due', recents: 'Recents', search: 'Search', browse: 'Browse' };
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  fontSize: 'var(--text-sm)', fontWeight: tab === t ? 600 : 400,
                  color: tab === t ? 'var(--zen-text)' : 'var(--zen-tertiary-text)',
                  padding: '6px 10px 10px',
                  borderBottom: tab === t ? '2px solid var(--zen-primary)' : '2px solid transparent',
                  marginBottom: -1, fontFamily: 'inherit',
                  transition: 'color var(--duration-quick) var(--ease-standard)',
                }}
              >
                {labels[t]}
              </button>
            );
          })}
        </div>

        <PickerBody
          tab={tab}
          mode={mode}
          target={target}
          recents={recents}
          alreadyPinned={alreadyPinned}
          accountId={accountId}
          onClose={onClose}
          onPinned={onPinned}
          onPickedItem={onPickedItem}
        />
      </div>
    </div>
  );
}

// ── PickerBody — owns per-tab state + multi-select footer ──────────

interface PickerBodyProps {
  tab: PickerTab;
  mode: 'multi' | 'single';
  target: 'today' | 'tomorrow';
  recents: RecentTodo[];
  alreadyPinned: Set<number>;
  accountId: number;
  onClose: () => void;
  onPinned?: (ids: number[]) => void;
  onPickedItem?: (item: PinnedTodo) => void;
}

function PickerBody({ tab, mode, target, recents, alreadyPinned, accountId, onClose, onPinned, onPickedItem }: PickerBodyProps) {
  const [pending, setPending] = useState<Map<number, PinnedTodo>>(new Map());
  const [pinning, setPinning] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  const toggleItem = useCallback((item: PinnedTodo) => {
    setPending((prev) => {
      const next = new Map(prev);
      if (next.has(item.todoId)) next.delete(item.todoId);
      else next.set(item.todoId, item);
      return next;
    });
  }, []);

  const pinAll = useCallback(async () => {
    if (pending.size === 0 || pinning) return;
    setPinning(true); setPinError(null);
    try {
      const items = Array.from(pending.values());
      if (target === 'tomorrow') await zs.tomorrowPinMany(items);
      else await zs.todayPinMany(items);
      onPinned?.(items.map((i) => i.todoId));
      setPending(new Map());
    } catch (e) {
      setPinError((e as Error).message ?? 'Failed to pin');
    } finally {
      setPinning(false);
    }
  }, [pending, pinning, target, onPinned]);

  const pinSingle = useCallback(async (item: PinnedTodo) => {
    if (pinning) return;
    // Modal pick-without-pin path: hand item back to caller, close, don't IPC.
    if (onPickedItem) {
      onPickedItem(item);
      onClose();
      return;
    }
    setPinning(true); setPinError(null);
    try {
      if (target === 'tomorrow') await zs.tomorrowPinMany([item]);
      else await zs.todayPinMany([item]);
      onPinned?.([item.todoId]);
      onClose();
    } catch (e) {
      setPinError((e as Error).message ?? 'Failed to pin');
      setPinning(false);
    }
  }, [pinning, target, onPinned, onPickedItem, onClose]);

  const onRowClick = useCallback((item: PinnedTodo) => {
    if (mode === 'single') pinSingle(item);
    else toggleItem(item);
  }, [mode, pinSingle, toggleItem]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 8px 4px' }}>
        {tab === 'mine' && (
          <MyTodosTab alreadyPinned={alreadyPinned} accountId={accountId} pending={pending} onRowClick={onRowClick} />
        )}
        {tab === 'due' && (
          <DueTab alreadyPinned={alreadyPinned} accountId={accountId} pending={pending} onRowClick={onRowClick} />
        )}
        {tab === 'recents' && (
          <RecentsTab recents={recents} alreadyPinned={alreadyPinned} pending={pending} onRowClick={onRowClick} />
        )}
        {tab === 'search' && (
          <SearchTab alreadyPinned={alreadyPinned} accountId={accountId} pending={pending} onRowClick={onRowClick} />
        )}
        {tab === 'browse' && (
          <BrowseTab alreadyPinned={alreadyPinned} accountId={accountId} pending={pending} onRowClick={onRowClick} />
        )}
      </div>

      {mode === 'multi' && (
        <div style={{
          borderTop: '1px solid var(--zen-divider)', padding: '10px 16px',
          display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
          background: 'var(--zen-secondary-bg)',
        }}>
          <span style={{ flex: 1, fontSize: 'var(--text-sm)', color: 'var(--zen-secondary-text)' }}>
            {pending.size > 0 ? `${pending.size} selected` : 'Select to-dos to pin'}
          </span>
          {pinError && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--status-focused)' }}>{pinError}</span>}
          {pending.size > 0 && (
            <button className="btn btn-secondary" onClick={() => setPending(new Map())} style={{ padding: '6px 12px', fontSize: 'var(--text-sm)' }}>
              Cancel
            </button>
          )}
          <button
            className="btn btn-primary"
            disabled={pending.size === 0 || pinning}
            onClick={pinAll}
            style={{ padding: '6px 14px', fontSize: 'var(--text-sm)', opacity: pending.size === 0 ? 0.45 : 1 }}
          >
            {pinning ? 'Pinning…' : pending.size > 0 ? `Pin ${pending.size} to-do${pending.size > 1 ? 's' : ''}` : 'Pin to-dos'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Shared selectable row ──────────────────────────────────────────

interface SelectableRowProps {
  todoId: number;
  title: string;
  subtitle: string;
  dueOn?: string;
  excerpt?: string;
  checked: boolean;
  disabled?: boolean;
  onClick: () => void;
}

function SelectableRow({ todoId: _todoId, title, subtitle, dueOn, excerpt, checked, disabled, onClick }: SelectableRowProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', width: '100%', textAlign: 'left', alignItems: 'flex-start',
        padding: '9px 10px', borderRadius: 'var(--radius-sm)',
        background: checked ? 'rgba(10, 132, 255, 0.08)' : hovered ? 'var(--zen-hover)' : 'transparent',
        border: `1px solid ${checked ? 'rgba(10, 132, 255, 0.2)' : 'transparent'}`,
        cursor: disabled ? 'default' : 'pointer',
        gap: 10, fontFamily: 'inherit',
        transition: 'background var(--duration-quick) var(--ease-standard)',
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <div style={{
        width: 16, height: 16, borderRadius: '50%', flexShrink: 0, marginTop: 2,
        border: checked ? 'none' : '1.5px solid var(--zen-divider)',
        background: checked ? 'var(--zen-primary)' : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {checked && <Check size={9} color="white" strokeWidth={3} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--text-base)', color: 'var(--zen-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--zen-tertiary-text)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {subtitle}
        </div>
        {excerpt && (
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--zen-tertiary-text)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontStyle: 'italic' }}>
            {excerpt}
          </div>
        )}
      </div>
      {dueOn && (
        <span style={{
          fontSize: 10, color: 'var(--zen-secondary-text)',
          background: 'var(--zen-tertiary-bg)', border: '1px solid var(--zen-divider)',
          borderRadius: 4, padding: '1px 5px', flexShrink: 0, marginTop: 2,
          fontFamily: 'var(--font-mono)',
        }}>
          {dueOn}
        </span>
      )}
    </button>
  );
}

function TabLoading({ label }: { label: string }) {
  return <div style={{ padding: 'var(--space-4)', textAlign: 'center', fontSize: 'var(--text-sm)', color: 'var(--zen-tertiary-text)' }}>{label}</div>;
}

function TabError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div style={{ padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--status-focused)', textAlign: 'center' }}>{message}</span>
      <button className="btn btn-secondary" onClick={onRetry} style={{ padding: '4px 12px', fontSize: 'var(--text-sm)' }}>Retry</button>
    </div>
  );
}

function TabEmpty({ label }: { label: string }) {
  return <div style={{ padding: 'var(--space-4)', textAlign: 'center', fontSize: 'var(--text-sm)', color: 'var(--zen-tertiary-text)' }}>{label}</div>;
}

// ── My Todos tab ───────────────────────────────────────────────────

interface MyTodosTabProps {
  alreadyPinned: Set<number>;
  accountId: number;
  pending: Map<number, PinnedTodo>;
  onRowClick: (item: PinnedTodo) => void;
}

function MyTodosTab({ alreadyPinned, accountId, pending, onRowClick }: MyTodosTabProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<MyAssignmentsResponse | null>(null);
  const [created, setCreated] = useState<PinnedTodo[]>([]);
  const fetched = useRef(false);

  const fetchData = useCallback(() => {
    setLoading(true); setError(null);
    zs.bcGetMyAssignments()
      .then((res) => { if (res.ok) setData(res.data); else setError(res.error); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;
    fetchData();
  }, [fetchData]);

  const handleCreated = (item: PinnedTodo) => {
    setCreated((prev) => [item, ...prev]);
    onRowClick(item);
  };

  if (loading && !data) return <TabLoading label="Loading your to-dos…" />;
  if (error) return <TabError message={error} onRetry={fetchData} />;

  const priorities = (data?.priorities ?? []).filter((a) => !alreadyPinned.has(a.id));
  const nonPriorities = (data?.nonPriorities ?? []).filter((a) => !alreadyPinned.has(a.id));
  const allEmpty = priorities.length === 0 && nonPriorities.length === 0 && created.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {created.map((item) => (
        <SelectableRow
          key={item.todoId} todoId={item.todoId} title={item.content} subtitle={item.projectName}
          checked={pending.has(item.todoId)} onClick={() => onRowClick(item)}
        />
      ))}
      {priorities.length > 0 && (
        <>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--zen-tertiary-text)', letterSpacing: '0.06em', textTransform: 'uppercase', padding: '6px 10px 2px' }}>
            Priorities
          </div>
          {priorities.map((a) => {
            const item = assignmentToPinned(a, accountId);
            return (
              <SelectableRow
                key={a.id} todoId={a.id} title={a.content}
                subtitle={`${a.bucket.name}${a.parent ? ` · ${a.parent.title}` : ''}`}
                dueOn={a.dueOn} checked={pending.has(a.id)} disabled={!item}
                onClick={() => item && onRowClick(item)}
              />
            );
          })}
        </>
      )}
      {nonPriorities.length > 0 && (
        <>
          {priorities.length > 0 && (
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--zen-tertiary-text)', letterSpacing: '0.06em', textTransform: 'uppercase', padding: '8px 10px 2px' }}>
              Other
            </div>
          )}
          {nonPriorities.map((a) => {
            const item = assignmentToPinned(a, accountId);
            return (
              <SelectableRow
                key={a.id} todoId={a.id} title={a.content}
                subtitle={`${a.bucket.name}${a.parent ? ` · ${a.parent.title}` : ''}`}
                dueOn={a.dueOn} checked={pending.has(a.id)} disabled={!item}
                onClick={() => item && onRowClick(item)}
              />
            );
          })}
        </>
      )}
      {allEmpty && !loading && <TabEmpty label="No assigned to-dos." />}
      <CreateTodoInline onCreated={handleCreated} accountId={accountId} />
    </div>
  );
}

// ── Inline Create form ─────────────────────────────────────────────

interface CreateTodoInlineProps {
  accountId: number;
  onCreated: (item: PinnedTodo) => void;
}

function CreateTodoInline({ accountId, onCreated }: CreateTodoInlineProps) {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<BasecampProject[]>([]);
  const [lists, setLists] = useState<BasecampTodoList[]>([]);
  const [selProject, setSelProject] = useState<BasecampProject | null>(null);
  const [selList, setSelList] = useState<BasecampTodoList | null>(null);
  const [content, setContent] = useState('');
  const [loadingP, setLoadingP] = useState(false);
  const [loadingL, setLoadingL] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProjects = useCallback(() => {
    if (projects.length > 0) return;
    setLoadingP(true);
    zs.bcListProjects()
      .then((res) => { if (res.ok) setProjects(res.data); })
      .catch(() => {})
      .finally(() => setLoadingP(false));
  }, [projects.length]);

  useEffect(() => { if (open) loadProjects(); }, [open, loadProjects]);

  const handleProjectChange = (id: number) => {
    const p = projects.find((x) => x.id === id) ?? null;
    setSelProject(p); setSelList(null); setLists([]);
    if (!p?.todoSetId) return;
    setLoadingL(true);
    zs.bcListTodoLists(p.id, p.todoSetId)
      .then((res) => { if (res.ok) setLists(res.data); })
      .catch(() => {})
      .finally(() => setLoadingL(false));
  };

  const handleCreate = async () => {
    if (!selProject || !selList || !content.trim() || creating) return;
    setCreating(true); setError(null);
    try {
      const res = await zs.bcCreateTodo({ projectId: selProject.id, todoListId: selList.id, content: content.trim() });
      if (!res.ok) { setError(res.error); setCreating(false); return; }
      const todo = res.data;
      onCreated({ todoId: todo.id, projectId: selProject.id, todoListId: selList.id, accountId, content: todo.content, projectName: selProject.name });
      setContent(''); setSelProject(null); setSelList(null); setLists([]); setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px',
          borderRadius: 'var(--radius-sm)', background: 'transparent', border: 'none',
          cursor: 'pointer', color: 'var(--zen-tertiary-text)', fontSize: 'var(--text-sm)', fontFamily: 'inherit',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--zen-secondary-text)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--zen-tertiary-text)'; }}
      >
        <Plus size={13} /> New to-do
      </button>
    );
  }

  return (
    <div style={{ marginTop: 8, padding: '10px 12px', borderRadius: 'var(--radius-md)', background: 'var(--zen-secondary-bg)', border: '1px solid var(--zen-divider)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <select
        className="text-input"
        value={selProject?.id ?? ''}
        onChange={(e) => handleProjectChange(Number(e.target.value))}
        style={{ fontSize: 'var(--text-sm)' }}
        disabled={loadingP}
      >
        <option value="">{loadingP ? 'Loading projects…' : 'Choose project…'}</option>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <select
        className="text-input"
        value={selList?.id ?? ''}
        onChange={(e) => setSelList(lists.find((l) => l.id === Number(e.target.value)) ?? null)}
        disabled={!selProject || loadingL}
        style={{ fontSize: 'var(--text-sm)' }}
      >
        <option value="">{loadingL ? 'Loading lists…' : 'Choose list…'}</option>
        {lists.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
      </select>
      <input
        className="text-input"
        placeholder="To-do content…"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) handleCreate(); }}
        style={{ fontSize: 'var(--text-sm)' }}
      />
      {error && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--status-focused)' }}>{error}</span>}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button className="btn btn-secondary" onClick={() => setOpen(false)} style={{ padding: '4px 10px', fontSize: 'var(--text-sm)' }}>Cancel</button>
        <button
          className="btn btn-primary"
          disabled={!selProject || !selList || !content.trim() || creating}
          onClick={handleCreate}
          style={{ padding: '4px 12px', fontSize: 'var(--text-sm)' }}
        >
          {creating ? 'Creating…' : 'Create'}
        </button>
      </div>
    </div>
  );
}

// ── Due tab ────────────────────────────────────────────────────────

interface DueTabProps {
  alreadyPinned: Set<number>;
  accountId: number;
  pending: Map<number, PinnedTodo>;
  onRowClick: (item: PinnedTodo) => void;
}

function DueTab({ alreadyPinned, accountId, pending, onRowClick }: DueTabProps) {
  const [scope, setScope] = useState<MyAssignmentsDueScope>('due_today');
  const [cache, setCache] = useState<Partial<Record<MyAssignmentsDueScope, MyAssignment[]>>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchScope = useCallback((s: MyAssignmentsDueScope) => {
    if (cache[s]) return;
    setLoading(true); setError(null);
    zs.bcGetMyAssignmentsDue(s)
      .then((res) => { if (res.ok) setCache((prev) => ({ ...prev, [s]: res.data })); else setError(res.error); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [cache]);

  useEffect(() => { fetchScope(scope); }, [scope, fetchScope]);

  const items = (cache[scope] ?? []).filter((a) => !alreadyPinned.has(a.id));
  const retryScope = () => { setCache((c) => { const n = { ...c }; delete n[scope]; return n; }); fetchScope(scope); };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '4px 2px 2px' }}>
        {DUE_SCOPE_LABELS.map(({ scope: s, label }) => (
          <button
            key={s}
            onClick={() => setScope(s)}
            style={{
              padding: '3px 10px', borderRadius: 12,
              border: `1px solid ${scope === s ? 'var(--zen-primary)' : 'var(--zen-divider)'}`,
              background: scope === s ? 'rgba(10, 132, 255, 0.12)' : 'transparent',
              color: scope === s ? 'var(--zen-primary)' : 'var(--zen-secondary-text)',
              fontSize: 'var(--text-xs)', fontWeight: scope === s ? 600 : 400,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {loading && <TabLoading label="Loading…" />}
      {error && <TabError message={error} onRetry={retryScope} />}
      {!loading && !error && items.length === 0 && <TabEmpty label="Nothing due in this range." />}
      {items.map((a) => {
        const item = assignmentToPinned(a, accountId);
        return (
          <SelectableRow
            key={a.id} todoId={a.id} title={a.content}
            subtitle={`${a.bucket.name}${a.parent ? ` · ${a.parent.title}` : ''}`}
            dueOn={a.dueOn} checked={pending.has(a.id)} disabled={!item}
            onClick={() => item && onRowClick(item)}
          />
        );
      })}
    </div>
  );
}

// ── Recents tab ────────────────────────────────────────────────────

interface RecentsTabProps {
  recents: RecentTodo[];
  alreadyPinned: Set<number>;
  pending: Map<number, PinnedTodo>;
  onRowClick: (item: PinnedTodo) => void;
}

function RecentsTab({ recents, alreadyPinned, pending, onRowClick }: RecentsTabProps) {
  const filtered = recents.filter((r) => !alreadyPinned.has(r.todoId));
  if (filtered.length === 0) return <TabEmpty label="No recent to-dos." />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {filtered.map((r) => {
        const item: PinnedTodo = { todoId: r.todoId, projectId: r.projectId, todoListId: r.todoListId, accountId: r.accountId, content: r.content, projectName: r.projectName };
        return (
          <SelectableRow
            key={r.todoId} todoId={r.todoId} title={r.content} subtitle={r.projectName}
            checked={pending.has(r.todoId)} onClick={() => onRowClick(item)}
          />
        );
      })}
    </div>
  );
}

// ── Search tab ─────────────────────────────────────────────────────

interface SearchTabProps {
  alreadyPinned: Set<number>;
  accountId: number;
  pending: Map<number, PinnedTodo>;
  onRowClick: (item: PinnedTodo) => void;
}

function SearchTab({ alreadyPinned, accountId, pending, onRowClick }: SearchTabProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TodoSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback((q: string) => {
    if (q.length < 2) { setResults([]); return; }
    setLoading(true); setError(null);
    zs.bcSearchTodos(q)
      .then((res) => {
        if (res.ok) setResults(res.data.filter((r) => !alreadyPinned.has(r.id)));
        else setError(res.error);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [alreadyPinned]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(q), 300);
  };

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ position: 'relative' }}>
        <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--zen-tertiary-text)', pointerEvents: 'none' }} />
        <input
          autoFocus
          className="text-input"
          placeholder="Search to-dos…"
          value={query}
          onChange={handleChange}
          style={{ paddingLeft: 30 }}
        />
      </div>
      {query.length < 2 && <TabEmpty label="Type at least 2 characters to search." />}
      {query.length >= 2 && loading && <TabLoading label="Searching…" />}
      {query.length >= 2 && error && <TabError message={error} onRetry={() => doSearch(query)} />}
      {query.length >= 2 && !loading && !error && results.length === 0 && <TabEmpty label="No matches." />}
      {results.map((r) => {
        const item = searchResultToPinned(r, accountId);
        return (
          <SelectableRow
            key={r.id} todoId={r.id} title={stripEmTags(r.title)}
            subtitle={`${r.bucket.name}${r.parent ? ` · ${r.parent.title}` : ''}`}
            excerpt={r.excerpt ? stripEmTags(r.excerpt) : undefined}
            checked={pending.has(r.id)} disabled={!item}
            onClick={() => item && onRowClick(item)}
          />
        );
      })}
    </div>
  );
}

// ── Browse tab (3-layer drill) ─────────────────────────────────────

interface BrowseTabProps {
  alreadyPinned: Set<number>;
  accountId: number;
  pending: Map<number, PinnedTodo>;
  onRowClick: (item: PinnedTodo) => void;
}

function BrowseTab({ alreadyPinned, accountId, pending, onRowClick }: BrowseTabProps) {
  const [step, setStep] = useState<BrowseStep>('projects');
  const [projects, setProjects] = useState<BasecampProject[]>([]);
  const [lists, setLists] = useState<BasecampTodoList[]>([]);
  const [todos, setTodos] = useState<BasecampTodo[]>([]);
  const [project, setProject] = useState<BasecampProject | null>(null);
  const [list, setList] = useState<BasecampTodoList | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [createContent, setCreateContent] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const fetched = useRef(false);

  const fetchProjects = useCallback(() => {
    setLoading(true); setError(null);
    zs.bcListProjects()
      .then((res) => { if (res.ok) setProjects(res.data); else setError(res.error); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;
    fetchProjects();
  }, [fetchProjects]);

  useEffect(() => { setSearch(''); }, [step]);

  const goToLists = (p: BasecampProject) => {
    setProject(p); setStep('lists'); setLists([]); setLoading(true); setError(null);
    if (!p.todoSetId) { setError('Project has no to-do set'); setLoading(false); return; }
    zs.bcListTodoLists(p.id, p.todoSetId)
      .then((res) => { if (res.ok) setLists(res.data); else setError(res.error); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  const goToTodos = (l: BasecampTodoList) => {
    if (!project) return;
    setList(l); setStep('todos'); setTodos([]); setLoading(true); setError(null);
    zs.bcListTodos(project.id, l.id)
      .then((res) => { if (res.ok) setTodos(res.data); else setError(res.error); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  const goBack = () => {
    if (step === 'todos') setStep('lists');
    else if (step === 'lists') setStep('projects');
  };

  const handleCreateInBrowse = async () => {
    if (!project || !list || !createContent.trim() || creating) return;
    setCreating(true); setCreateError(null);
    try {
      const res = await zs.bcCreateTodo({ projectId: project.id, todoListId: list.id, content: createContent.trim() });
      if (!res.ok) { setCreateError(res.error); setCreating(false); return; }
      const todo = res.data;
      setTodos((prev) => [...prev, todo]);
      const item: PinnedTodo = { todoId: todo.id, projectId: project.id, todoListId: list.id, accountId, content: todo.content, projectName: project.name };
      onRowClick(item);
      setCreateContent('');
    } catch (e) {
      setCreateError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const filteredProjects = search ? projects.filter((p) => p.name.toLowerCase().includes(search.toLowerCase())) : projects;
  const filteredLists = search ? lists.filter((l) => l.title.toLowerCase().includes(search.toLowerCase())) : lists;
  const filteredTodos = (search ? todos.filter((t) => t.content.toLowerCase().includes(search.toLowerCase())) : todos).filter((t) => !alreadyPinned.has(t.id));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {step !== 'projects' && (
          <button
            onClick={goBack}
            style={{ background: 'transparent', border: 'none', color: 'var(--zen-secondary-text)', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center', borderRadius: 4 }}
          >
            <ArrowLeft size={14} />
          </button>
        )}
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--zen-tertiary-text)' }}>
          {step === 'projects' && 'Projects'}
          {step === 'lists' && project?.name}
          {step === 'todos' && `${project?.name ?? ''} · ${list?.title ?? ''}`}
        </span>
      </div>

      <div style={{ position: 'relative' }}>
        <Search size={12} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--zen-tertiary-text)', pointerEvents: 'none' }} />
        <input
          className="text-input"
          placeholder={step === 'projects' ? 'Search projects…' : step === 'lists' ? 'Search lists…' : 'Search to-dos…'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ paddingLeft: 28, fontSize: 'var(--text-sm)' }}
        />
      </div>

      {loading && <TabLoading label={`Loading ${step}…`} />}
      {error && <TabError message={error} onRetry={step === 'projects' ? fetchProjects : () => {}} />}

      {!loading && !error && step === 'projects' && (
        filteredProjects.length === 0
          ? <TabEmpty label="No projects match." />
          : filteredProjects.map((p) => (
              <BrowseRow key={p.id} title={p.name} subtitle={p.description} onClick={() => goToLists(p)} />
            ))
      )}

      {!loading && !error && step === 'lists' && (
        filteredLists.length === 0
          ? <TabEmpty label="No lists match." />
          : filteredLists.map((l) => (
              <BrowseRow key={l.id} title={l.title} subtitle={l.description} onClick={() => goToTodos(l)} />
            ))
      )}

      {!loading && !error && step === 'todos' && (
        <>
          {filteredTodos.length === 0 && <TabEmpty label={search ? 'No to-dos match.' : 'No to-dos in this list.'} />}
          {filteredTodos.map((t) => {
            const item: PinnedTodo | null = (project && list)
              ? { todoId: t.id, projectId: project.id, todoListId: list.id, accountId, content: t.content, projectName: project.name }
              : null;
            return (
              <SelectableRow
                key={t.id} todoId={t.id} title={t.content}
                subtitle={`${project?.name ?? ''}${list ? ` · ${list.title}` : ''}`}
                checked={pending.has(t.id)} disabled={!item}
                onClick={() => item && onRowClick(item)}
              />
            );
          })}
          <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
            <input
              className="text-input"
              placeholder="New to-do…"
              value={createContent}
              onChange={(e) => setCreateContent(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreateInBrowse(); }}
              style={{ flex: 1, fontSize: 'var(--text-sm)' }}
            />
            <button
              className="btn btn-primary"
              disabled={!createContent.trim() || creating}
              onClick={handleCreateInBrowse}
              style={{ padding: '6px 12px', fontSize: 'var(--text-sm)', whiteSpace: 'nowrap' }}
            >
              {creating ? '…' : 'Create'}
            </button>
          </div>
          {createError && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--status-focused)' }}>{createError}</span>}
        </>
      )}
    </div>
  );
}

function BrowseRow({ title, subtitle, onClick }: { title: string; subtitle?: string; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', width: '100%', textAlign: 'left',
        padding: '9px 10px', borderRadius: 'var(--radius-sm)',
        background: hovered ? 'var(--zen-hover)' : 'transparent', border: 'none',
        cursor: 'pointer', fontFamily: 'inherit', gap: 8,
        transition: 'background var(--duration-quick) var(--ease-standard)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--text-base)', color: 'var(--zen-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
        {subtitle && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--zen-tertiary-text)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subtitle}</div>}
      </div>
      <ChevronDown size={12} style={{ color: 'var(--zen-tertiary-text)', flexShrink: 0, transform: 'rotate(-90deg)' }} />
    </button>
  );
}
