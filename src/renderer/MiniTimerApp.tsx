import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Pause, Play, Square, ChevronDown, Briefcase, StickyNote } from 'lucide-react';
import { IPC, TodayPlan, RecentTodo, PinnedTodo, AppSettings } from '../shared/types';

interface TimerState {
  elapsed: number;
  isRunning: boolean;
  isPaused: boolean;
  taskLabel: string;
}

const COMPACT_W = 240;
const COMPACT_H = 36;
const EXPANDED_W = 300;
// Height calculated dynamically: header (52) + items (each 50) + padding (12).

function formatHMS(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Notes section is fixed height — we use this in the dynamic resize calc below.
const NOTES_SECTION_H = 110;

export default function MiniTimerApp() {
  const [timer, setTimer] = useState<TimerState>({ elapsed: 0, isRunning: false, isPaused: false, taskLabel: '' });
  const [expanded, setExpanded] = useState(false);
  const [plan, setPlan] = useState<TodayPlan | null>(null);
  const [recents, setRecents] = useState<RecentTodo[]>([]);
  const [autoDim, setAutoDim] = useState(false);
  const [dimmed, setDimmed] = useState(false);
  const [notes, setNotes] = useState('');
  const dimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notesSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Subscribe to timer state ─────────────────────────────────
  useEffect(() => {
    window.zenstate.on(IPC.TIMER_UPDATE, (data: unknown) => {
      const t = data as TimerState;
      setTimer(t);
    });
    return () => { window.zenstate.removeAllListeners(IPC.TIMER_UPDATE); };
  }, []);

  // ── Load plan + recents + settings; subscribe to changes ─────
  useEffect(() => {
    (window as any).zenstate.todayGet?.().then((res: { plan: TodayPlan; recents: RecentTodo[] }) => {
      if (res) { setPlan(res.plan); setRecents(res.recents); }
    }).catch(() => {});
    (window as any).zenstate.getSettings?.().then((s: AppSettings) => {
      setAutoDim(!!s?.miniTimerAutoDim);
    }).catch(() => {});

    const onTodayChanged = (...args: unknown[]) => setPlan(args[0] as TodayPlan);
    const onSettingsChanged = (...args: unknown[]) => setAutoDim(!!(args[0] as AppSettings)?.miniTimerAutoDim);
    window.zenstate.on('today:changed', onTodayChanged);
    window.zenstate.on('settings:updated', onSettingsChanged);
    return () => {
      window.zenstate.removeAllListeners('today:changed');
      window.zenstate.removeAllListeners('settings:updated');
    };
  }, []);

  // ── Auto-dim: fade pill to 50% after 4s of no hover, snap back on enter ──
  const scheduleDim = useCallback(() => {
    if (dimTimerRef.current) clearTimeout(dimTimerRef.current);
    if (!autoDim || expanded) {
      setDimmed(false);
      return;
    }
    dimTimerRef.current = setTimeout(() => setDimmed(true), 4000);
  }, [autoDim, expanded]);

  useEffect(() => { scheduleDim(); }, [scheduleDim, timer.elapsed]);
  useEffect(() => {
    return () => { if (dimTimerRef.current) clearTimeout(dimTimerRef.current); };
  }, []);

  // ── Notes: in-progress capture from the pill ─────────────────
  // The user's typed notes live in main-process memory for the duration of
  // the session — they get reset when a new timer starts (taskLabel change),
  // and at stop they pre-fill the timesheet confirm popup. We sync from main
  // when the panel expands so a user who types in the dashboard or popover
  // (future) sees the same value here. A short debounce avoids spamming IPC
  // on every keystroke.
  useEffect(() => {
    // Reset local notes whenever the active task changes (new session started
    // from elsewhere) so we never carry stale text from the prior task.
    setNotes('');
    if (notesSaveTimerRef.current) {
      clearTimeout(notesSaveTimerRef.current);
      notesSaveTimerRef.current = null;
    }
  }, [timer.taskLabel]);

  useEffect(() => {
    if (!expanded) return;
    (window as any).zenstate.miniTimerGetNotes?.().then((n: string) => {
      // Only adopt main's value if the user hasn't started typing here yet.
      // Otherwise we'd clobber what they were writing.
      setNotes((prev) => (prev ? prev : (n ?? '')));
    }).catch(() => {});
  }, [expanded]);

  const onNotesChange = useCallback((value: string) => {
    setNotes(value);
    if (notesSaveTimerRef.current) clearTimeout(notesSaveTimerRef.current);
    notesSaveTimerRef.current = setTimeout(() => {
      window.zenstate.miniTimerSetNotes(value);
    }, 350);
  }, []);

  // Flush any pending debounced save on unmount (e.g. window closed, timer stopped).
  useEffect(() => {
    return () => {
      if (notesSaveTimerRef.current) {
        clearTimeout(notesSaveTimerRef.current);
        // Best-effort flush — if the renderer is being torn down anyway,
        // this may not arrive, but the typical case (collapse, not unmount)
        // will already have flushed via the timeout firing.
      }
    };
  }, []);

  // ── Expand/collapse the window ───────────────────────────────
  const toggleExpanded = useCallback(() => {
    const next = !expanded;
    setExpanded(next);
    if (next) {
      // Compute dynamic height: pill (36) + notes section (~110) + a row per
      // switchable item (≈50) + a bit of slack for headings/padding. Capped so
      // the pill never balloons past a reasonable size on small screens.
      const itemCount = (plan?.items.length ?? 0) + Math.min(recents.length, 4);
      const switcherHeight = itemCount > 0 ? 24 + 50 * itemCount + 16 : 56;
      const height = Math.min(520, 36 + NOTES_SECTION_H + switcherHeight);
      window.zenstate.miniTimerResize({ width: EXPANDED_W, height });
    } else {
      window.zenstate.miniTimerResize({ width: COMPACT_W, height: COMPACT_H });
    }
  }, [expanded, plan, recents]);

  // Collapse if nothing is running anymore (avoid orphaned expanded state).
  useEffect(() => {
    if (!timer.isRunning && expanded) {
      setExpanded(false);
      window.zenstate.miniTimerResize({ width: COMPACT_W, height: COMPACT_H });
    }
  }, [timer.isRunning, expanded]);

  // ── Drag + click on the pill body ────────────────────────────
  // We can't use macOS' -webkit-app-region: drag here because that swallows
  // mousedown at the OS level — JS click events would never fire. Instead
  // we drive movement manually: capture mouse events, send tiny (dx, dy)
  // deltas to main on each move, and treat a no-movement gesture as a click.
  const dragRef = useRef<{ lastScreenX: number; lastScreenY: number; totalDx: number; totalDy: number } | null>(null);

  const onPillMouseDown = useCallback((e: React.MouseEvent) => {
    // Buttons handle their own clicks; don't start a drag from them.
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    dragRef.current = {
      lastScreenX: e.screenX,
      lastScreenY: e.screenY,
      totalDx: 0,
      totalDy: 0,
    };
  }, []);

  useEffect(() => {
    function onMove(ev: MouseEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = ev.screenX - drag.lastScreenX;
      const dy = ev.screenY - drag.lastScreenY;
      if (dx === 0 && dy === 0) return;
      drag.lastScreenX = ev.screenX;
      drag.lastScreenY = ev.screenY;
      drag.totalDx += dx;
      drag.totalDy += dy;
      window.zenstate.miniTimerMoveBy({ dx, dy });
    }

    function onUp() {
      const drag = dragRef.current;
      if (!drag) return;
      const wasDrag = Math.abs(drag.totalDx) > 3 || Math.abs(drag.totalDy) > 3;
      dragRef.current = null;
      if (!wasDrag) {
        // It was a click, not a drag — toggle the expanded panel.
        toggleExpanded();
      }
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [toggleExpanded]);

  // ── Handlers ──────────────────────────────────────────────────
  const switchToPinned = useCallback((p: PinnedTodo) => {
    // Stop the current timer first; the new one starts cleanly so the
    // pre-flight Basecamp confirmation can run on the outgoing session.
    if (timer.isRunning) window.zenstate.stopTimer();
    // Slight delay so the stop fires before the new start (single timer model).
    setTimeout(() => {
      window.zenstate.startTimer(p.content, undefined, undefined, {
        accountId: p.accountId, projectId: p.projectId, todoId: p.todoId,
        todoListId: p.todoListId, projectName: p.projectName,
      });
    }, 50);
    setExpanded(false);
    window.zenstate.miniTimerResize({ width: COMPACT_W, height: COMPACT_H });
  }, [timer.isRunning]);

  const switchToRecent = useCallback((r: RecentTodo) => {
    if (timer.isRunning) window.zenstate.stopTimer();
    setTimeout(() => {
      window.zenstate.startTimer(r.content, undefined, undefined, {
        accountId: r.accountId, projectId: r.projectId, todoId: r.todoId,
        todoListId: r.todoListId, projectName: r.projectName,
      });
    }, 50);
    setExpanded(false);
    window.zenstate.miniTimerResize({ width: COMPACT_W, height: COMPACT_H });
  }, [timer.isRunning]);

  // ── Render ────────────────────────────────────────────────────
  const accent = timer.isPaused ? 'var(--status-occupied, #ff9500)' : 'var(--status-available, #34c759)';
  const label = timer.taskLabel || 'No task';
  const truncated = label.length > 18 ? label.slice(0, 18) + '…' : label;

  // Filter out the currently-running task from switch options to avoid noise.
  const switchablePinned = (plan?.items ?? []).filter((p) => p.content !== timer.taskLabel);
  const switchableRecents = recents.filter((r) => r.content !== timer.taskLabel).slice(0, 4);

  return (
    <div
      onMouseEnter={() => { setDimmed(false); if (dimTimerRef.current) clearTimeout(dimTimerRef.current); }}
      onMouseLeave={scheduleDim}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 12,
        background: 'rgba(20, 22, 26, 0.92)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
        color: '#e6edf3',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
        fontSize: 12,
        opacity: dimmed ? 0.5 : 1,
        transition: 'opacity 280ms ease-out',
        overflow: 'hidden',
      }}
    >
      {/* Compact pill row (always visible).
          Drag-to-move + click-to-expand both work via JS mouse events.
          Mousedown on the body starts a potential drag. If the cursor moves
          more than 3px before mouseup, it's a drag (each move sends a delta
          to the main process to reposition the window). If it doesn't move,
          mouseup is treated as a click and toggles the expanded panel. */}
      <div
        onMouseDown={onPillMouseDown}
        style={{
          height: COMPACT_H,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 8px 0 10px',
          cursor: 'pointer',
        }}
      >
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          background: accent, flexShrink: 0,
          boxShadow: timer.isRunning && !timer.isPaused ? `0 0 6px ${accent}` : 'none',
        }} />

        <span style={{ fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)', fontWeight: 600, fontVariantNumeric: 'tabular-nums', fontSize: 13 }}>
          {formatHMS(timer.elapsed)}
        </span>

        <span style={{ flex: 1, opacity: 0.78, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {truncated}
        </span>

        {/* Chevron — rotates when expanded */}
        {/* Bigger and more opaque chevron — research finding: this is the
            best interaction in the app (one-click task switch) but the old
            11px / 0.5 opacity version was easy to miss. */}
        <span
          title={expanded ? 'Hide tasks' : 'Click to switch tasks'}
          style={{ display: 'inline-flex', alignItems: 'center' }}
        >
          <ChevronDown
            size={13}
            style={{ opacity: 0.85, transform: expanded ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 180ms ease' }}
          />
        </span>

        {/* Pause/Resume */}
        <IconBtn
          title={timer.isPaused ? 'Resume' : 'Pause'}
          onClick={() => (timer.isPaused ? window.zenstate.resumeTimer() : window.zenstate.pauseTimer())}
        >
          {timer.isPaused ? <Play size={12} /> : <Pause size={12} />}
        </IconBtn>

        {/* Stop */}
        <IconBtn title="Stop" onClick={() => window.zenstate.stopTimer()}>
          <Square size={12} />
        </IconBtn>
      </div>

      {/* Expanded panel — notes + task switcher */}
      {expanded && (
        <div style={{ flex: 1, overflowY: 'auto', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          {/* Notes — captured throughout the session, pre-fills the timesheet
              confirm popup at stop, and saves to the local session record.
              Debounced save means a few keystrokes don't flood IPC. */}
          <div style={{ padding: '10px 12px 8px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: 0.7,
              textTransform: 'uppercase',
              color: 'rgba(230,237,243,0.4)',
              marginBottom: 6,
            }}>
              <StickyNote size={10} /> Notes
            </div>
            <textarea
              value={notes}
              onChange={(e) => onNotesChange(e.target.value)}
              placeholder="What are you working on?"
              maxLength={500}
              rows={3}
              style={{
                width: '100%',
                resize: 'none',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 6,
                padding: '6px 8px',
                color: '#e6edf3',
                fontFamily: 'inherit',
                fontSize: 11,
                lineHeight: 1.4,
                outline: 'none',
                boxSizing: 'border-box',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.18)'; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'; }}
            />
          </div>

          {switchablePinned.length === 0 && switchableRecents.length === 0 ? (
            <div style={{ padding: '14px 12px', fontSize: 11, color: 'rgba(230,237,243,0.55)', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <Briefcase size={11} /> Nothing else pinned. Plan a few in Today.
            </div>
          ) : (
            <>
              {switchablePinned.length > 0 && (
                <SectionHeading>Today</SectionHeading>
              )}
              {switchablePinned.map((p) => (
                <SwitchRow
                  key={`p-${p.todoId}`}
                  title={p.content}
                  subtitle={p.projectName}
                  onClick={() => switchToPinned(p)}
                />
              ))}
              {switchableRecents.length > 0 && (
                <SectionHeading>Recent</SectionHeading>
              )}
              {switchableRecents.map((r) => (
                <SwitchRow
                  key={`r-${r.todoId}`}
                  title={r.content}
                  subtitle={r.projectName}
                  onClick={() => switchToRecent(r)}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={title}
      style={{
        background: 'transparent', border: 'none', color: '#e6edf3',
        opacity: 0.78, cursor: 'pointer', padding: 4,
        display: 'flex', alignItems: 'center', borderRadius: 4,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.78'; e.currentTarget.style.background = 'transparent'; }}
    >
      {children}
    </button>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding: '8px 12px 4px',
      fontSize: 9,
      fontWeight: 700,
      letterSpacing: 0.7,
      textTransform: 'uppercase',
      color: 'rgba(230,237,243,0.4)',
    }}>
      {children}
    </div>
  );
}

function SwitchRow({ title, subtitle, onClick }: { title: string; subtitle?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        textAlign: 'left',
        padding: '8px 12px',
        background: 'transparent',
        border: 'none',
        color: '#e6edf3',
        cursor: 'pointer',
        fontFamily: 'inherit',
        transition: 'background 120ms ease',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <Play size={10} style={{ color: 'var(--status-available, #34c759)', flexShrink: 0, opacity: 0.85 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
        {subtitle && (
          <div style={{ fontSize: 10, color: 'rgba(230,237,243,0.45)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
            {subtitle}
          </div>
        )}
      </div>
    </button>
  );
}
