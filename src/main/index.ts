import { app, BrowserWindow, ipcMain, globalShortcut, Notification, nativeImage, dialog, powerMonitor } from 'electron';
import fs from 'fs';
import path from 'path';
import { createTray, updateTrayIcon } from './tray';
import { createPopoverWindow, createDashboardWindow, createAlertWindow } from './windows';
import { NetworkingService } from './networking/NetworkingService';
import { PersistenceService } from './services/persistence';
import { TimeTracker } from './services/timeTracker';
import { setupUpdater, checkForUpdate } from './updater';
import { IPC, AvailabilityStatus, User, MessageType, AppSettings, FocusTemplate } from '../shared/types';
import { LicenseManager } from './services/licenseManager';

// ── Global Error Safety Net ─────────────────────────────────────
// Catches any unhandled errors that slip through socket error handlers.
// Prevents the Electron main process from crashing entirely.
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception in main process:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection in main process:', reason);
});

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

let popoverWindow: BrowserWindow | null = null;
let dashboardWindow: BrowserWindow | null = null;
let networking: NetworkingService | null = null;

const persistence = new PersistenceService();
const timeTracker = new TimeTracker(persistence);
const licenseManager = new LicenseManager();

// Timer state
let timerInterval: NodeJS.Timeout | null = null;
let timerStartTime: Date | null = null;
let timerAccumulatedTime = 0;
let timerIsPaused = false;
let timerIsRunning = false;
let timerTaskLabel = '';
let timerCategory: string | undefined;
let timerTargetDuration: number | undefined;

// Break reminder state
let breakReminderTimeout: NodeJS.Timeout | null = null;

// Status auto-revert state
let statusRevertTimeout: NodeJS.Timeout | null = null;
let statusRevertTickInterval: NodeJS.Timeout | null = null;
let statusRevertEndTime: number | null = null;

// Idle detection state
let idleCheckInterval: NodeJS.Timeout | null = null;

function isDev(): boolean {
  return !app.isPackaged;
}

function getRendererURL(page: string): string {
  if (isDev()) {
    return `http://localhost:5173/${page}`;
  }
  return `file://${path.join(__dirname, '../renderer', page)}`;
}

// ── App Lifecycle ──────────────────────────────────────────────

app.on('ready', async () => {
  // macOS: Set Dock icon and hide it (menu bar app)
  if (process.platform === 'darwin') {
    const iconPath = path.join(__dirname, '../../build/icon.png');
    try {
      const dockIcon = nativeImage.createFromPath(iconPath);
      if (!dockIcon.isEmpty()) {
        app.dock?.setIcon(dockIcon);
      }
    } catch (_) { /* icon not found in dev — that's ok */ }
    app.dock?.hide();
  }

  // Create tray with callbacks for context menu actions
  createTray({
    onClick: () => togglePopover(),
    onStatusChange: (status: AvailabilityStatus) => {
      const u = persistence.getUser();
      if (u) {
        u.status = status;
        persistence.saveUser(u);
        networking?.updateUser(u);
        updateTrayIcon(u, 0, timerIsRunning);
        broadcastToWindows(IPC.PEER_UPDATED, u);
      }
    },
    onOpenDashboard: () => {
      if (!dashboardWindow || dashboardWindow.isDestroyed()) {
        dashboardWindow = createDashboardWindow(getRendererURL('dashboard.html'));
        if (process.platform === 'darwin') app.dock?.show();
        dashboardWindow.on('closed', () => {
          dashboardWindow = null;
          if (process.platform === 'darwin' && !popoverWindow?.isVisible()) {
            app.dock?.hide();
          }
        });
      } else {
        dashboardWindow.focus();
      }
    },
  });

  // Create popover window (hidden initially)
  popoverWindow = createPopoverWindow(getRendererURL('index.html'));

  // Setup IPC handlers
  setupIPC();

  // Register global shortcuts
  registerShortcuts();

  // Start networking if user exists
  const user = persistence.getUser();
  if (user) {
    startNetworking(user);
  }

  // Auto-update (production only)
  if (!isDev()) {
    setupUpdater();
  }
});

