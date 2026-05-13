import React, { useState } from 'react';

interface Props {
  type: 'meetingRequest' | 'emergencyRequest' | 'meetingResponse' | 'timerComplete' | 'breakReminder' | 'longRunGuard' | 'timesheetConfirm' | 'idlePrompt';
  from: string;
  senderId: string;
  message?: string;
  accepted?: boolean;
  targetDuration?: number;
  elapsedSeconds?: number;
  lastActivityAt?: string; // ISO timestamp from main process
  onRespond: (accepted: boolean, message?: string) => void;
  onDismiss: () => void;
  onLongRunResponse?: (action: 'continue' | 'stop' | 'backdate', stopAtIso?: string) => void;
  onIdleResponse?: (action: 'continue' | 'pause' | 'backdate', stopAtIso?: string, enableMeetingMode?: boolean) => void;
  onTimesheetConfirm?: (action: 'post' | 'discard', hours?: string, notes?: string) => void;
}

const QUICK_REPLIES = ['Give me 5 mins', 'Free after lunch', "Let's do tomorrow"];

function formatAlertDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

export default function AlertView({ type, from, senderId, message, accepted, targetDuration, elapsedSeconds, lastActivityAt, onRespond, onDismiss, onLongRunResponse, onIdleResponse, onTimesheetConfirm }: Props) {
  const [replyText, setReplyText] = useState('');
  const [selectedQuickReply, setSelectedQuickReply] = useState<string | null>(null);
  const isEmergency = type === 'emergencyRequest';

  function handleAccept() {
    const msg = selectedQuickReply || replyText || undefined;
    onRespond(true, msg);
  }

  function handleDecline() {
    const msg = selectedQuickReply || replyText || undefined;
    onRespond(false, msg);
  }

  function handleQuickReply(reply: string) {
    if (selectedQuickReply === reply) {
      setSelectedQuickReply(null);
      setReplyText('');
    } else {
      setSelectedQuickReply(reply);
      setReplyText(reply);
    }
  }

  // Break reminder view
  if (type === 'breakReminder') {
    return (
      <div className="alert-panel fade-in" style={{ width: 320 }}>
        <div style={{ textAlign: 'center', fontSize: 36, marginBottom: 12 }}>☕</div>
        <div className="alert-title" style={{ textAlign: 'center', color: 'var(--status-occupied)' }}>
          Take a Break!
        </div>
        <div style={{
          textAlign: 'center',
          fontSize: 13,
          color: 'var(--zen-secondary-text)',
          marginBottom: 20,
          lineHeight: 1.5,
        }}>
          {message || 'You\'ve been focused for a while. Take a short break to recharge!'}
        </div>
        <button
          className="btn btn-primary"
          style={{ width: '100%' }}
          onClick={onDismiss}
        >
          OK
        </button>
      </div>
    );
  }

  // Long-run guard view — fires when a single timer session crosses the threshold (3h).
  // Three options: keep going, stop now, or back-date the stop to last keyboard activity.
  if (type === 'longRunGuard') {
    const lastActivityLabel = lastActivityAt ? new Date(lastActivityAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null;
    const showBackdate = !!(lastActivityAt && elapsedSeconds && (Date.now() - new Date(lastActivityAt).getTime()) > 60_000);
    return (
      <div className="alert-panel fade-in" style={{ width: 360 }}>
        <div style={{ textAlign: 'center', fontSize: 32, marginBottom: 8 }}>⏱</div>
        <div className="alert-title" style={{ textAlign: 'center', color: 'var(--zen-primary)' }}>
          Still working?
        </div>
        <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--zen-secondary-text)', marginBottom: 4 }}>
          <strong>{from}</strong>
        </div>
        <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--zen-tertiary-text)', marginBottom: 16 }}>
          You've been tracking for {formatAlertDuration(elapsedSeconds || 0)}.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            className="btn btn-primary"
            style={{ width: '100%' }}
            onClick={() => { onLongRunResponse?.('continue'); onDismiss(); }}
          >
            Yes, keep going
          </button>
          {showBackdate && lastActivityAt && (
            <button
              className="btn btn-secondary"
              style={{ width: '100%' }}
              onClick={() => { onLongRunResponse?.('backdate', lastActivityAt); onDismiss(); }}
              title="Stops the timer and back-dates the end to your last keyboard or mouse activity, so the log reflects when you actually walked away."
            >
              Walked away at {lastActivityLabel} — stop there
            </button>
          )}
          <button
            className="btn btn-secondary"
            style={{ width: '100%' }}
            onClick={() => { onLongRunResponse?.('stop'); onDismiss(); }}
          >
            Stop now
          </button>
        </div>
      </div>
    );
  }

  // Idle prompt — appears after the user has been idle for the configured
  // threshold. Replaces the silent auto-pause. Same shape as the long-run
  // guard but with a "I'm in a meeting" option that enables Meeting mode
  // for this session so the prompt doesn't fire again.
  if (type === 'idlePrompt') {
    const lastActivityLabel = lastActivityAt ? new Date(lastActivityAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null;
    const showBackdate = !!(lastActivityAt && elapsedSeconds && (Date.now() - new Date(lastActivityAt).getTime()) > 60_000);
    const idleMins = Math.round((elapsedSeconds || 0) / 60);
    return (
      <div className="alert-panel fade-in" style={{ width: 380 }}>
        <div style={{ textAlign: 'center', fontSize: 32, marginBottom: 8 }}>💤</div>
        <div className="alert-title" style={{ textAlign: 'center', color: 'var(--zen-primary)' }}>
          Still working?
        </div>
        <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--zen-secondary-text)', marginBottom: 4 }}>
          <strong>{from}</strong>
        </div>
        <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--zen-tertiary-text)', marginBottom: 16 }}>
          No keyboard or mouse activity for {idleMins} {idleMins === 1 ? 'minute' : 'minutes'}.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            className="btn btn-primary"
            style={{ width: '100%' }}
            onClick={() => { onIdleResponse?.('continue', undefined, true); onDismiss(); }}
            title="Keep the timer running and silence idle prompts for the rest of this session"
          >
            I'm in a meeting — keep running
          </button>
          <button
            className="btn btn-secondary"
            style={{ width: '100%' }}
            onClick={() => { onIdleResponse?.('continue'); onDismiss(); }}
          >
            Still working — keep running
          </button>
          {showBackdate && lastActivityAt && (
            <button
              className="btn btn-secondary"
              style={{ width: '100%' }}
              onClick={() => { onIdleResponse?.('backdate', lastActivityAt); onDismiss(); }}
              title="Stop the timer and back-date the end to your last keyboard or mouse activity."
            >
              Walked away at {lastActivityLabel} — stop there
            </button>
          )}
          <button
            className="btn btn-secondary"
            style={{ width: '100%' }}
            onClick={() => { onIdleResponse?.('pause'); onDismiss(); }}
          >
            Pause now
          </button>
        </div>
      </div>
    );
  }

  // Timesheet pre-flight confirmation. Shown when a Basecamp-linked timer stops
  // and the user has the "review before posting" setting on (default).
  if (type === 'timesheetConfirm') {
    const seconds = elapsedSeconds || 0;
    // Default to the actual elapsed time (rounded to the nearest minute, expressed
    // as decimal hours). The user can edit this value if they want to round up
    // or down — but the pre-filled value matches what the timer pill showed,
    // so there's no surprise mismatch.
    const minutes = Math.round(seconds / 60);
    const exactHours = (minutes / 60).toFixed(2);
    return <TimesheetConfirmPanel
      taskLabel={from}
      seconds={seconds}
      defaultHours={exactHours}
      defaultNotes={message ?? ''}
      onConfirm={(hours, notes) => { onTimesheetConfirm?.('post', hours, notes); onDismiss(); }}
      onDiscard={() => { onTimesheetConfirm?.('discard'); onDismiss(); }}
    />;
  }

  // Timer complete view
  if (type === 'timerComplete') {
    return (
      <div className="alert-panel fade-in" style={{ width: 320 }}>
        <div style={{ textAlign: 'center', fontSize: 36, marginBottom: 12 }}>⏰</div>
        <div className="alert-title" style={{ textAlign: 'center', color: 'var(--zen-primary)' }}>
          Time's Up!
        </div>
        <div style={{
          textAlign: 'center',
          fontSize: 13,
          color: 'var(--zen-secondary-text)',
          marginBottom: 8,
        }}>
          <strong>{from}</strong>
        </div>
        {targetDuration && (
          <div style={{
            textAlign: 'center',
            fontSize: 12,
            color: 'var(--zen-tertiary-text)',
            marginBottom: message ? 12 : 20,
          }}>
            {formatAlertDuration(targetDuration)} completed
          </div>
        )}
        {message && (
          <div style={{
            padding: '10px 12px',
            background: 'rgba(255, 149, 0, 0.1)',
            borderRadius: 8,
            fontSize: 12,
            color: 'var(--status-occupied)',
            textAlign: 'center',
            marginBottom: 20,
          }}>
            {message}
          </div>
        )}
        <button
          className="btn btn-primary"
          style={{ width: '100%' }}
          onClick={onDismiss}
        >
          OK
        </button>
      </div>
    );
  }

  // Meeting response view — shown when someone accepts/declines your request
  if (type === 'meetingResponse') {
    return (
      <div className="alert-panel fade-in" style={{ width: 320 }}>
        <div style={{ textAlign: 'center', fontSize: 36, marginBottom: 12 }}>
          {accepted ? '✅' : '❌'}
        </div>
        <div className="alert-title" style={{
          textAlign: 'center',
          color: accepted ? 'var(--status-available)' : 'var(--status-focused)',
        }}>
          {accepted ? 'Meeting Accepted' : 'Meeting Declined'}
        </div>
        <div style={{
          textAlign: 'center',
          fontSize: 13,
          color: 'var(--zen-secondary-text)',
          marginBottom: message ? 16 : 20,
        }}>
          <strong>{from}</strong> {accepted ? 'accepted' : 'declined'} your meeting request
        </div>
        {message && (
          <div style={{
            padding: '10px 12px',
            background: 'var(--zen-tertiary-bg)',
            borderRadius: 8,
            fontSize: 12,
            color: 'var(--zen-secondary-text)',
            fontStyle: 'italic',
            marginBottom: 20,
            maxHeight: 60,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            "{message}"
          </div>
        )}
        <button
          className="btn btn-primary"
          style={{ width: '100%' }}
          onClick={onDismiss}
        >
          OK
        </button>
      </div>
    );
  }

  return (
    <div className="alert-panel fade-in" style={{ width: 320 }}>
      {/* Icon */}
      <div style={{
        textAlign: 'center',
        fontSize: 36,
        marginBottom: 12,
      }}>
        {isEmergency ? '🚨' : '👋'}
      </div>

      {/* Title */}
      <div className="alert-title" style={{
        textAlign: 'center',
        color: isEmergency ? 'var(--status-focused)' : 'var(--zen-text)',
      }}>
        {isEmergency ? 'Emergency Meeting Request' : 'Meeting Request'}
      </div>

      {/* Subtitle */}
      <div style={{
        textAlign: 'center',
        fontSize: 13,
        color: 'var(--zen-secondary-text)',
        marginBottom: 16,
      }}>
        <strong>{from}</strong> wants to talk with you
      </div>

      {/* Message */}
      {message && (
        <div style={{
          padding: '10px 12px',
          background: 'var(--zen-tertiary-bg)',
          borderRadius: 8,
          fontSize: 12,
          color: 'var(--zen-secondary-text)',
          fontStyle: 'italic',
          marginBottom: 16,
          maxHeight: 60,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          "{message}"
        </div>
      )}

      {/* Quick Reply Chips */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {QUICK_REPLIES.map((reply) => (
          <button
            key={reply}
            className={`category-chip ${selectedQuickReply === reply ? 'selected' : ''}`}
            onClick={() => handleQuickReply(reply)}
          >
            {reply}
          </button>
        ))}
      </div>

      {/* Custom Reply */}
      <input
        className="text-input"
        placeholder="Add a reply (optional)..."
        value={replyText}
        onChange={(e) => {
          setReplyText(e.target.value);
          setSelectedQuickReply(null);
        }}
        style={{ marginBottom: 16 }}
      />

      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          className="btn btn-secondary"
          style={{ flex: 1 }}
          onClick={handleDecline}
        >
          Decline
        </button>
        <button
          className={isEmergency ? 'btn btn-danger' : 'btn btn-primary'}
          style={{ flex: 1 }}
          onClick={handleAccept}
        >
          Accept
        </button>
      </div>
    </div>
  );
}

// Pre-flight timesheet confirmation. The user reviews the duration (rounded to
// the nearest 15 min by default), can edit it as a decimal-hours value, and
// chooses Post or Discard. Nothing reaches Basecamp until they click Post.
function TimesheetConfirmPanel({ taskLabel, seconds, defaultHours, defaultNotes, onConfirm, onDiscard }: {
  taskLabel: string;
  seconds: number;
  defaultHours: string;
  defaultNotes: string;
  onConfirm: (hours: string, notes: string) => void;
  onDiscard: () => void;
}) {
  // Display the tracked time in the same h/m format used everywhere else in
  // the app, and let the user edit IN that format. Basecamp wants a decimal
  // hours value — derive it from h/m and show it read-only so users can see
  // exactly what's about to be posted without having to do the conversion.
  const totalMinutes = Math.round(seconds / 60);
  const initialH = Math.floor(totalMinutes / 60);
  const initialM = totalMinutes % 60;
  const [editH, setEditH] = useState(initialH);
  const [editM, setEditM] = useState(initialM);
  const [notes, setNotes] = useState(defaultNotes);

  // Convert the user's h+m back to the decimal hours Basecamp expects.
  // Two decimal places matches the precision of the original `defaultHours`
  // input and Basecamp's UI display.
  const totalSeconds = editH * 3600 + editM * 60;
  const decimalHours = (totalSeconds / 3600).toFixed(2);
  const isValid = totalSeconds > 0;
  // Keep defaultHours in scope so a TS warning about an unused prop doesn't
  // fire — the value lives in initialH/initialM via the seconds path now.
  void defaultHours;

  return (
    <div className="alert-panel fade-in" style={{ width: 380 }}>
      <div style={{ textAlign: 'center', fontSize: 32, marginBottom: 8 }}>📋</div>
      <div className="alert-title" style={{ textAlign: 'center', color: 'var(--zen-primary)' }}>
        Post to Basecamp?
      </div>
      <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--zen-secondary-text)', marginBottom: 14 }}>
        <strong>{taskLabel}</strong>
      </div>

      {/* Editable h/m fields — match the format users see everywhere else
          in the app. Decimal hours below auto-derive from these. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="number"
            min="0"
            max="16"
            value={editH}
            onChange={(e) => setEditH(parseInt(e.target.value, 10) || 0)}
            onBlur={(e) => setEditH(Math.min(16, Math.max(0, parseInt(e.target.value, 10) || 0)))}
            style={{
              width: 56,
              padding: '6px 8px',
              border: '1px solid var(--zen-divider)',
              borderRadius: 6,
              background: 'var(--zen-tertiary-bg)',
              color: 'var(--zen-text)',
              fontSize: 14,
              fontFamily: 'var(--font-mono)',
              textAlign: 'center',
            }}
            autoFocus
          />
          <span style={{ fontSize: 12, color: 'var(--zen-secondary-text)' }}>h</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="number"
            min="0"
            max="59"
            value={editM}
            onChange={(e) => setEditM(parseInt(e.target.value, 10) || 0)}
            onBlur={(e) => setEditM(Math.min(59, Math.max(0, parseInt(e.target.value, 10) || 0)))}
            style={{
              width: 56,
              padding: '6px 8px',
              border: '1px solid var(--zen-divider)',
              borderRadius: 6,
              background: 'var(--zen-tertiary-bg)',
              color: 'var(--zen-text)',
              fontSize: 14,
              fontFamily: 'var(--font-mono)',
              textAlign: 'center',
            }}
          />
          <span style={{ fontSize: 12, color: 'var(--zen-secondary-text)' }}>m</span>
        </div>
      </div>

      {/* Read-only decimal preview — what Basecamp's timesheet will actually
          store. Updates as you edit the h/m fields above. */}
      <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--zen-tertiary-text)', marginBottom: 14 }}>
        Posts to Basecamp as <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--zen-secondary-text)' }}>{decimalHours} hr</strong>
      </div>

      {/* Notes — becomes the timesheet entry's description on Basecamp.
          Optional; empty = no description. Cmd/Ctrl+Enter posts. */}
      <textarea
        rows={3}
        placeholder="What did you work on? (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        style={{
          width: '100%',
          padding: '8px 10px',
          border: '1px solid var(--zen-divider)',
          borderRadius: 6,
          background: 'var(--zen-tertiary-bg)',
          color: 'var(--zen-text)',
          fontSize: 12,
          fontFamily: 'inherit',
          lineHeight: 1.4,
          resize: 'vertical',
          marginBottom: 8,
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && isValid) {
            onConfirm(decimalHours, notes.trim());
          }
        }}
      />

      <div style={{ fontSize: 10, color: 'var(--zen-tertiary-text)', textAlign: 'center', marginBottom: 14, lineHeight: 1.5 }}>
        Notes appear next to your hours on Basecamp's timesheet. Cmd/Ctrl+Enter to post.
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          className="btn btn-secondary"
          style={{ flex: 1 }}
          onClick={onDiscard}
        >
          Discard
        </button>
        <button
          className="btn btn-primary"
          style={{ flex: 2 }}
          onClick={() => onConfirm(decimalHours, notes.trim())}
          disabled={!isValid}
        >
          Post {isValid ? `${decimalHours} hr` : ''}
        </button>
      </div>
    </div>
  );
}
