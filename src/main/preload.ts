import { contextBridge, ipcRenderer } from 'electron';

// IPC channel names — inlined here because Electron's sandboxed preload
// environment cannot resolve external module imports (e.g. ../shared/types).
// These must be kept in sync with src/shared/types.ts IPC constants.
const IPC = {
  PEER_DISCOVERED: 'peer:discovered',
  PEER_UPDATED: 'peer:updated',
  PEER_LOST: 'peer:lost',
  MEETING_REQUEST: 'meeting:request',
  MEETING_REQUEST_CANCEL: 'meeting:request-cancel',
  MEETING_RESPONSE: 'meeting:response',
  EMERGENCY_REQUEST: 'emergency:request',
  EMERGENCY_ACCESS: 'emergency:access',
  UPDATE_STATUS: 'user:update-status',
  UPDATE_USER: 'user:update',
  SEND_MEETING_REQUEST: 'user:send-meeting-request',
  CANCEL_MEETING_REQUEST: 'user:cancel-meeting-request',
  RESPOND_MEETING_REQUEST: 'user:respond-meeting-request',
  SEND_EMERGENCY_REQUEST: 'user:send-emergency-request',
  GRANT_EMERGENCY_ACCESS: 'user:grant-emergency-access',
  OPEN_DASHBOARD: 'window:open-dashboard',
  OPEN_DASHBOARD_AND_PIN: 'window:open-dashboard-and-pin',
  CLOSE_POPOVER: 'window:close-popover',
  QUIT_APP: 'app:quit',
  START_TIMER: 'timer:start',
  STOP_TIMER: 'timer:stop',
  PAUSE_TIMER: 'timer:pause',
  RESUME_TIMER: 'timer:resume',
  TIMER_UPDATE: 'timer:update',
  TIMER_COMPLETE: 'timer:complete',
  GET_USER: 'data:get-user',
  GET_PEERS: 'data:get-peers',
  GET_RECORDS: 'data:get-records',
  SAVE_USER: 'data:save-user',
  DELETE_SESSION: 'data:delete-session',
  UPDATE_SESSION: 'data:update-session',
  GET_SETTINGS: 'data:get-settings',
  SAVE_SETTINGS: 'data:save-settings',
  BREAK_REMINDER: 'timer:break-reminder',
  TIMER_AUTO_PAUSED: 'timer:auto-paused',
  STATUS_REVERT_TICK: 'status:revert-tick',
  SET_STATUS_REVERT: 'status:set-revert',
  CANCEL_STATUS_REVERT: 'status:cancel-revert',
  TIMER_LONG_RUN_RESPONSE: 'timer:long-run-response',
  TIMER_TIMESHEET_CONFIRM: 'timer:timesheet-confirm',
  MINI_TIMER_RESIZE: 'mini-timer:resize',
  MINI_TIMER_MOVE_BY: 'mini-timer:move-by',
  MINI_TIMER_GET_NOTES: 'mini-timer:get-notes',
  MINI_TIMER_SET_NOTES: 'mini-timer:set-notes',
  TEAM_SEND_PING: 'team:send-ping',
  TEAM_PING_RECEIVED: 'team:ping-received',
  TEAM_GET_RECENT_PINGS: 'team:get-recent-pings',
  TEAM_DISMISS_PING: 'team:dismiss-ping',
  GROUPS_GET: 'groups:get',
  GROUPS_SAVE: 'groups:save',
  GROUPS_DELETE: 'groups:delete',
  ACTIVATE_LICENSE: 'license:activate',
  GET_LICENSE_STATE: 'license:get-state',
  DEACTIVATE_LICENSE: 'license:deactivate',
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
  BC_AUTH_CHANGED: 'basecamp:auth-changed',
  TODAY_GET: 'today:get',
  TODAY_PIN: 'today:pin',
  TODAY_UNPIN: 'today:unpin',
  TODAY_REORDER: 'today:reorder',
  TODAY_SET_ESTIMATE: 'today:set-estimate',
  TODAY_TOGGLE_COMPLETE: 'today:toggle-complete',
  TODAY_CHANGED: 'today:changed',
  RECENTS_GET: 'recents:get',
  TOMORROW_GET: 'tomorrow:get',
  TOMORROW_PIN: 'tomorrow:pin',
  TOMORROW_UNPIN: 'tomorrow:unpin',
  TOMORROW_REORDER: 'tomorrow:reorder',
  TOMORROW_SET_ESTIMATE: 'tomorrow:set-estimate',
  TOMORROW_TOGGLE_COMPLETE: 'tomorrow:toggle-complete',
  TOMORROW_CHANGED: 'tomorrow:changed',
} as const;