app.on('window-all-closed', () => {
  // Don't quit — menu bar app. Do nothing.
});

app.on('before-quit', () => {
  networking?.stop();
  globalShortcut.unregisterAll();
});

app.on('second-instance', () => {
  togglePopover();
});

// ── Popover Toggle ─────────────────────────────────────────────

function togglePopover() {
  if (!popoverWindow) return;

  if (popoverWindow.isVisible()) {
    popoverWindow.hide();
  } else {
    // Position near tray icon
    const { positionPopover } = require('./tray');
    positionPopover(popoverWindow);
    popoverWindow.show();
    popoverWindow.focus();
  }
}

// ── Networking ─────────────────────────────────────────────────

function startNetworking(user: User) {
  networking = new NetworkingService(user);

  networking.on('peerDiscovered', (peer: User) => {
    // Free tier: cap at 3 visible peers
    if (!licenseManager.isPro()) {
      const currentPeers = networking?.getPeers() ?? [];
      if (currentPeers.length > 3) return; // Don't broadcast beyond cap
    }
    broadcastToWindows(IPC.PEER_DISCOVERED, peer);
  });

  networking.on('peerUpdated', (peer: User) => {
    broadcastToWindows(IPC.PEER_UPDATED, peer);
  });

  networking.on('peerLost', (peerId: string) => {
    broadcastToWindows(IPC.PEER_LOST, peerId);
  });

  networking.on('meetingRequest', (data: { from: string; senderId: string; message?: string }) => {
    broadcastToWindows(IPC.MEETING_REQUEST, data);
    showMeetingRequestAlert(data);
  });

  networking.on('meetingRequestCancel', (senderId: string) => {
    broadcastToWindows(IPC.MEETING_REQUEST_CANCEL, senderId);
  });

  networking.on('meetingResponse', (data: { accepted: boolean; from: string; message?: string }) => {
    broadcastToWindows(IPC.MEETING_RESPONSE, data);
    showMeetingResponseAlert(data);
  });

  networking.on('emergencyRequest', (data: { from: string; senderId: string; message?: string }) => {
    broadcastToWindows(IPC.EMERGENCY_REQUEST, data);
    showEmergencyAlert(data);
  });

  networking.on('emergencyAccess', (granted: boolean) => {
    // Persist the updated canSendEmergency flag on this user
    const user = persistence.getUser();
    if (user) {
      user.canSendEmergency = granted;
      persistence.saveUser(user);
    }
    broadcastToWindows(IPC.EMERGENCY_ACCESS, granted);
  });

  networking.on('adminNotification', (data: { from: string; senderId: string; message?: string }) => {
    broadcastToWindows(IPC.ADMIN_NOTIFICATION_RECEIVED, data);
    showAdminNotificationAlert({ from: data.from, message: data.message || '' });
  });

  networking.start();
}

function broadcastToWindows(channel: string, data: unknown) {
  popoverWindow?.webContents.send(channel, data);
  dashboardWindow?.webContents.send(channel, data);
}

// ── Meeting Alerts ─────────────────────────────────────────────

function showMeetingRequestAlert(data: { from: string; senderId: string; message?: string }) {
  const alert = createAlertWindow(getRendererURL('alert.html'), {
    width: 360,
    height: 380,
  });
  alert.webContents.once('did-finish-load', () => {
    alert.webContents.send('alert-data', {
      type: 'meetingRequest',
      ...data,
    });
  });
}

function showMeetingResponseAlert(data: { accepted: boolean; from: string; message?: string }) {
  const alertWin = createAlertWindow(getRendererURL('alert.html'), {
    width: 360,
    height: data.message ? 300 : 240,
  });
  alertWin.webContents.once('did-finish-load', () => {
    alertWin.webContents.send('alert-data', {
      type: 'meetingResponse',
      from: data.from,
      senderId: '',
      accepted: data.accepted,
      message: data.message,
    });
  });
}

