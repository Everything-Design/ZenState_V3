// Shared types between main process and renderer — mirrors Swift models

export enum AvailabilityStatus {
  Available = 'available',
  Occupied = 'occupied',
  Focused = 'focused',
  Offline = 'offline',
}

export interface User {
  id: string; // UUID
  name: string;
  username: string;
  status: AvailabilityStatus;
  lastSeen: string; // ISO date
  activeStatusMessage?: string;
  statusMessageExpiry?: string; // ISO date
  customMeetingMessage?: string;
  totalFocusTime: number;
  focusSessionCount: number;
  avatarEmoji?: string;
  avatarColor?: string;
  avatarImageData?: string; // base64
  isAdmin: boolean;
  canSendEmergency: boolean;
  currentFocusSession?: FocusSession;
}

export interface FocusSession {
  id: string;
  taskLabel: string;
  startTime: string; // ISO date
  endTime?: string;
  duration: number;
  category?: string;
}

export enum MessageType {
  StatusUpdate = 'statusUpdate',
  MeetingRequest = 'meetingRequest',
  MeetingRequestCancel = 'meetingRequestCancel',
  MeetingRequestAccepted = 'meetingRequestAccepted',
  MeetingRequestDeclined = 'meetingRequestDeclined',
  Heartbeat = 'heartbeat',
  UserInfo = 'userInfo',
  EmergencyMeetingRequest = 'emergencyMeetingRequest',
  EmergencyAccessGrant = 'emergencyAccessGrant',
}

export interface PeerMessage {
  type: MessageType;
  senderId: string; // UUID
  senderName: string;
  payload?: string; // Base64-encoded JSON User data (for wire compat with Swift)
  timestamp: string; // ISO date
  requestMessage?: string;
}

export interface DailySession {
  id: string;
  taskLabel: string;
  startTime: string;
  endTime?: string;
  duration: number;
  category?: string;
  notes?: string;
}

export interface DailyRecord {
  id: string;
  date: string;
  totalFocusTime: number;
  sessions: DailySession[];
}

export interface FocusSchedule {
  id: string;
  name: string;
  enabled: boolean;
  autoStartFocus: boolean;
  startTime: { hour: number; minute: number };
  endTime: { hour: number; minute: number };
  daysOfWeek: number[]; // 0=Sun, 6=Sat
  taskLabel?: string;
}

export interface FocusTemplate {
  id: string;
  name: string;
  icon: string;
  defaultDuration: number;
  color: string;
}

// IPC channel names for main ↔ renderer communication
export const IPC = {
  // Networking events (main → renderer)
  PEER_DISCOVERED: 'peer:discovered',
  PEER_UPDATED: 'peer:updated',
  PEER_LOST: 'peer:lost',
  MEETING_REQUEST: 'meeting:request',
  MEETING_REQUEST_CANCEL: 'meeting:request-cancel',
  MEETING_RESPONSE: 'meeting:response',
  EMERGENCY_REQUEST: 'emergency:request',
  EMERGENCY_ACCESS: 'emergency:access',

  // User actions (renderer → main)
  UPDATE_STATUS: 'user:update-status',
  UPDATE_USER: 'user:update',
  SEND_MEETING_REQUEST: 'user:send-meeting-request',
  CANCEL_MEETING_REQUEST: 'user:cancel-meeting-request',
  RESPOND_MEETING_REQUEST: 'user:respond-meeting-request',
  SEND_EMERGENCY_REQUEST: 'user:send-emergency-request',
  GRANT_EMERGENCY_ACCESS: 'user:grant-emergency-access',

  // Window management (renderer → main)
  OPEN_DASHBOARD: 'window:open-dashboard',
  CLOSE_POPOVER: 'window:close-popover',
  QUIT_APP: 'app:quit',

  // Timer (renderer → main, bidirectional)
  START_TIMER: 'timer:start',
  STOP_TIMER: 'timer:stop',
  PAUSE_TIMER: 'timer:pause',
  RESUME_TIMER: 'timer:resume',
  TIMER_UPDATE: 'timer:update',
  TIMER_COMPLETE: 'timer:complete',

  // Data (renderer → main)
  GET_USER: 'data:get-user',
  GET_PEERS: 'data:get-peers',
  GET_RECORDS: 'data:get-records',
  SAVE_USER: 'data:save-user',
  DELETE_SESSION: 'data:delete-session',
  UPDATE_SESSION: 'data:update-session',
  EXPORT_CSV: 'data:export-csv',

  // Tray updates (renderer → main)
  UPDATE_TRAY: 'tray:update',
} as const;