// Channels the renderer is allowed to subscribe to (and detach from). Any
// channel outside this list is silently ignored — prevents a renderer from
// silencing main's own internal handlers like 'app:install-update'.
const LISTEN_CHANNELS: string[] = [
  IPC.PEER_DISCOVERED, IPC.PEER_UPDATED, IPC.PEER_LOST,
  IPC.MEETING_REQUEST, IPC.MEETING_REQUEST_CANCEL, IPC.MEETING_RESPONSE,
  IPC.EMERGENCY_REQUEST, IPC.EMERGENCY_ACCESS,
  IPC.TIMER_UPDATE,
  IPC.TIMER_COMPLETE,
  IPC.BREAK_REMINDER,
  IPC.TIMER_AUTO_PAUSED,
  IPC.STATUS_REVERT_TICK,
  'alert-data',
  'user:logged-in',
  'popover:shown',
  'update:available',
  'update:downloaded',
  'dashboard:switch-tab',
  'plan:open-picker',
  'settings:updated',
  'license:changed',
  IPC.BC_AUTH_CHANGED,
  'basecamp:reauth-required',
  'basecamp:timesheet-updated',
  IPC.TODAY_CHANGED,
  IPC.TOMORROW_CHANGED,
  IPC.TEAM_PING_RECEIVED,
];

