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
  QuickPing = 'quickPing', // lightweight team-wide notification (anyone can send)
}

// A reusable list of peers a user can ping with one tap. Stored per-machine.
export interface PeerGroup {
  id: string;          // uuid
  name: string;        // "Design Team", "Standup", etc.
  memberIds: string[]; // ZenState peer userIds
}

// A ping the user has received (kept in memory + persisted briefly so users
// who missed the toast can still see "what happened in the last hour").
export interface ReceivedPing {
  id: string;          // uuid generated on receive
  senderId: string;
  senderName: string;
  message: string;
  timestamp: string;   // ISO
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
  basecamp?: {
    accountId: number;
    projectId: number;
    todoId: number;
    todoListId?: number;
    synced?: boolean; // true once pushed to Basecamp's timesheet
  };
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

export interface AppSettings {
  breakReminderEnabled: boolean;
  breakReminderIntervalSeconds: number;
  idleDetectionEnabled: boolean;
  idleThresholdSeconds: number;
  // When true, a Basecamp timesheet entry isn't posted automatically when a
  // timer stops — the user reviews the duration first in a confirmation alert.
  requireTimesheetConfirmation: boolean;
  // When true, a small floating pill window appears on top of all other apps
  // (including full-screen apps) while a timer is running.
  miniTimerEnabled: boolean;
  miniTimerX?: number;
  miniTimerY?: number;
  // When true, the floating pill fades to ~50% opacity after a few seconds
  // of no hover, so it stays out of the way without going invisible.
  miniTimerAutoDim: boolean;
}

// ── Basecamp Types ─────────────────────────────────────────────

export interface BasecampCredentials {
  clientId: string;
  clientSecret: string;
}

export interface BasecampAccount {
  id: number;
  name: string;
  href: string; // e.g. "https://3.basecampapp.com/1234567"
  product: string; // "bc3"
}

export interface BasecampAuthState {
  isConnected: boolean;
  account?: { id: number; name: string };
  identity?: { id: number; firstName: string; lastName: string; emailAddress: string };
  expiresAt?: string;
  error?: string;
}

export interface BasecampProject {
  id: number;
  name: string;
  description?: string;
  todoSetId?: number; // dock entry id for "todoset"
  timesheetEnabled?: boolean;
}

// A Basecamp todo the user has committed to focusing on today. Stored locally,
// resets at midnight (the planner is a daily ritual, not a permanent list).
export interface PinnedTodo {
  todoId: number;
  projectId: number;
  todoListId: number;
  accountId: number;
  content: string;        // todo title cached at pin time
  projectName: string;    // project name cached at pin time
  estimateMinutes?: number; // optional Newport-style "deep schedule" estimate
  // Local "I finished this" flag, independent of Basecamp's own completed state.
  // Toggled from the Plan view; drives midnight rollover (completed items get
  // dropped, unfinished ones carry to the next day).
  completedAt?: string;   // ISO timestamp when the user marked it done
}

export interface TodayPlan {
  date: string;           // YYYY-MM-DD — used to auto-reset at the next day
  items: PinnedTodo[];
}

// Track recently-used Basecamp todos so the popover can offer one-tap restart
// without forcing the full Project → List → Todo drill-down every time.
export interface RecentTodo {
  todoId: number;
  projectId: number;
  todoListId: number;
  accountId: number;
  content: string;
  projectName: string;
  lastUsedAt: string;     // ISO timestamp — most-recent first
}

export interface BasecampTimesheetEntry {
  id: number;
  date: string;          // YYYY-MM-DD
  hours: string;         // decimal as string, e.g. "1.5"
  description?: string;
  parentId: number;      // recording id (todo or message)
  parentTitle?: string;
  parentType?: string;
  personId: number;
  personName: string;
  appUrl: string;
}

export interface BasecampTodoList {
  id: number;
  title: string;
  description?: string;
  todosUrl: string;
  groupsUrl?: string;
}

export interface BasecampTodo {
  id: number;
  content: string;
  description?: string;
  completed: boolean;
  assigneeIds: number[];
  dueOn?: string;
  parentId?: number;
  commentsCount: number;
  url: string;
  appUrl: string;
}

// ── License Types ──────────────────────────────────────────────

export interface LicensePayload {
  teamName: string;
  seats: number;
  expiresAt: string; // ISO date
  features: string[];
  issuedAt: string;  // ISO date
}

export interface LicenseState {
  isValid: boolean;
  isPro: boolean;
  isAdmin: boolean;
  payload: LicensePayload | null;
  error?: string;
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
  OPEN_DASHBOARD_AND_PIN: 'window:open-dashboard-and-pin',
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
  ADD_SESSION: 'data:add-session',

  // Settings & Templates (renderer → main)
  GET_SETTINGS: 'data:get-settings',
  SAVE_SETTINGS: 'data:save-settings',