function showEmergencyAlert(data: { from: string; senderId: string; message?: string }) {
  const alert = createAlertWindow(getRendererURL('alert.html'), {
    width: 360,
    height: 380,
  });
  alert.webContents.once('did-finish-load', () => {
    alert.webContents.send('alert-data', {
      type: 'emergencyRequest',
      ...data,
    });
  });
}

function showTimerCompleteAlert(taskLabel: string, targetDuration: number, statusChanged: boolean) {
  const alertWin = createAlertWindow(getRendererURL('alert.html'), {
    width: 360,
    height: 280,
  });
  alertWin.webContents.once('did-finish-load', () => {
    alertWin.webContents.send('alert-data', {
      type: 'timerComplete',
      from: taskLabel,
      senderId: '',
      message: statusChanged ? 'Status changed to Occupied' : undefined,
      targetDuration,
    });
  });
}

// ── Break Reminders ─────────────────────────────────────────────

function scheduleBreakReminder(intervalSeconds: number) {
  clearBreakReminder();
  breakReminderTimeout = setTimeout(() => {
    showBreakReminderAlert();
    broadcastToWindows(IPC.BREAK_REMINDER, {});
    // Re-schedule for next interval
    if (timerIsRunning && !timerIsPaused) {
      scheduleBreakReminder(intervalSeconds);
    }
  }, intervalSeconds * 1000);
}

function clearBreakReminder() {
  if (breakReminderTimeout) {
    clearTimeout(breakReminderTimeout);
    breakReminderTimeout = null;
  }
}

function showBreakReminderAlert() {
  const alertWin = createAlertWindow(getRendererURL('alert.html'), {
    width: 360,
    height: 240,
  });
  alertWin.webContents.once('did-finish-load', () => {
    alertWin.webContents.send('alert-data', {
      type: 'breakReminder',
      from: 'Break Reminder',
      senderId: '',
      message: 'You\'ve been focused for a while. Take a short break to recharge!',
    });
  });
}

// ── Idle Detection ──────────────────────────────────────────────

function startIdleDetection(thresholdSeconds: number) {
  stopIdleDetection();
  idleCheckInterval = setInterval(() => {
    if (!timerIsRunning || timerIsPaused) return;
    const idleTime = powerMonitor.getSystemIdleTime();
    if (idleTime >= thresholdSeconds) {
      pauseTimer();
      broadcastToWindows(IPC.TIMER_AUTO_PAUSED, { idleTime });
      new Notification({
        title: 'Timer Auto-Paused',
        body: `Your timer was paused after ${Math.floor(thresholdSeconds / 60)} minutes of inactivity.`,
      }).show();
    }
  }, 10000); // Check every 10 seconds
}

function stopIdleDetection() {
  if (idleCheckInterval) {
    clearInterval(idleCheckInterval);
    idleCheckInterval = null;
  }
}

// ── Status Auto-Revert ─────────────────────────────────────────

function setStatusRevertTimer(seconds: number) {
  cancelStatusRevertTimer();
  statusRevertEndTime = Date.now() + seconds * 1000;

  statusRevertTimeout = setTimeout(() => {
    const user = persistence.getUser();
    if (user && (user.status === AvailabilityStatus.Occupied || user.status === AvailabilityStatus.Focused)) {
      user.status = AvailabilityStatus.Available;
      persistence.saveUser(user);
      networking?.updateUser(user);
      updateTrayIcon(user, 0, timerIsRunning);
      broadcastToWindows(IPC.PEER_UPDATED, user);
    }
    cancelStatusRevertTimer();
  }, seconds * 1000);

  statusRevertTickInterval = setInterval(() => {
    if (statusRevertEndTime) {
      const remaining = Math.max(0, Math.floor((statusRevertEndTime - Date.now()) / 1000));
      broadcastToWindows(IPC.STATUS_REVERT_TICK, { remaining });
      if (remaining <= 0) {
        cancelStatusRevertTimer();
      }
    }
  }, 1000);
}