// Expose safe IPC bridge to renderer
contextBridge.exposeInMainWorld('zenstate', {
  // Invoke (request-response)
  getUser: () => ipcRenderer.invoke(IPC.GET_USER),
  saveUser: (user: unknown) => ipcRenderer.invoke(IPC.SAVE_USER, user),
  getPeers: () => ipcRenderer.invoke(IPC.GET_PEERS),
  getRecords: (month?: string) => ipcRenderer.invoke(IPC.GET_RECORDS, month),
  deleteSession: (sessionId: string, date: string) => ipcRenderer.invoke(IPC.DELETE_SESSION, { sessionId, date }),
  updateSession: (sessionId: string, date: string, updates: unknown) => ipcRenderer.invoke(IPC.UPDATE_SESSION, { sessionId, date, updates }),
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  resetAllData: () => ipcRenderer.invoke('data:reset-all'),
  getCategories: () => ipcRenderer.invoke('data:get-categories'),
  saveCategories: (categories: string[]) => ipcRenderer.invoke('data:save-categories', categories),
  pickAvatarImage: () => ipcRenderer.invoke('dialog:pick-avatar-image'),
  getSettings: () => ipcRenderer.invoke(IPC.GET_SETTINGS),
  saveSettings: (settings: unknown) => ipcRenderer.invoke(IPC.SAVE_SETTINGS, settings),
  connectToIP: (host: string, port: number) => ipcRenderer.invoke('network:connect-ip', { host, port }),
  getLocalInfo: () => ipcRenderer.invoke('network:get-local-info'),
  getWiFiInfo: () => ipcRenderer.invoke('network:get-wifi-info'),
  checkForUpdate: () => ipcRenderer.invoke('app:check-for-update'),
  activateLicense: (key: string) => ipcRenderer.invoke(IPC.ACTIVATE_LICENSE, key),
  getLicenseState: () => ipcRenderer.invoke(IPC.GET_LICENSE_STATE),
  deactivateLicense: () => ipcRenderer.invoke(IPC.DEACTIVATE_LICENSE),

  // Basecamp
  bcGetCredentials: () => ipcRenderer.invoke(IPC.BC_GET_CREDENTIALS),
  bcSaveCredentials: (creds: { clientId: string; clientSecret: string }) => ipcRenderer.invoke(IPC.BC_SAVE_CREDENTIALS, creds),
  bcConnect: () => ipcRenderer.invoke(IPC.BC_CONNECT),
  bcCancelConnect: () => ipcRenderer.invoke(IPC.BC_CANCEL_CONNECT),
  bcDisconnect: () => ipcRenderer.invoke(IPC.BC_DISCONNECT),
  bcGetAuthState: () => ipcRenderer.invoke(IPC.BC_GET_AUTH_STATE),
  bcListProjects: () => ipcRenderer.invoke(IPC.BC_LIST_PROJECTS),
  bcListTodoLists: (projectId: number, todoSetId: number) => ipcRenderer.invoke(IPC.BC_LIST_TODO_LISTS, { projectId, todoSetId }),
  bcListTodos: (projectId: number, todoListId: number) => ipcRenderer.invoke(IPC.BC_LIST_TODOS, { projectId, todoListId }),
  bcCreateTodo: (data: { projectId: number; todoListId: number; content: string; description?: string; parentId?: number }) => ipcRenderer.invoke(IPC.BC_CREATE_TODO, data),
  bcPostComment: (data: { projectId: number; todoId: number; content: string }) => ipcRenderer.invoke(IPC.BC_POST_COMMENT, data),
  bcCreateTimeEntry: (data: { todoId: number; date: string; hours: string; description?: string }) => ipcRenderer.invoke(IPC.BC_CREATE_TIME_ENTRY, data),
  bcGetProjectTimesheet: (projectId: number) => ipcRenderer.invoke(IPC.BC_GET_PROJECT_TIMESHEET, { projectId }),
  bcBackfillTimesheet: () => ipcRenderer.invoke(IPC.BC_BACKFILL_TIMESHEET),

  // Today + Recents
  todayGet: () => ipcRenderer.invoke(IPC.TODAY_GET),
  todayPin: (item: unknown) => ipcRenderer.invoke(IPC.TODAY_PIN, item),
  todayUnpin: (todoId: number) => ipcRenderer.invoke(IPC.TODAY_UNPIN, todoId),
  todayReorder: (todoIds: number[]) => ipcRenderer.invoke(IPC.TODAY_REORDER, todoIds),
  todaySetEstimate: (todoId: number, minutes: number | null) => ipcRenderer.invoke(IPC.TODAY_SET_ESTIMATE, { todoId, minutes }),
  todayToggleComplete: (todoId: number) => ipcRenderer.invoke(IPC.TODAY_TOGGLE_COMPLETE, todoId),
  tomorrowGet: () => ipcRenderer.invoke(IPC.TOMORROW_GET),
  tomorrowPin: (item: unknown) => ipcRenderer.invoke(IPC.TOMORROW_PIN, item),
  tomorrowUnpin: (todoId: number) => ipcRenderer.invoke(IPC.TOMORROW_UNPIN, todoId),
  tomorrowReorder: (todoIds: number[]) => ipcRenderer.invoke(IPC.TOMORROW_REORDER, todoIds),
  tomorrowSetEstimate: (todoId: number, minutes: number | null) => ipcRenderer.invoke(IPC.TOMORROW_SET_ESTIMATE, { todoId, minutes }),
  tomorrowToggleComplete: (todoId: number) => ipcRenderer.invoke(IPC.TOMORROW_TOGGLE_COMPLETE, todoId),
  recentsGet: () => ipcRenderer.invoke(IPC.RECENTS_GET),

  // Send (fire-and-forget)
  updateStatus: (status: string) => ipcRenderer.send(IPC.UPDATE_STATUS, status),
  updateUser: (updates: unknown) => ipcRenderer.send(IPC.UPDATE_USER, updates),
  sendMeetingRequest: (userId: string, message?: string) => ipcRenderer.send(IPC.SEND_MEETING_REQUEST, { userId, message }),
  cancelMeetingRequest: (userId: string) => ipcRenderer.send(IPC.CANCEL_MEETING_REQUEST, userId),
  respondMeetingRequest: (userId: string, accepted: boolean, message?: string) => ipcRenderer.send(IPC.RESPOND_MEETING_REQUEST, { userId, accepted, message }),
  sendEmergencyRequest: (userId: string, message?: string) => ipcRenderer.send(IPC.SEND_EMERGENCY_REQUEST, { userId, message }),
  grantEmergencyAccess: (userId: string, granted: boolean) => ipcRenderer.send(IPC.GRANT_EMERGENCY_ACCESS, { userId, granted }),

  startTimer: (taskLabel: string, category?: string, targetDuration?: number, basecamp?: { accountId: number; projectId: number; todoId: number; todoListId?: number; projectName?: string }) => ipcRenderer.send(IPC.START_TIMER, { taskLabel, category, targetDuration, basecamp }),
  stopTimer: () => ipcRenderer.send(IPC.STOP_TIMER),
  pauseTimer: () => ipcRenderer.send(IPC.PAUSE_TIMER),
  resumeTimer: () => ipcRenderer.send(IPC.RESUME_TIMER),

  openDashboard: (tab?: string) => ipcRenderer.send(IPC.OPEN_DASHBOARD, tab),
  openDashboardAndPin: () => ipcRenderer.send(IPC.OPEN_DASHBOARD_AND_PIN),
  closePopover: () => ipcRenderer.send(IPC.CLOSE_POPOVER),
  quit: () => ipcRenderer.send(IPC.QUIT_APP),
  login: (user: unknown) => ipcRenderer.send('user:login', user),
  signOut: () => ipcRenderer.send('user:sign-out'),
  installUpdate: () => ipcRenderer.send('app:install-update'),
  setStatusRevert: (seconds: number) => ipcRenderer.send(IPC.SET_STATUS_REVERT, { seconds }),
  cancelStatusRevert: () => ipcRenderer.send(IPC.CANCEL_STATUS_REVERT),
  timerLongRunRespond: (payload: { action: 'continue' | 'stop' | 'backdate'; stopAtIso?: string }) => ipcRenderer.send(IPC.TIMER_LONG_RUN_RESPONSE, payload),
  timerTimesheetConfirm: (payload: { action: 'post' | 'discard'; hours?: string; notes?: string }) => ipcRenderer.send(IPC.TIMER_TIMESHEET_CONFIRM, payload),
  miniTimerResize: (size: { width: number; height: number }) => ipcRenderer.send(IPC.MINI_TIMER_RESIZE, size),
  miniTimerMoveBy: (delta: { dx: number; dy: number }) => ipcRenderer.send(IPC.MINI_TIMER_MOVE_BY, delta),
  miniTimerGetNotes: () => ipcRenderer.invoke(IPC.MINI_TIMER_GET_NOTES),
  miniTimerSetNotes: (notes: string) => ipcRenderer.send(IPC.MINI_TIMER_SET_NOTES, notes),

  // Quick ping + groups
  teamSendPing: (data: { recipientIds: string[]; message: string }) => ipcRenderer.invoke(IPC.TEAM_SEND_PING, data),
  teamGetRecentPings: () => ipcRenderer.invoke(IPC.TEAM_GET_RECENT_PINGS),
  teamDismissPing: (pingId: string) => ipcRenderer.invoke(IPC.TEAM_DISMISS_PING, pingId),
  groupsGet: () => ipcRenderer.invoke(IPC.GROUPS_GET),
  groupsSave: (group: unknown) => ipcRenderer.invoke(IPC.GROUPS_SAVE, group),
  groupsDelete: (groupId: string) => ipcRenderer.invoke(IPC.GROUPS_DELETE, groupId),

  // Settings
  getLoginItemSettings: () => ipcRenderer.invoke('settings:get-login-item'),
  setLoginItemSettings: (enabled: boolean) => ipcRenderer.send('settings:set-login-item', enabled),

  // Listen (main → renderer events). `on` returns an unsubscribe function so
  // each caller can detach its own listener without nuking sibling listeners
  // on the same channel (the old `removeAllListeners` pattern was a hammer
  // that clobbered other components' subscriptions). Channel allowlist still
  // applies to prevent renderer code from subscribing to internal channels.
  on: (channel: string, callback: (...args: unknown[]) => void): (() => void) => {
    if (!LISTEN_CHANNELS.includes(channel)) return () => {};
    const wrapped = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },

  // Kept for the rare case where a renderer wants to detach all of its OWN
  // listeners (e.g. before unmounting a top-level surface). Still allowlisted.
  // Prefer the unsubscribe function returned by `on()` for everyday cleanup.
  removeAllListeners: (channel: string) => {
    if (LISTEN_CHANNELS.includes(channel)) {
      ipcRenderer.removeAllListeners(channel);
    }
  },

  // Platform info
  platform: process.platform,
});