  // Break/Idle/Revert notifications (main → renderer)
  BREAK_REMINDER: 'timer:break-reminder',
  TIMER_AUTO_PAUSED: 'timer:auto-paused',
  STATUS_REVERT_TICK: 'status:revert-tick',

  // Status revert (renderer → main)
  SET_STATUS_REVERT: 'status:set-revert',
  CANCEL_STATUS_REVERT: 'status:cancel-revert',

  // Long-run timer guard (renderer → main)
  TIMER_LONG_RUN_RESPONSE: 'timer:long-run-response',

  // Idle prompt: instead of silently auto-pausing after the idle threshold,
  // show a "still working?" alert that the user can confirm or let lapse.
  TIMER_IDLE_RESPONSE: 'timer:idle-response',

  // Meeting mode: per-session toggle that suppresses idle pause entirely
  // (for video calls where the user isn't touching keyboard/mouse).
  TIMER_SET_MEETING_MODE: 'timer:set-meeting-mode',
  TIMER_MEETING_MODE_CHANGED: 'timer:meeting-mode-changed',

  // Pre-flight Basecamp timesheet confirmation (renderer → main)
  TIMER_TIMESHEET_CONFIRM: 'timer:timesheet-confirm',
  // Mini-timer pill state changes (renderer → main)
  MINI_TIMER_RESIZE: 'mini-timer:resize',
  MINI_TIMER_MOVE_BY: 'mini-timer:move-by',
  // In-progress notes capture from the pill — flushed at stop time so users
  // can jot what they're working on without waiting for the confirm popup.
  MINI_TIMER_GET_NOTES: 'mini-timer:get-notes',
  MINI_TIMER_SET_NOTES: 'mini-timer:set-notes',

  // Quick ping (team-wide lightweight notification — distinct from admin notification)
  TEAM_SEND_PING: 'team:send-ping',          // renderer → main
  TEAM_PING_RECEIVED: 'team:ping-received',  // main → renderer
  TEAM_GET_RECENT_PINGS: 'team:get-recent-pings',
  TEAM_DISMISS_PING: 'team:dismiss-ping',

  // Peer groups (saved sets of people for one-tap multi-select)
  GROUPS_GET: 'groups:get',
  GROUPS_SAVE: 'groups:save',          // create or update — full PeerGroup payload
  GROUPS_DELETE: 'groups:delete',

  // Admin notifications (bidirectional)

  // Tray updates (renderer → main)
  UPDATE_TRAY: 'tray:update',

  // License (renderer → main)
  ACTIVATE_LICENSE: 'license:activate',
  GET_LICENSE_STATE: 'license:get-state',
  DEACTIVATE_LICENSE: 'license:deactivate',

  // Basecamp (renderer → main)
  BC_GET_CREDENTIALS: 'basecamp:get-credentials',
  BC_SAVE_CREDENTIALS: 'basecamp:save-credentials',
  BC_CONNECT: 'basecamp:connect',
  BC_CANCEL_CONNECT: 'basecamp:cancel-connect',
  BC_DISCONNECT: 'basecamp:disconnect',
  BC_GET_AUTH_STATE: 'basecamp:get-auth-state',
  BC_LIST_PROJECTS: 'basecamp:list-projects',
  BC_LIST_TODO_LISTS: 'basecamp:list-todo-lists',
  BC_LIST_TODOS: 'basecamp:list-todos',
  BC_CREATE_TODO: 'basecamp:create-todo',
  BC_POST_COMMENT: 'basecamp:post-comment',
  BC_CREATE_TIME_ENTRY: 'basecamp:create-time-entry',
  BC_GET_PROJECT_TIMESHEET: 'basecamp:get-project-timesheet',
  BC_BACKFILL_TIMESHEET: 'basecamp:backfill-timesheet',
  BC_AUTH_CHANGED: 'basecamp:auth-changed', // main → renderer

  // Today plan + Recents (renderer → main)
  TODAY_GET: 'today:get',
  TODAY_PIN: 'today:pin',
  TODAY_UNPIN: 'today:unpin',
  TODAY_REORDER: 'today:reorder',
  TODAY_SET_ESTIMATE: 'today:set-estimate',
  TODAY_TOGGLE_COMPLETE: 'today:toggle-complete',
  TODAY_CHANGED: 'today:changed', // main → renderer
  RECENTS_GET: 'recents:get',

  // Tomorrow plan — same shape as today, separate slot. At midnight rollover,
  // tomorrow's items merge into today's (along with today's unfinished carry-overs).
  TOMORROW_GET: 'tomorrow:get',
  TOMORROW_PIN: 'tomorrow:pin',
  TOMORROW_UNPIN: 'tomorrow:unpin',
  TOMORROW_REORDER: 'tomorrow:reorder',
  TOMORROW_SET_ESTIMATE: 'tomorrow:set-estimate',
  TOMORROW_TOGGLE_COMPLETE: 'tomorrow:toggle-complete',
  TOMORROW_CHANGED: 'tomorrow:changed', // main → renderer
} as const;