function cancelStatusRevertTimer() {
  if (statusRevertTimeout) {
    clearTimeout(statusRevertTimeout);
    statusRevertTimeout = null;
  }
  if (statusRevertTickInterval) {
    clearInterval(statusRevertTickInterval);
    statusRevertTickInterval = null;
  }
  statusRevertEndTime = null;
  broadcastToWindows(IPC.STATUS_REVERT_TICK, { remaining: 0 });
}

// ── Admin Notification Alert ────────────────────────────────────

function showAdminNotificationAlert(data: { from: string; message: string }) {
  const alertWin = createAlertWindow(getRendererURL('alert.html'), {
    width: 360,
    height: 280,
  });
  alertWin.webContents.once('did-finish-load', () => {
    alertWin.webContents.send('alert-data', {
      type: 'adminNotification',
      from: data.from,
      senderId: '',
      message: data.message,
    });
  });
}

// ── Timer Logic ────────────────────────────────────────────────

function startTimer(taskLabel: string, category?: string, targetDuration?: number) {
  timerTaskLabel = taskLabel;
  timerCategory = category;
  timerTargetDuration = targetDuration;
  timerStartTime = new Date();
  timerAccumulatedTime = 0;
  timerIsPaused = false;
  timerIsRunning = true;

  // Start break reminders if enabled
  const settings = persistence.getSettings();
  if (settings.breakReminderEnabled) {
    scheduleBreakReminder(settings.breakReminderIntervalSeconds);
  }

  // Start idle detection if enabled
  if (settings.idleDetectionEnabled) {
    startIdleDetection(settings.idleThresholdSeconds);
  }

  timerInterval = setInterval(() => {
    if (timerIsRunning && !timerIsPaused && timerStartTime) {
      const elapsed = timerAccumulatedTime + (Date.now() - timerStartTime.getTime()) / 1000;
      const remaining = timerTargetDuration ? Math.max(0, timerTargetDuration - elapsed) : undefined;

      broadcastToWindows(IPC.TIMER_UPDATE, {
        elapsed,
        isRunning: true,
        isPaused: false,
        taskLabel: timerTaskLabel,
        category: timerCategory,
        targetDuration: timerTargetDuration,
        remaining,
      });
      updateTrayIcon(persistence.getUser()!, elapsed, true);

      // Countdown complete
      if (timerTargetDuration && remaining !== undefined && remaining <= 0) {
        handleCountdownComplete();
      }
    }
  }, 1000);
}

function handleCountdownComplete() {
  const user = persistence.getUser();
  let statusChanged = false;

  if (user && user.status === AvailabilityStatus.Focused) {
    user.status = AvailabilityStatus.Occupied;
    persistence.saveUser(user);
    networking?.updateUser(user);
    updateTrayIcon(user, 0, false);
    broadcastToWindows(IPC.PEER_UPDATED, user);
    statusChanged = true;
  }

  const taskLabel = timerTaskLabel;
  const targetDuration = timerTargetDuration;
  stopTimer();

  broadcastToWindows(IPC.TIMER_COMPLETE, { taskLabel, targetDuration, statusChanged });
  showTimerCompleteAlert(taskLabel, targetDuration || 0, statusChanged);
}

function pauseTimer() {
  if (timerIsRunning && !timerIsPaused && timerStartTime) {
    timerAccumulatedTime += (Date.now() - timerStartTime.getTime()) / 1000;
    timerStartTime = null;
    timerIsPaused = true;
    clearBreakReminder();
    const remaining = timerTargetDuration ? Math.max(0, timerTargetDuration - timerAccumulatedTime) : undefined;
    broadcastToWindows(IPC.TIMER_UPDATE, {
      elapsed: timerAccumulatedTime,
      isRunning: true,
      isPaused: true,
      taskLabel: timerTaskLabel,
      category: timerCategory,
      targetDuration: timerTargetDuration,
      remaining,
    });
  }
}

function resumeTimer() {
  if (timerIsPaused) {
    timerStartTime = new Date();
    timerIsPaused = false;
    // Re-schedule break reminder on resume
    const settings = persistence.getSettings();
    if (settings.breakReminderEnabled) {
      scheduleBreakReminder(settings.breakReminderIntervalSeconds);
    }
  }
}

