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
  CLOSE_POPOVER: 'window:close-popover',
  QUIT_APP: 'app:quit',
  START_TIMER: 'timer:start',
  STOP_TIMER: 'timer:stop',
  PAUSE_TIMER: 'timer:pause',
  RESUME_TIMER: 'timer:resume',
  TIMER_UPDATE: 'timer:update',
  GET_USER: 'data:get-user',
  GET_PEERS: 'data:get-peers',
  GET_RECORDS: 'data:get-records',
  SAVE_USER: 'data:save-user',
  DELETE_SESSION: 'data:delete-session',
  UPDATE_SESSION: 'data:update-session',
  EXPORT_CSV: 'data:export-csv',
} as const;

// Expose safe IPC bridge to renderer
contextBridge.exposeInMainWorld('zenstate', {
  // Invoke (request-response)
  getUser: () => ipcRenderer.invoke(IPC.GET_USER),
  saveUser: (user: unknown) => ipcRenderer.invoke(IPC.SAVE_USER, user),
  getPeers: () => ipcRenderer.invoke(IPC.GET_PEERS),
  getRecords: (month?: string) => ipcRenderer.invoke(IPC.GET_RECORDS, month),
  deleteSession: (sessionId: string, date: string) => ipcRenderer.invoke(IPC.DELETE_SESSION, { sessionId, date }),
  updateSession: (sessionId: string, date: string, updates: unknown) => ipcRenderer.invoke(IPC.UPDATE_SESSION, { sessionId, date, updates }),
  exportCSV: (month: string) => ipcRenderer.invoke(IPC.EXPORT_CSV, month),
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  resetAllData: () => ipcRenderer.invoke('data:reset-all'),

  // Send (fire-and-forget)
  updateStatus: (status: string) => ipcRenderer.send(IPC.UPDATE_STATUS, status),
  updateUser: (updates: unknown) => ipcRenderer.send(IPC.UPDATE_USER, updates),
  sendMeetingRequest: (userId: string, message?: string) => ipcRenderer.send(IPC.SEND_MEETING_REQUEST, { userId, message }),
  cancelMeetingRequest: (userId: string) => ipcRenderer.send(IPC.CANCEL_MEETING_REQUEST, userId),
  respondMeetingRequest: (userId: string, accepted: boolean, message?: string) => ipcRenderer.send(IPC.RESPOND_MEETING_REQUEST, { userId, accepted, message }),
  sendEmergencyRequest: (userId: string, message?: string) => ipcRenderer.send(IPC.SEND_EMERGENCY_REQUEST, { userId, message }),
  grantEmergencyAccess: (userId: string, granted: boolean) => ipcRenderer.send(IPC.GRANT_EMERGENCY_ACCESS, { userId, granted }),

  startTimer: (taskLabel: string, category?: string) => ipcRenderer.send(IPC.START_TIMER, { taskLabel, category }),
  stopTimer: () => ipcRenderer.send(IPC.STOP_TIMER),
  pauseTimer: () => ipcRenderer.send(IPC.PAUSE_TIMER),
  resumeTimer: () => ipcRenderer.send(IPC.RESUME_TIMER),

  openDashboard: () => ipcRenderer.send(IPC.OPEN_DASHBOARD),
  closePopover: () => ipcRenderer.send(IPC.CLOSE_POPOVER),
  quit: () => ipcRenderer.send(IPC.QUIT_APP),
  login: (user: unknown) => ipcRenderer.send('user:login', user),
  signOut: () => ipcRenderer.send('user:sign-out'),
  installUpdate: () => ipcRenderer.send('app:install-update'),

  // Settings
  getLoginItemSettings: () => ipcRenderer.invoke('settings:get-login-item'),
  setLoginItemSettings: (enabled: boolean) => ipcRenderer.send('settings:set-login-item', enabled),

  // Listen (main → renderer events)
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const validChannels = [
      IPC.PEER_DISCOVERED, IPC.PEER_UPDATED, IPC.PEER_LOST,
      IPC.MEETING_REQUEST, IPC.MEETING_REQUEST_CANCEL, IPC.MEETING_RESPONSE,
      IPC.EMERGENCY_REQUEST, IPC.EMERGENCY_ACCESS,
      IPC.TIMER_UPDATE,
      'alert-data',
      'update:downloaded',
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (_event, ...args) => callback(...args));
    }
  },

  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel);
  },

  // Platform info
  platform: process.platform,
});
