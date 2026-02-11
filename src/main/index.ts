import { app, BrowserWindow, ipcMain, globalShortcut, Notification, nativeImage, dialog } from 'electron';
import fs from 'fs';
import path from 'path';
import { createTray, updateTrayIcon } from './tray';
import { createPopoverWindow, createDashboardWindow, createAlertWindow } from './windows';
import { NetworkingService } from './networking/NetworkingService';
import { PersistenceService } from './services/persistence';
import { TimeTracker } from './services/timeTracker';
import { setupUpdater, checkForUpdate } from './updater';
import { IPC, AvailabilityStatus, User, MessageType } from '../shared/types';

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

// Timer state
let timerInterval: NodeJS.Timeout | null = null;
let timerStartTime: Date | null = null;
let timerAccumulatedTime = 0;
let timerIsPaused = false;
let timerIsRunning = false;
let timerTaskLabel = '';
let timerCategory: string | undefined;

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
    broadcastToWindows(IPC.EMERGENCY_ACCESS, granted);
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

// ── Timer Logic ────────────────────────────────────────────────

function startTimer(taskLabel: string, category?: string) {
  timerTaskLabel = taskLabel;
  timerCategory = category;
  timerStartTime = new Date();
  timerAccumulatedTime = 0;
  timerIsPaused = false;
  timerIsRunning = true;

  timerInterval = setInterval(() => {
    if (timerIsRunning && !timerIsPaused && timerStartTime) {
      const elapsed = timerAccumulatedTime + (Date.now() - timerStartTime.getTime()) / 1000;
      broadcastToWindows(IPC.TIMER_UPDATE, {
        elapsed,
        isRunning: true,
        isPaused: false,
        taskLabel: timerTaskLabel,
        category: timerCategory,
      });
      updateTrayIcon(persistence.getUser()!, elapsed, true);
    }
  }, 1000);
}

function pauseTimer() {
  if (timerIsRunning && !timerIsPaused && timerStartTime) {
    timerAccumulatedTime += (Date.now() - timerStartTime.getTime()) / 1000;
    timerStartTime = null;
    timerIsPaused = true;
    broadcastToWindows(IPC.TIMER_UPDATE, {
      elapsed: timerAccumulatedTime,
      isRunning: true,
      isPaused: true,
      taskLabel: timerTaskLabel,
      category: timerCategory,
    });
  }
}

function resumeTimer() {
  if (timerIsPaused) {
    timerStartTime = new Date();
    timerIsPaused = false;
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
  timerAccumulatedTime = 0;
  timerIsPaused = false;
  timerIsRunning = false;
  timerTaskLabel = '';
  timerCategory = undefined;

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
    }
  });

  ipcMain.on(IPC.UPDATE_USER, (_e, updates: Partial<User>) => {
    const user = persistence.getUser();
    if (user) {
      Object.assign(user, updates);
      persistence.saveUser(user);
      networking?.updateUser(user);
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
  ipcMain.on(IPC.START_TIMER, (_e, data: { taskLabel: string; category?: string }) => {
    startTimer(data.taskLabel, data.category);
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
  ipcMain.on(IPC.OPEN_DASHBOARD, () => {
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

  // Check for update (manual)
  ipcMain.handle('app:check-for-update', async () => {
    checkForUpdate();
  });

  // Categories
  ipcMain.handle('data:get-categories', () => {
    return persistence.getCategories();
  });
  ipcMain.handle('data:save-categories', (_e, categories: string[]) => {
    persistence.saveCategories(categories);
    return true;
  });

  // Avatar photo picker
  ipcMain.handle('dialog:pick-avatar-image', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    const fileData = fs.readFileSync(filePath);
    const img = nativeImage.createFromBuffer(fileData);
    const resized = img.resize({ width: 128, height: 128 });
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