function stopTimer() {
  if (!timerIsRunning && !timerIsPaused) return;

  let totalDuration = timerAccumulatedTime;
  if (timerStartTime) {
    totalDuration += (Date.now() - timerStartTime.getTime()) / 1000;
  }

  // Save session
  timeTracker.addSession({
    taskLabel: timerTaskLabel,
    category: timerCategory,
    duration: totalDuration,
    startTime: new Date(Date.now() - totalDuration * 1000).toISOString(),
    endTime: new Date().toISOString(),
  });

  // Reset
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
  timerStartTime = null;
  clearBreakReminder();
  stopIdleDetection();
  timerAccumulatedTime = 0;
  timerIsPaused = false;
  timerIsRunning = false;
  timerTaskLabel = '';
  timerCategory = undefined;
  timerTargetDuration = undefined;

  broadcastToWindows(IPC.TIMER_UPDATE, {
    elapsed: 0,
    isRunning: false,
    isPaused: false,
    taskLabel: '',
  });

  const user = persistence.getUser();
  if (user) updateTrayIcon(user, 0, false);
}

// ── IPC Handlers ───────────────────────────────────────────────

function setupIPC() {
  // User data
  ipcMain.handle(IPC.GET_USER, () => persistence.getUser());
  ipcMain.handle(IPC.SAVE_USER, (_e, user: User) => {
    persistence.saveUser(user);
    networking?.updateUser(user);
    updateTrayIcon(user, 0, timerIsRunning);
    return true;
  });
  ipcMain.handle(IPC.GET_PEERS, () => networking?.getPeers() ?? []);

  // Status updates
  ipcMain.on(IPC.UPDATE_STATUS, (_e, status: AvailabilityStatus) => {
    const user = persistence.getUser();
    if (user) {
      user.status = status;
      persistence.saveUser(user);
      networking?.updateUser(user);
      updateTrayIcon(user, 0, timerIsRunning);
      broadcastToWindows(IPC.PEER_UPDATED, user);
      // Cancel status revert when user manually changes status
      cancelStatusRevertTimer();
    }
  });

  ipcMain.on(IPC.UPDATE_USER, (_e, updates: Partial<User>) => {
    const user = persistence.getUser();
    if (user) {
      Object.assign(user, updates);
      persistence.saveUser(user);
      networking?.updateUser(user);
      broadcastToWindows(IPC.PEER_UPDATED, user);
    }
  });

  // Meeting requests
  ipcMain.on(IPC.SEND_MEETING_REQUEST, (_e, data: { userId: string; message?: string }) => {
    networking?.sendMeetingRequest(data.userId, data.message);
  });

  ipcMain.on(IPC.CANCEL_MEETING_REQUEST, (_e, userId: string) => {
    networking?.cancelMeetingRequest(userId);
  });

  ipcMain.on(IPC.RESPOND_MEETING_REQUEST, (_e, data: { userId: string; accepted: boolean; message?: string }) => {
    networking?.respondToMeetingRequest(data.userId, data.accepted, data.message);
  });

  ipcMain.on(IPC.SEND_EMERGENCY_REQUEST, (_e, data: { userId: string; message?: string }) => {
    networking?.sendEmergencyRequest(data.userId, data.message);
  });

  ipcMain.on(IPC.GRANT_EMERGENCY_ACCESS, (_e, data: { userId: string; granted: boolean }) => {
    networking?.grantEmergencyAccess(data.userId, data.granted);
  });

  // Timer
  ipcMain.on(IPC.START_TIMER, (_e, data: { taskLabel: string; category?: string; targetDuration?: number }) => {
    startTimer(data.taskLabel, data.category, data.targetDuration);
  });
  ipcMain.on(IPC.STOP_TIMER, () => stopTimer());
  ipcMain.on(IPC.PAUSE_TIMER, () => pauseTimer());
  ipcMain.on(IPC.RESUME_TIMER, () => resumeTimer());

  // Time tracking data
  ipcMain.handle(IPC.GET_RECORDS, (_e, month?: string) => {
    if (month) return timeTracker.getRecordsForMonth(month);
    return timeTracker.getAllRecords();
  });
  ipcMain.handle(IPC.DELETE_SESSION, (_e, data: { sessionId: string; date: string }) => {
    timeTracker.deleteSession(data.sessionId, data.date);
    return true;
  });
  ipcMain.handle(IPC.UPDATE_SESSION, (_e, data: { sessionId: string; date: string; updates: Partial<{ taskLabel: string; category: string; duration: number }> }) => {
    timeTracker.updateSession(data.sessionId, data.date, data.updates);
    return true;
  });
  ipcMain.handle(IPC.EXPORT_CSV, (_e, month: string) => {
    return timeTracker.generateCSV(month);
  });

  // Window management
  ipcMain.on(IPC.OPEN_DASHBOARD, (_e, tab?: string) => {
    if (!dashboardWindow || dashboardWindow.isDestroyed()) {
      dashboardWindow = createDashboardWindow(getRendererURL('dashboard.html'));
      if (process.platform === 'darwin') app.dock?.show();
      dashboardWindow.on('closed', () => {
        dashboardWindow = null;
        if (process.platform === 'darwin' && !popoverWindow?.isVisible()) {
          app.dock?.hide();
        }
      });
      if (tab) {
        dashboardWindow.webContents.once('did-finish-load', () => {
          dashboardWindow?.webContents.send('dashboard:switch-tab', tab);
        });
      }
    } else {
      dashboardWindow.focus();
      if (tab) {
        dashboardWindow.webContents.send('dashboard:switch-tab', tab);
      }
    }
  });

  ipcMain.on(IPC.CLOSE_POPOVER, () => {
    popoverWindow?.hide();
  });

  ipcMain.on(IPC.QUIT_APP, () => {
    app.quit();
  });

  // Start networking after login
  ipcMain.on('user:login', (_e, user: User) => {
    persistence.saveUser(user);
    startNetworking(user);
    updateTrayIcon(user, 0, false);
    // Default Launch at Login to ON for new users
    app.setLoginItemSettings({ openAtLogin: true });
  });

  // Sign out
  ipcMain.on('user:sign-out', () => {
    networking?.stop();
    networking = null;
    persistence.deleteUser();
    updateTrayIcon({ status: AvailabilityStatus.Offline } as User, 0, false);
  });

  // Settings: Launch at login
  ipcMain.handle('settings:get-login-item', () => {
    return app.getLoginItemSettings().openAtLogin;
  });
  ipcMain.on('settings:set-login-item', (_e, enabled: boolean) => {
    app.setLoginItemSettings({ openAtLogin: enabled });
  });

  // App version
  ipcMain.handle('app:get-version', () => app.getVersion());

  // Reset all data
  ipcMain.handle('data:reset-all', () => {
    persistence.saveRecords([]);
    persistence.deleteUser();
    return true;
  });

  // Install update (quit and install)
  ipcMain.on('app:install-update', () => {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.quitAndInstall();
  });

  // Check for update (manual) — returns result directly
  ipcMain.handle('app:check-for-update', async () => {
    return await checkForUpdate();
  });

  // Categories
  ipcMain.handle('data:get-categories', () => {
    return persistence.getCategories();
  });
  ipcMain.handle('data:save-categories', (_e, categories: string[]) => {
    persistence.saveCategories(categories);
    return true;
  });

  ipcMain.handle('data:get-category-colors', () => {
    return persistence.getCategoryColors();
  });
  ipcMain.handle('data:save-category-colors', (_e, colors: Record<string, string>) => {
    persistence.saveCategoryColors(colors);
    return true;
  });

  // App settings
  ipcMain.handle(IPC.GET_SETTINGS, () => persistence.getSettings());
  ipcMain.handle(IPC.SAVE_SETTINGS, (_e, settings: AppSettings) => {
    persistence.saveSettings(settings);
    // Broadcast settings change to all windows so popup can update
    broadcastToWindows('settings:updated', settings);
    return true;
  });

  // Focus templates
  ipcMain.handle(IPC.GET_TEMPLATES, () => persistence.getTemplates());
  ipcMain.handle(IPC.SAVE_TEMPLATES, (_e, templates: FocusTemplate[]) => {
    persistence.saveTemplates(templates);
    return true;
  });

  // Status auto-revert
  ipcMain.on(IPC.SET_STATUS_REVERT, (_e, data: { seconds: number }) => {
    setStatusRevertTimer(data.seconds);
  });

  ipcMain.on(IPC.CANCEL_STATUS_REVERT, () => {
    cancelStatusRevertTimer();
  });

  // Admin notifications
  ipcMain.on(IPC.SEND_ADMIN_NOTIFICATION, (_e, data: { recipientIds: string[] | 'all'; message: string }) => {
    networking?.sendAdminNotification(data.recipientIds, data.message);
  });

  // Avatar photo picker (crops to center square, then resizes to 128x128)
  ipcMain.handle('dialog:pick-avatar-image', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    const fileData = fs.readFileSync(filePath);
    const img = nativeImage.createFromBuffer(fileData);
    const { width, height } = img.getSize();
    // Crop to center square
    let cropped = img;
    if (width !== height) {
      const side = Math.min(width, height);
      const x = Math.floor((width - side) / 2);
      const y = Math.floor((height - side) / 2);
      cropped = img.crop({ x, y, width: side, height: side });
    }
    const resized = cropped.resize({ width: 128, height: 128 });
    return resized.toPNG().toString('base64');
  });

  // Network: manual IP connection
  ipcMain.handle('network:connect-ip', (_e, data: { host: string; port: number }) => {
    if (networking) {
      networking.connectToIP(data.host, data.port);
      return true;
    }
    return false;
  });

  // Network: get local info
  ipcMain.handle('network:get-local-info', () => {
    if (networking) {
      return {
        addresses: networking.getLocalAddresses(),
        port: networking.getTCPPort(),
      };
    }
    return { addresses: [], port: 0 };
  });

  // License management
  ipcMain.handle(IPC.ACTIVATE_LICENSE, (_e, key: string) => {
    const state = licenseManager.activateLicense(key);
    broadcastToWindows('license:changed', state);
    return state;
  });

  ipcMain.handle(IPC.GET_LICENSE_STATE, () => {
    return licenseManager.getLicenseState();
  });

  ipcMain.handle(IPC.DEACTIVATE_LICENSE, () => {
    licenseManager.deactivateLicense();
    const state = licenseManager.getLicenseState();
    broadcastToWindows('license:changed', state);
    return state;
  });
}

// ── Keyboard Shortcuts ─────────────────────────────────────────

function registerShortcuts() {
  globalShortcut.register('CmdOrCtrl+Shift+A', () => {
    const user = persistence.getUser();
    if (user) {
      user.status = AvailabilityStatus.Available;
      persistence.saveUser(user);
      networking?.updateUser(user);
      updateTrayIcon(user, 0, timerIsRunning);
      broadcastToWindows(IPC.PEER_UPDATED, user);
    }
  });

  globalShortcut.register('CmdOrCtrl+Shift+P', () => {
    const user = persistence.getUser();
    if (user) {
      user.status = AvailabilityStatus.Occupied;
      persistence.saveUser(user);
      networking?.updateUser(user);
      updateTrayIcon(user, 0, timerIsRunning);
      broadcastToWindows(IPC.PEER_UPDATED, user);
    }
  });

  globalShortcut.register('CmdOrCtrl+Shift+F', () => {
    const user = persistence.getUser();
    if (user) {
      user.status = AvailabilityStatus.Focused;
      persistence.saveUser(user);
      networking?.updateUser(user);
      updateTrayIcon(user, 0, timerIsRunning);
      broadcastToWindows(IPC.PEER_UPDATED, user);
    }
  });
}
