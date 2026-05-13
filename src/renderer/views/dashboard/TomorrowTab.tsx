import React, { useEffect, useState, useCallback } from 'react';
import { Plus, Briefcase, Clock, X, Sunrise } from 'lucide-react';
import {
  IPC, TodayPlan, PinnedTodo, RecentTodo,
  BasecampAuthState,
} from '../../../shared/types';
import { PinPicker } from './TodayTab';

interface Props {
  onOpenSettings: () => void;
}

function tomorrowDateStr(): string {
  const t = new Date();
  t.setDate(t.getDate() + 1);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

function tomorrowHeader(): string {
  const t = new Date();
  t.setDate(t.getDate() + 1);
  return t.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

export default function TomorrowTab({ onOpenSettings }: Props) {
  const [plan, setPlan] = useState<TodayPlan>({ date: tomorrowDateStr(), items: [] });
  const [recents, setRecents] = useState<RecentTodo[]>([]);
  const [authState, setAuthState] = useState<BasecampAuthState | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editingEstimate, setEditingEstimate] = useState<number | null>(null);

  useEffect(() => {
    let eventArrived = false;
    const offChanged = window.zenstate.on(IPC.TOMORROW_CHANGED, (...args: unknown[]) => {
      eventArrived = true;
      setPlan(args[0] as TodayPlan);
    });
    // Re-fetch when the window/tab becomes visible. Covers two real cases:
    // (1) midnight rollover happened while the dashboard was unfocused — the
    //     plan we're showing is now yesterday's "tomorrow" (which was
    //     promoted into today). After re-fetch we'll show an empty Tomorrow.
    // (2) any tomorrow:changed broadcast missed during a state we couldn't
    //     subscribe to (e.g. cross-window race on first mount).
    const onFocus = () => {
      window.zenstate.tomorrowGet().then(setPlan).catch(() => {});
    };
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);

    window.zenstate.tomorrowGet().then((res) => {
      if (!eventArrived) setPlan(res);
    }).catch(() => {});
    window.zenstate.recentsGet().then(setRecents).catch(() => {});
    window.zenstate.bcGetAuthState().then(setAuthState).catch(() => {});
    return () => {
      offChanged();
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const handlePin = useCallback(async (item: PinnedTodo) => {
    const next = await window.zenstate.tomorrowPin(item).catch(() => null);
    if (next) setPlan(next);
    setPickerOpen(false);
  }, []);

  const handleUnpin = useCallback(async (todoId: number) => {
    const next = await window.zenstate.tomorrowUnpin(todoId).catch(() => null);
    if (next) setPlan(next);
  }, []);

  const handleSetEstimate = useCallback(async (todoId: number, minutes: number | null) => {
    const next = await window.zenstate.tomorrowSetEstimate(todoId, minutes).catch(() => null);
    if (next) setPlan(next);
    setEditingEstimate(null);
  }, []);

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', maxWidth: 720, margin: '0 auto', paddingTop: 'var(--space-3)' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, letterSpacing: '-0.02em', margin: 0, color: 'var(--zen-text)' }}>
          {tomorrowHeader()}
        </h1>
        <p style={{ fontSize: 'var(--text-md)', color: 'var(--zen-secondary-text)', margin: '6px 0 0', fontWeight: 400 }}>
          {plan.items.length === 0
            ? 'Queue what you want to focus on tomorrow.'
            : `${plan.items.length} ${plan.items.length === 1 ? 'thing' : 'things'} queued for tomorrow.`}
        </p>
      </div>

      <section>
        {!authState?.isConnected ? (
          <EmptyState
            icon={<Briefcase size={20} />}
            title="Connect Basecamp"
            body="Tomorrow's plan pulls from your Basecamp to-dos. Connect once and you can queue a few each evening."
            action={<button className="btn btn-primary" onClick={onOpenSettings}>Open Settings</button>}
          />
        ) : plan.items.length === 0 ? (
          <EmptyState
            icon={<Sunrise size={20} />}
            title="Plan tomorrow tonight"
            body="Decide a few things you want to start tomorrow morning. They'll be waiting on the Today tab when you open the app."
            action={<button className="btn btn-primary" onClick={() => setPickerOpen(true)}>Pin a to-do</button>}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {plan.items.map((item) => (
              <TomorrowRow
                key={item.todoId}
                item={item}
                editingEstimate={editingEstimate === item.todoId}
                onStartEditEstimate={() => setEditingEstimate(item.todoId)}
                onSaveEstimate={(min) => handleSetEstimate(item.todoId, min)}
                onCancelEditEstimate={() => setEditingEstimate(null)}
                onUnpin={() => handleUnpin(item.todoId)}
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

      <div style={{
        display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start',
        padding: 'var(--space-3) var(--space-4)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--zen-tertiary-bg)',
        border: '1px solid var(--zen-divider)',
        fontSize: 'var(--text-xs)',
        color: 'var(--zen-secondary-text)',
        lineHeight: 'var(--leading-relaxed)',
      }}>
        <Sunrise size={14} style={{ flexShrink: 0, marginTop: 1, opacity: 0.7 }} />
        <span>At midnight, these items move to Today's plan. Anything you didn't finish today carries over with them.</span>
      </div>

      {pickerOpen && authState?.isConnected && (
        <PinPicker
          authState={authState}
          recents={recents}
          alreadyPinned={new Set(plan.items.map((i) => i.todoId))}
          onPin={handlePin}
          onClose={() => setPickerOpen(false)}
          title="Pin to tomorrow"
        />
      )}
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

interface TomorrowRowProps {
  item: PinnedTodo;
  editingEstimate: boolean;
  onStartEditEstimate: () => void;
  onSaveEstimate: (minutes: number | null) => void;
  onCancelEditEstimate: () => void;
  onUnpin: () => void;
}

function TomorrowRow({ item, editingEstimate, onStartEditEstimate, onSaveEstimate, onCancelEditEstimate, onUnpin }: TomorrowRowProps) {
  // Hours + minutes inputs (stored as one minutes integer). Matches the
  // pattern used everywhere else in the app — typing a 2h+ estimate without
  // doing 60-times math in your head.
  const initialH = Math.floor((item.estimateMinutes ?? 0) / 60);
  const initialM = (item.estimateMinutes ?? 0) % 60;
  const [estH, setEstH] = useState(initialH);
  const [estM, setEstM] = useState(initialM);
  const [hovered, setHovered] = useState(false);

  function formatEstimate(mins: number): string {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
  }
  function commit() {
    const total = estH * 60 + estM;
    onSaveEstimate(total > 0 ? total : null);
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
        padding: '12px var(--space-4)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--zen-secondary-bg)',
        border: '1px solid var(--zen-divider)',
        transition: 'background var(--duration-quick) var(--ease-standard)',
      }}
    >
      <div style={{
        width: 8, height: 8, borderRadius: '50%',
        background: 'var(--zen-tertiary-text)', opacity: 0.4, flexShrink: 0,
      }} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--text-md)', fontWeight: 500, color: 'var(--zen-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.content}
        </div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--zen-tertiary-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
          {item.projectName || `Project #${item.projectId}`}
        </div>
      </div>

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
              if (e.key === 'Enter') commit();
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
              if (e.key === 'Enter') commit();
              else if (e.key === 'Escape') onCancelEditEstimate();
            }}
            onBlur={commit}
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
            color: 'var(--zen-secondary-text)',
            background: 'transparent', border: 'none', cursor: 'pointer',
            padding: '4px 8px', borderRadius: 6,
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--zen-hover)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
        >
          <Clock size={11} />
          {item.estimateMinutes ? formatEstimate(item.estimateMinutes) : 'Set estimate'}
        </button>
      )}

      <button
        onClick={onUnpin}
        title="Remove from tomorrow"
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
  );
}
