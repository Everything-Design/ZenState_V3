import React, { useState } from 'react';

interface Props {
  type: 'meetingRequest' | 'emergencyRequest' | 'meetingResponse';
  from: string;
  senderId: string;
  message?: string;
  accepted?: boolean;
  onRespond: (accepted: boolean, message?: string) => void;
  onDismiss: () => void;
}

const QUICK_REPLIES = ['Give me 5 mins', 'Free after lunch', "Let's do tomorrow"];

export default function AlertView({ type, from, senderId, message, accepted, onRespond, onDismiss }: Props) {
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
