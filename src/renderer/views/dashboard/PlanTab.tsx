import React, { useState } from 'react';
import { DailyRecord } from '../../../shared/types';
import TodayTab from './TodayTab';
import TomorrowTab from './TomorrowTab';

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

type Sub = 'today' | 'tomorrow';

// PlanTab — wraps the two day-views with a segmented sub-tab strip.
// Today is the in-the-moment surface (timer, sessions, progress vs. estimate).
// Tomorrow is the queueing surface — items get promoted at midnight.
export default function PlanTab({ timerState, records, onOpenSettings }: Props) {
  const [sub, setSub] = useState<Sub>('today');

  return (
    <>
      {/* Sub-tab strip lives in the same max-width column as the inner tab
          content so it visually anchors above each day's view. */}
      <div style={{ maxWidth: 720, margin: '0 auto', paddingTop: 'var(--space-3)' }}>
        <div style={{
          display: 'inline-flex',
          background: 'var(--zen-tertiary-bg)',
          border: '1px solid var(--zen-divider)',
          borderRadius: 'var(--radius-pill)',
          padding: 3,
          gap: 2,
        }}>
          <SubTabButton active={sub === 'today'} onClick={() => setSub('today')}>Today</SubTabButton>
          <SubTabButton active={sub === 'tomorrow'} onClick={() => setSub('tomorrow')}>Tomorrow</SubTabButton>
        </div>
      </div>

      {sub === 'today' && (
        <TodayTab timerState={timerState} records={records} onOpenSettings={onOpenSettings} />
      )}
      {sub === 'tomorrow' && (
        <TomorrowTab onOpenSettings={onOpenSettings} />
      )}
    </>
  );
}

function SubTabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 16px',
        fontSize: 'var(--text-sm)',
        fontWeight: 500,
        background: active ? 'var(--zen-primary)' : 'transparent',
        color: active ? 'white' : 'var(--zen-secondary-text)',
        border: 'none',
        borderRadius: 'var(--radius-pill)',
        cursor: 'pointer',
        fontFamily: 'inherit',
        transition: 'background var(--duration-quick) var(--ease-standard), color var(--duration-quick) var(--ease-standard)',
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = 'var(--zen-text)'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = 'var(--zen-secondary-text)'; }}
    >
      {children}
    </button>
  );
}
