import { app, BrowserWindow, ipcMain, globalShortcut, Notification, nativeImage, dialog, powerMonitor } from 'electron';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createTray, updateTrayIcon } from './tray';
import { createPopoverWindow, createDashboardWindow, createAlertWindow, createMiniTimerWindow } from './windows';
import { NetworkingService } from './networking/NetworkingService';
import { PersistenceService } from './services/persistence';
import { TimeTracker } from './services/timeTracker';
import { setupUpdater, checkForUpdate } from './updater';
import { IPC, AvailabilityStatus, User, MessageType, AppSettings, PinnedTodo } from '../shared/types';
import { LicenseManager } from './services/licenseManager';
import { BasecampService } from './services/basecamp';

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
let miniTimerWindow: BrowserWindow | null = null;
let networking: NetworkingService | null = null;

const persistence = new PersistenceService();
const timeTracker = new TimeTracker(persistence);
const licenseManager = new LicenseManager();
const basecamp = new BasecampService();

// Timer state
let timerInterval: NodeJS.Timeout | null = null;
let timerStartTime: Date | null = null;
let timerAccumulatedTime = 0;
let timerIsPaused = false;
let timerIsRunning = false;
let timerTaskLabel = '';
let timerCategory: string | undefined;
let timerTargetDuration: number | undefined;
let timerBasecamp: { accountId: number; projectId: number; todoId: number; todoListId?: number } | undefined;
// In-progress notes the user types into the mini-timer pill while the session
// is active. Pre-fills the timesheet confirmation popup at stop time and is
// saved to the local session record either way.
let currentSessionNotes = '';
let longRunGuardFired = false;
const LONG_RUN_GUARD_SECONDS = 3 * 3600; // 3 hours — prompts the user to confirm they're still working

// Pending timesheet entry awaiting user confirmation (one at a time — only one timer can run).
// When `requireTimesheetConfirmation` is on, stopTimer parks the entry here and opens an
// alert window. The alert posts back via IPC.TIMER_TIMESHEET_CONFIRM with the user's choice.
let pendingTimesheetEntry: {
  sessionId: string;
  sessionDateStr: string;
  basecamp: { accountId: number; projectId: number; todoId: number; todoListId?: number };
  taskLabel: string;
  durationSec: number;
} | null = null;

// Track the active timesheet confirm + long-run-guard alert windows so we can
// detect close-via-X (treat as discard + notify) and force-close on sign-out.
let timesheetConfirmAlertWin: BrowserWindow | null = null;
let longRunAlertWin: BrowserWindow | null = null;

// Mini-timer pill: when the pill is near the bottom of the screen and the
// user expands the dropdown, we temporarily shift the window UP so the
// dropdown isn't drawn off-screen. On collapse we restore the original Y.
// `pillSavedY` is the user's intended position (what we persist + restore).
// `pillProgrammaticMove` suppresses the 'moved' listener's persistence while
// we're shifting programmatically, so the saved settings stay clean.
let pillSavedY: number | null = null;
let pillProgrammaticMove = false;

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
        if (dashboardWindow.isMinimized()) dashboardWindow.restore();
        dashboardWindow.show();
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

  // Start networking if user exists, or show Dashboard for onboarding
  const user = persistence.getUser();
  if (user) {
    // Sync isAdmin from license state on startup
    const licenseState = licenseManager.getLicenseState();
    user.isAdmin = licenseState.isValid && licenseState.isAdmin;
    persistence.saveUser(user);
    startNetworking(user);
  } else {
    // First launch — open Dashboard for onboarding instead of the tiny popover
    dashboardWindow = createDashboardWindow(getRendererURL('dashboard.html'));
    if (process.platform === 'darwin') app.dock?.show();
    dashboardWindow.on('closed', () => {
      dashboardWindow = null;
      if (process.platform === 'darwin' && !popoverWindow?.isVisible()) {
        app.dock?.hide();
      }
    });
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

  // Onboarding gate — until the user has finished the dashboard signup form,
  // suppress the popover entirely and route the tray click to the dashboard
  // window instead. Otherwise the user sees a duplicate LoginView in the
  // popover, types into one, and the other one stays stuck on a stale form.
  if (!persistence.getUser()) {
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
      if (dashboardWindow.isMinimized()) dashboardWindow.restore();
      dashboardWindow.show();
      dashboardWindow.focus();
    }
    return;
  }

  if (popoverWindow.isVisible()) {
    popoverWindow.hide();
    return;
  }

  // Position near tray icon
  const { positionPopover } = require('./tray');
  positionPopover(popoverWindow);

  // Re-assert NSPanel visibility settings on every show — macOS resets
  // `visibleOnFullScreen` after some Space transitions, which is why the
  // popover sometimes vanishes (it's on a different Space, not gone).
  // Setting these right before show() pins it to the *current* Space.
  if (process.platform === 'darwin') {
    popoverWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    popoverWindow.setAlwaysOnTop(true, 'screen-saver');
  }

  popoverWindow.show();
  popoverWindow.focus();
  // Nudge the popover renderer to re-fetch its data. Covers two edge cases:
  // (1) midnight rollover happened while the app was idle, so the cached
  //     todayPlan in the renderer is stale.
  // (2) any change broadcast that arrived while the popover was hidden but
  //     before its listener was attached on first open.
  popoverWindow.webContents.send('popover:shown');
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

  networking.on('quickPing', (data: { senderId: string; senderName: string; message: string; timestamp: string }) => {
    handleIncomingPing(data);
  });

  networking.start();

  // Handle system sleep/wake — network interfaces change after resume
  powerMonitor.removeAllListeners('suspend');
  powerMonitor.removeAllListeners('resume');
  powerMonitor.removeAllListeners('lock-screen');
  powerMonitor.removeAllListeners('unlock-screen');

  powerMonitor.on('suspend', () => {
    console.log('System suspending — tearing down local network advertising');
    networking?.prepareForSuspend();
    autoPauseTimer('suspend');
  });

  powerMonitor.on('resume', () => {
    console.log('System resumed — triggering network restart');
    networking?.handleSystemResume();
    notifyTimerPausedOnResume();
  });

  powerMonitor.on('lock-screen', () => {
    autoPauseTimer('lock');
  });

  powerMonitor.on('unlock-screen', () => {
    notifyTimerPausedOnResume();
  });
}

// Pause the running timer with a tagged reason. Idempotent — safe to call when
// no timer is active. The renderer learns of it via the standard TIMER_AUTO_PAUSED
// event with a `reason` field so the popover can show context.
function autoPauseTimer(reason: 'suspend' | 'lock' | 'idle' | 'focus-loss') {
  if (timerIsRunning && !timerIsPaused) {
    pauseTimer();
    broadcastToWindows(IPC.TIMER_AUTO_PAUSED, { reason });
  }
}

// On resume/unlock, if the timer is paused, fire a system notification so the
// user can choose to resume from the OS notification center instead of opening
// the popover.
function notifyTimerPausedOnResume() {
  if (timerIsPaused && timerTaskLabel) {
    new Notification({
      title: 'ZenState timer paused',
      body: `"${timerTaskLabel}" is waiting — open ZenState to resume.`,
    }).show();
  }
}

function broadcastToWindows(channel: string, data: unknown) {
  try {
    if (popoverWindow && !popoverWindow.isDestroyed()) {
      popoverWindow.webContents.send(channel, data);
    }
  } catch (err) {
    console.warn(`Failed to send ${channel} to popover:`, err);
  }
  try {
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
      dashboardWindow.webContents.send(channel, data);
    }
  } catch (err) {
    console.warn(`Failed to send ${channel} to dashboard:`, err);
  }
  try {
    if (miniTimerWindow && !miniTimerWindow.isDestroyed()) {
      miniTimerWindow.webContents.send(channel, data);
    }
  } catch (err) {
    console.warn(`Failed to send ${channel} to mini-timer:`, err);
  }
}

// Show or hide the floating mini-timer pill based on whether a timer is active
// AND the user's preference. Called from startTimer (show) and stopTimer (hide).
function showMiniTimer() {
  const settings = persistence.getSettings();
  if (settings.miniTimerEnabled === false) return; // explicit opt-out
  if (!miniTimerWindow || miniTimerWindow.isDestroyed()) {
    const pos = (settings.miniTimerX !== undefined && settings.miniTimerY !== undefined)
      ? { x: settings.miniTimerX, y: settings.miniTimerY }
      : undefined;
    miniTimerWindow = createMiniTimerWindow(getRendererURL('mini-timer.html'), pos);

    // Show only after the renderer has finished its first paint, so the
    // window doesn't appear blank/invisible before React mounts.
    miniTimerWindow.once('ready-to-show', () => {
      miniTimerWindow?.show();
      // Re-broadcast the latest timer state so the freshly-mounted renderer
      // has something to display immediately (the TIMER_UPDATE that fired
      // at startTimer-time happened before this window existed).
      pushTimerStateToMiniTimer();
    });

    miniTimerWindow.on('moved', () => {
      if (!miniTimerWindow || miniTimerWindow.isDestroyed()) return;
      // Skip persistence when we just moved the window programmatically
      // (the "shift up to fit the dropdown" case) — otherwise the shifted
      // position would become the new saved default.
      if (pillProgrammaticMove) return;
      const [x, y] = miniTimerWindow.getPosition();
      const s = persistence.getSettings();
      persistence.saveSettings({ ...s, miniTimerX: x, miniTimerY: y });
    });
    miniTimerWindow.on('closed', () => { miniTimerWindow = null; });
    return; // first show happens via ready-to-show
  }
  // Window already exists — show immediately.
  miniTimerWindow.show();
  pushTimerStateToMiniTimer();
}

function pushTimerStateToMiniTimer() {
  if (!miniTimerWindow || miniTimerWindow.isDestroyed()) return;
  const elapsed = timerStartTime
    ? timerAccumulatedTime + (Date.now() - timerStartTime.getTime()) / 1000
    : timerAccumulatedTime;
  miniTimerWindow.webContents.send(IPC.TIMER_UPDATE, {
    elapsed,
    isRunning: timerIsRunning,
    isPaused: timerIsPaused,
    taskLabel: timerTaskLabel,
    category: timerCategory,
    targetDuration: timerTargetDuration,
  });
}

function hideMiniTimer() {
  if (miniTimerWindow && !miniTimerWindow.isDestroyed()) {
    miniTimerWindow.hide();
  }
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
// Meeting mode: when on, idle pause is suppressed for the active session.
// Cleared on stopTimer. Renderer can toggle via TIMER_SET_MEETING_MODE.
let meetingModeActive = false;
// Tracks the open "still working?" idle prompt alert so we can dismiss it
// on activity resumption + close it on sign-out / stop.
let idlePromptAlertWin: BrowserWindow | null = null;
let idlePromptResponded = false;

function startIdleDetection(thresholdSeconds: number) {
  stopIdleDetection();
  idleCheckInterval = setInterval(() => {
    if (!timerIsRunning || timerIsPaused) return;
    if (meetingModeActive) return; // Suppressed during meetings
    if (idlePromptAlertWin) return; // Already prompting — don't open a second one
    const idleTime = powerMonitor.getSystemIdleTime();
    if (idleTime >= thresholdSeconds) {
      // Don't silently pause. Show a prompt the user can dismiss as
      // "still working" (with optional Meeting mode), pause now, or
      // backdate the stop to their last keyboard activity.
      showIdlePromptAlert(idleTime);
    }
  }, 10000); // Check every 10 seconds
}

function stopIdleDetection() {
  if (idleCheckInterval) {
    clearInterval(idleCheckInterval);
    idleCheckInterval = null;
  }
}

function showIdlePromptAlert(idleTime: number) {
  const alertWin = createAlertWindow(getRendererURL('alert.html'), {
    width: 400,
    height: 360,
  });
  idlePromptAlertWin = alertWin;
  idlePromptResponded = false;
  alertWin.webContents.once('did-finish-load', () => {
    alertWin.webContents.send('alert-data', {
      type: 'idlePrompt',
      from: timerTaskLabel,
      senderId: '',
      elapsedSeconds: idleTime,
      lastActivityAt: lastActivityIsoTime(),
    });
  });
  // If the user dismisses without picking, treat as "continue working" —
  // safer default than silent pause. Reset so we can prompt again later.
  alertWin.on('closed', () => {
    if (idlePromptAlertWin === alertWin) idlePromptAlertWin = null;
    // If no explicit response came in, do nothing (timer keeps running).
    // We don't re-arm anything because the next idle-check tick will
    // re-evaluate naturally.
    void idlePromptResponded;
  });
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

// ── Quick Ping (team-wide notification) ───────────────────────
// Pings live in main-process memory + are forwarded to renderers + a native
// macOS notification fires. We keep up to 20 recent pings so a user who
// returns to their desk can catch up on what they missed.
const RECENT_PINGS_MAX = 20;
const RECENT_PINGS_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
let recentPings: Array<{ id: string; senderId: string; senderName: string; message: string; timestamp: string }> = [];

function pruneRecentPings() {
  const cutoff = Date.now() - RECENT_PINGS_TTL_MS;
  recentPings = recentPings.filter((p) => new Date(p.timestamp).getTime() >= cutoff);
}

function handleIncomingPing(data: { senderId: string; senderName: string; message: string; timestamp: string }) {
  pruneRecentPings();
  const ping = {
    id: crypto.randomUUID(),
    senderId: data.senderId,
    senderName: data.senderName,
    message: data.message,
    timestamp: data.timestamp,
  };
  recentPings = [ping, ...recentPings].slice(0, RECENT_PINGS_MAX);

  // Native notification — visible across full-screen apps, plays a sound by default.
  try {
    new Notification({
      title: data.senderName,
      body: data.message,
      silent: false,
    }).show();
  } catch (err) {
    console.warn('Failed to show ping notification:', err);
  }

  broadcastToWindows(IPC.TEAM_PING_RECEIVED, ping);
}

// ── Timer Logic ────────────────────────────────────────────────

function startTimer(taskLabel: string, category?: string, targetDuration?: number, basecampLink?: { accountId: number; projectId: number; todoId: number; todoListId?: number; projectName?: string }) {
  timerTaskLabel = taskLabel;
  timerCategory = category;
  timerTargetDuration = targetDuration;
  // Strip the projectName off the persisted timer state — it's only needed for
  // the recents push and would otherwise leak into the session record.
  timerBasecamp = basecampLink ? {
    accountId: basecampLink.accountId,
    projectId: basecampLink.projectId,
    todoId: basecampLink.todoId,
    todoListId: basecampLink.todoListId,
  } : undefined;
  timerStartTime = new Date();
  timerAccumulatedTime = 0;
  timerIsPaused = false;
  timerIsRunning = true;
  currentSessionNotes = '';
  longRunGuardFired = false;
  meetingModeActive = false; // Meeting mode is per-session; reset for a fresh start
  broadcastToWindows(IPC.TIMER_MEETING_MODE_CHANGED, false);
  showMiniTimer();

  // Bump recents so the popover's quick-pick row stays useful.
  if (basecampLink && basecampLink.todoListId !== undefined) {
    persistence.pushRecentTodo({
      todoId: basecampLink.todoId,
      projectId: basecampLink.projectId,
      todoListId: basecampLink.todoListId,
      accountId: basecampLink.accountId,
      content: taskLabel,
      projectName: basecampLink.projectName ?? '',
    });
  }

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
      // Don't bang-assert the user — sign-out may have just nulled it while
      // the interval was already scheduled. Skip the tray update in that
      // racing window; stopTimer's reset will clear the tray on next tick.
      const tickUser = persistence.getUser();
      if (tickUser) updateTrayIcon(tickUser, elapsed, true);

      // Long-run guard — once per session, prompt the user when they cross
      // the threshold so a forgotten timer can't quietly pollute the timesheet.
      if (!longRunGuardFired && elapsed >= LONG_RUN_GUARD_SECONDS) {
        longRunGuardFired = true;
        showLongRunAlert(elapsed);
      }

      // Countdown complete
      if (timerTargetDuration && remaining !== undefined && remaining <= 0) {
        handleCountdownComplete();
      }
    }
  }, 1000);
}

// Compute when the user last had keyboard/mouse activity. Used to back-date
// the timer stop time when they choose "Walked away at..." in the long-run alert.
function lastActivityIsoTime(): string {
  const idleSec = powerMonitor.getSystemIdleTime();
  return new Date(Date.now() - idleSec * 1000).toISOString();
}

// Tracks whether the open long-run alert already received a Continue/Stop/
// Backdate response, so the window's `closed` event (which fires AFTER the
// IPC response calls window.close()) doesn't re-treat it as a dismiss.
let longRunResponded = false;

function showLongRunAlert(elapsedSeconds: number) {
  const alertWin = createAlertWindow(getRendererURL('alert.html'), {
    width: 380,
    height: 320,
  });
  longRunAlertWin = alertWin;
  longRunResponded = false;
  alertWin.webContents.once('did-finish-load', () => {
    alertWin.webContents.send('alert-data', {
      type: 'longRunGuard',
      from: timerTaskLabel,
      senderId: '',
      elapsedSeconds,
      lastActivityAt: lastActivityIsoTime(),
    });
  });
  // If the user dismisses the alert with the OS X without picking an option,
  // treat it as "continue working" (least-destructive default) and reset the
  // guard so the prompt can re-fire after another threshold's worth of time.
  // Skip the reset when an explicit response was already handled — otherwise
  // a "Stop" / "Walked away" response would fall through here and re-arm the
  // guard against a now-stopped timer.
  alertWin.on('closed', () => {
    if (longRunAlertWin === alertWin) longRunAlertWin = null;
    if (longRunResponded) return;
    if (timerIsRunning) longRunGuardFired = false;
  });
}

function showTimesheetConfirmAlert(taskLabel: string, durationSec: number, notes?: string) {
  const alertWin = createAlertWindow(getRendererURL('alert.html'), {
    width: 400,
    height: 460,
  });
  timesheetConfirmAlertWin = alertWin;
  alertWin.webContents.once('did-finish-load', () => {
    alertWin.webContents.send('alert-data', {
      type: 'timesheetConfirm',
      from: taskLabel,
      senderId: '',
      elapsedSeconds: durationSec,
      // Notes typed into the pill ride along as `message` — AlertView reads
      // this into TimesheetConfirmPanel's `defaultNotes` so the user doesn't
      // have to retype what they jotted down mid-session.
      message: notes,
    });
  });
  // If the user dismisses the alert with Cmd+W / Alt+F4 / system X without
  // picking Post or Discard, the local session was already saved with
  // synced=false. Drop the pending entry and fire a native notification so
  // the user knows to use Settings → Backfill if they want it on Basecamp.
  alertWin.on('closed', () => {
    if (timesheetConfirmAlertWin === alertWin) timesheetConfirmAlertWin = null;
    if (pendingTimesheetEntry) {
      const dropped = pendingTimesheetEntry;
      pendingTimesheetEntry = null;
      try {
        new Notification({
          title: 'Session saved locally',
          body: `"${dropped.taskLabel}" wasn't sent to Basecamp. Use Settings → Backfill to sync later.`,
          silent: false,
        }).show();
      } catch (err) {
        console.warn('Failed to show timesheet-dropped notification:', err);
      }
    }
  });
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

  // Capture state and flip the running flag immediately so a concurrent caller
  // (e.g. countdown-complete firing while the user clicks Stop) early-returns
  // at the guard above instead of double-saving the session.
  const capturedTaskLabel = timerTaskLabel;
  const capturedCategory = timerCategory;
  const capturedBasecamp = timerBasecamp;
  const capturedNotes = currentSessionNotes.trim();
  const wasPaused = timerIsPaused;
  timerIsRunning = false;
  timerIsPaused = false;

  let totalDuration = timerAccumulatedTime;
  if (timerStartTime && !wasPaused) {
    totalDuration += (Date.now() - timerStartTime.getTime()) / 1000;
  }

  // Save session — persist the Basecamp link so we can mark it synced later
  // (and so it can be backfilled if the push fails or was never attempted).
  const saved = timeTracker.addSession({
    taskLabel: capturedTaskLabel,
    category: capturedCategory,
    duration: totalDuration,
    startTime: new Date(Date.now() - totalDuration * 1000).toISOString(),
    endTime: new Date().toISOString(),
    basecamp: capturedBasecamp ? { ...capturedBasecamp, synced: false } : undefined,
  });

  // If the user jotted notes into the pill during the session, persist them
  // on the local record now — independent of the Basecamp confirm flow, so
  // sessions without a Basecamp link still keep the notes.
  if (capturedNotes) {
    timeTracker.updateSession(saved.sessionId, saved.dateStr, { notes: capturedNotes });
  }

  // Decide what to do with the elapsed time on the Basecamp side.
  // - sub-minute sessions: never sync (noise)
  // - confirmation off: keep legacy auto-post behavior
  // - confirmation on: park the entry as pending and open the confirmation alert.
  //   The session is already saved locally with synced=false, so a Discard
  //   leaves it as un-synced data the user can backfill later if they change their mind.
  if (capturedBasecamp && totalDuration >= 60) {
    const settings = persistence.getSettings();
    const link = capturedBasecamp;

    if (settings.requireTimesheetConfirmation) {
      pendingTimesheetEntry = {
        sessionId: saved.sessionId,
        sessionDateStr: saved.dateStr,
        basecamp: link,
        taskLabel: capturedTaskLabel,
        durationSec: totalDuration,
      };
      showTimesheetConfirmAlert(capturedTaskLabel, totalDuration, capturedNotes);
    } else {
      const hours = (totalDuration / 3600).toFixed(2);
      const date = isoDateLocal(new Date());
      // If the user wrote notes mid-session, use them as the timesheet entry
      // description — same convention as the confirm-popup path.
      const description = capturedNotes || capturedTaskLabel;
      basecamp.api.createTimesheetEntry({
        todoId: link.todoId,
        date,
        hours,
        description,
      }).then(() => {
        timeTracker.markSessionSynced(saved.sessionId, saved.dateStr);
        broadcastToWindows('basecamp:timesheet-updated', { projectId: link.projectId, todoId: link.todoId });
      }).catch((err) => console.warn('Failed to create Basecamp timesheet entry:', err));
    }
  }

  // Reset (timerIsRunning + timerIsPaused already flipped at the top to make
  // stopTimer re-entrancy-safe).
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
  timerStartTime = null;
  clearBreakReminder();
  stopIdleDetection();
  timerAccumulatedTime = 0;
  timerTaskLabel = '';
  timerCategory = undefined;
  timerTargetDuration = undefined;
  timerBasecamp = undefined;
  currentSessionNotes = '';
  if (meetingModeActive) {
    meetingModeActive = false;
    broadcastToWindows(IPC.TIMER_MEETING_MODE_CHANGED, false);
  }
  if (idlePromptAlertWin && !idlePromptAlertWin.isDestroyed()) {
    idlePromptAlertWin.destroy();
  }
  idlePromptAlertWin = null;

  broadcastToWindows(IPC.TIMER_UPDATE, {
    elapsed: 0,
    isRunning: false,
    isPaused: false,
    taskLabel: '',
  });

  hideMiniTimer();

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
  ipcMain.on(IPC.START_TIMER, (_e, data: { taskLabel: string; category?: string; targetDuration?: number; basecamp?: { accountId: number; projectId: number; todoId: number; todoListId?: number; projectName?: string } }) => {
    startTimer(data.taskLabel, data.category, data.targetDuration, data.basecamp);
  });
  ipcMain.on(IPC.STOP_TIMER, () => stopTimer());
  ipcMain.on(IPC.PAUSE_TIMER, () => pauseTimer());
  ipcMain.on(IPC.RESUME_TIMER, () => resumeTimer());

  // Pre-flight Basecamp timesheet confirmation. Renderer sends back the user's
  // chosen action (post or discard) plus an optional edited hours value.
  // - post:    create the entry, mark the local session synced, refresh badges
  // - discard: leave the local session unsynced; the user can backfill later
  ipcMain.on(IPC.TIMER_TIMESHEET_CONFIRM, async (_e, payload: { action: 'post' | 'discard'; hours?: string; notes?: string }) => {
    const pending = pendingTimesheetEntry;
    if (!pending) return;
    pendingTimesheetEntry = null;

    if (payload.action === 'discard') return;

    const link = pending.basecamp;
    const hours = payload.hours && /^\d+(\.\d+)?$/.test(payload.hours)
      ? payload.hours
      : (pending.durationSec / 3600).toFixed(2);
    const date = isoDateLocal(new Date());
    // The user-typed notes become the timesheet entry's description (the field
    // Basecamp displays next to hours on the timesheet view). Fall back to the
    // task label only if no notes were provided, so the entry isn't description-less.
    const trimmedNotes = (payload.notes ?? '').trim();
    const description = trimmedNotes || pending.taskLabel;

    try {
      await basecamp.api.createTimesheetEntry({
        todoId: link.todoId,
        date,
        hours,
        description,
      });
      timeTracker.markSessionSynced(pending.sessionId, pending.sessionDateStr);
      // Also persist the notes locally on the session so they show up in the
      // Timesheet tab and survive a future re-sync.
      if (trimmedNotes) {
        timeTracker.updateSession(pending.sessionId, pending.sessionDateStr, { notes: trimmedNotes });
      }
      broadcastToWindows('basecamp:timesheet-updated', { projectId: link.projectId, todoId: link.todoId });
    } catch (err) {
      console.warn('Failed to create confirmed Basecamp timesheet entry:', err);
    }
  });

  // Long-run guard alert response — user confirms they're still working,
  // explicitly stops now, or back-dates the stop to their last keyboard activity.
  ipcMain.on(IPC.TIMER_LONG_RUN_RESPONSE, (_e, payload: { action: 'continue' | 'stop' | 'backdate'; stopAtIso?: string }) => {
    // Mark that we got an explicit response so the alert window's close
    // handler doesn't re-treat the close as a dismiss + re-arm the guard.
    longRunResponded = true;
    if (!timerIsRunning) return;
    if (payload.action === 'continue') return; // keep running, alert dismisses itself
    if (payload.action === 'stop') {
      stopTimer();
      return;
    }
    if (payload.action === 'backdate' && payload.stopAtIso) {
      // Recompute the elapsed duration as if the user had stopped at the
      // back-dated moment, then call stopTimer() so the existing save+sync
      // pipeline runs unchanged.
      const stopAt = new Date(payload.stopAtIso).getTime();
      const startWall = timerStartTime ? timerStartTime.getTime() - timerAccumulatedTime * 1000 : Date.now();
      const correctedDuration = Math.max(0, (stopAt - startWall) / 1000);
      timerAccumulatedTime = correctedDuration;
      timerStartTime = null; // freeze elapsed at the corrected value
      stopTimer();
    }
  });

  // Idle prompt response — user chooses to keep working (optionally with
  // Meeting mode on), pause now, or backdate the stop to their last
  // keyboard activity. Mirrors the long-run guard pattern.
  ipcMain.on(IPC.TIMER_IDLE_RESPONSE, (_e, payload: { action: 'continue' | 'pause' | 'backdate'; stopAtIso?: string; enableMeetingMode?: boolean }) => {
    idlePromptResponded = true;
    if (!timerIsRunning) return;
    if (payload.action === 'continue') {
      // If the user enabled Meeting mode in the prompt, set it now so
      // the next idle-check tick doesn't immediately re-prompt.
      if (payload.enableMeetingMode) {
        meetingModeActive = true;
        broadcastToWindows(IPC.TIMER_MEETING_MODE_CHANGED, true);
      }
      return;
    }
    if (payload.action === 'pause') {
      pauseTimer();
      broadcastToWindows(IPC.TIMER_AUTO_PAUSED, { reason: 'idle-confirmed' });
      return;
    }
    if (payload.action === 'backdate' && payload.stopAtIso) {
      const stopAt = new Date(payload.stopAtIso).getTime();
      const startWall = timerStartTime ? timerStartTime.getTime() - timerAccumulatedTime * 1000 : Date.now();
      const correctedDuration = Math.max(0, (stopAt - startWall) / 1000);
      timerAccumulatedTime = correctedDuration;
      timerStartTime = null;
      stopTimer();
    }
  });

  // Meeting mode toggle from the pill's expanded panel. Per-session flag —
  // cleared on stopTimer (in startTimer too, so a fresh session starts off).
  ipcMain.on(IPC.TIMER_SET_MEETING_MODE, (_e, on: boolean) => {
    meetingModeActive = !!on;
    broadcastToWindows(IPC.TIMER_MEETING_MODE_CHANGED, meetingModeActive);
  });

  // Time tracking data
  ipcMain.handle(IPC.GET_RECORDS, (_e, month?: string) => {
    if (month) return timeTracker.getRecordsForMonth(month);
    return timeTracker.getAllRecords();
  });
  ipcMain.handle(IPC.DELETE_SESSION, (_e, data: { sessionId: string; date: string }) => {
    timeTracker.deleteSession(data.sessionId, data.date);
    return true;
  });
  ipcMain.handle(IPC.UPDATE_SESSION, (_e, data: { sessionId: string; date: string; updates: Parameters<typeof timeTracker.updateSession>[2] }) => {
    timeTracker.updateSession(data.sessionId, data.date, data.updates);
    return true;
  });

  // Manual session add — for "+ Add session" / "Log time" flows. Different
  // from `stopTimer`'s implicit add in that the user explicitly typed the
  // duration, so we skip the confirm popup and post to Basecamp directly
  // (if the entry has a Basecamp link + meets the sub-minute floor).
  ipcMain.handle(IPC.ADD_SESSION, async (_e, data: { taskLabel: string; duration: number; startTime: string; notes?: string; basecamp?: { accountId: number; projectId: number; todoId: number; todoListId?: number } | null }) => {
    try {
      if (!data.taskLabel?.trim()) return { ok: false, error: 'Task label required' };
      if (!Number.isFinite(data.duration) || data.duration <= 0) return { ok: false, error: 'Duration must be greater than zero' };
      const start = new Date(data.startTime);
      if (Number.isNaN(start.getTime())) return { ok: false, error: 'Invalid start time' };
      const endTime = new Date(start.getTime() + data.duration * 1000).toISOString();
      const trimmedNotes = (data.notes ?? '').trim();
      const link = data.basecamp ?? undefined;
      const saved = timeTracker.addSession({
        taskLabel: data.taskLabel.trim(),
        duration: data.duration,
        startTime: start.toISOString(),
        endTime,
        notes: trimmedNotes || undefined,
        basecamp: link ? { ...link, synced: false } : undefined,
      });

      // Auto-post to Basecamp when the entry is linked + >= 1 minute. No
      // confirm popup — the user already typed the duration. If the post
      // fails, the session stays unsynced and Backfill picks it up.
      if (link && data.duration >= 60) {
        const hours = (data.duration / 3600).toFixed(2);
        const date = isoDateLocal(start);
        const description = trimmedNotes || data.taskLabel.trim();
        basecamp.api.createTimesheetEntry({
          todoId: link.todoId,
          date,
          hours,
          description,
        }).then(() => {
          timeTracker.markSessionSynced(saved.sessionId, saved.dateStr);
          broadcastToWindows('basecamp:timesheet-updated', { projectId: link.projectId, todoId: link.todoId });
        }).catch((err) => console.warn('Manual session: Basecamp post failed (Backfill will retry):', err));
      }

      return { ok: true, sessionId: saved.sessionId, dateStr: saved.dateStr };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
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
      if (dashboardWindow.isMinimized()) dashboardWindow.restore();
      dashboardWindow.show();
      dashboardWindow.focus();
      if (tab) {
        dashboardWindow.webContents.send('dashboard:switch-tab', tab);
      }
    }
  });

  // Open the dashboard, navigate to Plan, and auto-open the pin picker.
  // Driven from the mini-timer pill's "Pin another to-do" link — saves the
  // user a multi-step navigation when they're already in flow.
  ipcMain.on(IPC.OPEN_DASHBOARD_AND_PIN, () => {
    const navigate = (win: BrowserWindow) => {
      win.webContents.send('dashboard:switch-tab', 'plan');
      win.webContents.send('plan:open-picker');
    };
    if (!dashboardWindow || dashboardWindow.isDestroyed()) {
      dashboardWindow = createDashboardWindow(getRendererURL('dashboard.html'));
      if (process.platform === 'darwin') app.dock?.show();
      dashboardWindow.on('closed', () => {
        dashboardWindow = null;
        if (process.platform === 'darwin' && !popoverWindow?.isVisible()) {
          app.dock?.hide();
        }
      });
      // Fire navigation + picker open once the renderer is ready to receive.
      dashboardWindow.webContents.once('did-finish-load', () => {
        if (dashboardWindow) navigate(dashboardWindow);
      });
    } else {
      if (dashboardWindow.isMinimized()) dashboardWindow.restore();
      dashboardWindow.show();
      dashboardWindow.focus();
      navigate(dashboardWindow);
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
    // Re-register global shortcuts here too — sign-out unregisters them, and
    // a fresh app start hits the registerShortcuts() call from app.on('ready'),
    // but the sign-out → sign-in path on the same process needs a manual nudge.
    registerShortcuts();
    // Default Launch at Login to ON for new users
    app.setLoginItemSettings({ openAtLogin: true });
    // Notify the other window — the popover and dashboard each render their
    // own LoginView when currentUser is null, so when one of them logs in the
    // other needs to refresh its state instead of staying stuck on the form.
    broadcastToWindows('user:logged-in', user);
  });

  // Sign out — comprehensively tear down per-user state so a different user
  // signing in on the same machine doesn't inherit Basecamp tokens, pinned
  // todos, recent pings, in-flight timers, or registered global shortcuts.
  ipcMain.on('user:sign-out', () => {
    // Persist any in-progress timer session before tearing down state.
    if (timerIsRunning || timerIsPaused) {
      stopTimer();
    }
    // Drop any pending timesheet confirmation; the local session was already
    // saved with synced=false so it can still be backfilled if reconnected.
    pendingTimesheetEntry = null;
    currentSessionNotes = '';
    longRunGuardFired = false;

    // Force-close any open modal alerts so they don't bleed into the next
    // user's session (timesheet confirm, long-run guard, meeting requests).
    if (timesheetConfirmAlertWin && !timesheetConfirmAlertWin.isDestroyed()) {
      timesheetConfirmAlertWin.destroy();
    }
    timesheetConfirmAlertWin = null;
    if (longRunAlertWin && !longRunAlertWin.isDestroyed()) {
      longRunAlertWin.destroy();
    }
    longRunAlertWin = null;
    if (idlePromptAlertWin && !idlePromptAlertWin.isDestroyed()) {
      idlePromptAlertWin.destroy();
    }
    idlePromptAlertWin = null;
    meetingModeActive = false;

    // Stop background timers tied to user state.
    cancelStatusRevertTimer();
    clearBreakReminder();
    stopIdleDetection();

    // Clear in-memory ping history and hide the floating pill.
    recentPings = [];
    if (miniTimerWindow && !miniTimerWindow.isDestroyed()) {
      miniTimerWindow.hide();
    }

    // Disconnect Basecamp — this wipes the encrypted auth tokens from disk
    // so the next user needs to re-OAuth, and broadcasts authChanged so the
    // renderer reflects the disconnected state.
    try { basecamp.disconnect(); } catch (err) { console.warn('Basecamp disconnect on sign-out failed:', err); }

    // Tear down networking + delete the user profile.
    networking?.stop();
    networking = null;
    persistence.deleteUser();

    // Unregister + re-register global shortcuts so they no-op until the next
    // user actually logs in (the handlers guard on persistence.getUser() but
    // unregistering is the cleaner contract).
    globalShortcut.unregisterAll();

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

  // Reset all data — wipes everything the app persists locally so the next
  // launch is functionally identical to a fresh install.
  ipcMain.handle('data:reset-all', () => {
    // Stop a running timer first so we don't try to save a session into the
    // store we're about to clear.
    if (timerIsRunning || timerIsPaused) {
      stopTimer();
    }
    pendingTimesheetEntry = null;
    currentSessionNotes = '';
    if (timesheetConfirmAlertWin && !timesheetConfirmAlertWin.isDestroyed()) timesheetConfirmAlertWin.destroy();
    if (longRunAlertWin && !longRunAlertWin.isDestroyed()) longRunAlertWin.destroy();
    timesheetConfirmAlertWin = null;
    longRunAlertWin = null;

    cancelStatusRevertTimer();
    clearBreakReminder();
    stopIdleDetection();
    recentPings = [];
    if (miniTimerWindow && !miniTimerWindow.isDestroyed()) miniTimerWindow.hide();

    // Wipe persistence — sessions, plans, recents, groups, basecamp, license.
    // App settings are kept (notification preferences etc. aren't user-data).
    persistence.saveRecords([]);
    persistence.clearTodayAndRecents();
    for (const g of persistence.getPeerGroups()) persistence.deletePeerGroup(g.id);
    try { basecamp.disconnect(); } catch (err) { console.warn('basecamp disconnect on reset failed:', err); }
    licenseManager.deactivateLicense();
    persistence.deleteUser();

    networking?.stop();
    networking = null;
    globalShortcut.unregisterAll();
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

  // App settings
  ipcMain.handle(IPC.GET_SETTINGS, () => persistence.getSettings());
  ipcMain.handle(IPC.SAVE_SETTINGS, (_e, settings: AppSettings) => {
    persistence.saveSettings(settings);
    // Broadcast settings change to all windows so popup can update
    broadcastToWindows('settings:updated', settings);
    return true;
  });

  // Status auto-revert
  ipcMain.on(IPC.SET_STATUS_REVERT, (_e, data: { seconds: number }) => {
    setStatusRevertTimer(data.seconds);
  });

  ipcMain.on(IPC.CANCEL_STATUS_REVERT, () => {
    cancelStatusRevertTimer();
  });

  // ── Quick Ping (anyone-to-many lightweight notification) ────────
  ipcMain.handle(IPC.TEAM_SEND_PING, (_e, data: { recipientIds: string[]; message: string }) => {
    if (!networking) return { ok: false, delivered: 0, error: 'Not connected to network' };
    if (!data.message?.trim() || data.recipientIds.length === 0) {
      return { ok: false, delivered: 0, error: 'Message and at least one recipient required' };
    }
    const delivered = networking.sendQuickPing(data.recipientIds, data.message.trim());
    return { ok: true, delivered, total: data.recipientIds.length };
  });

  ipcMain.handle(IPC.TEAM_GET_RECENT_PINGS, () => {
    pruneRecentPings();
    return recentPings;
  });

  ipcMain.handle(IPC.TEAM_DISMISS_PING, (_e, pingId: string) => {
    recentPings = recentPings.filter((p) => p.id !== pingId);
    return recentPings;
  });

  // ── Peer groups ───────────────────────────────────────────────
  ipcMain.handle(IPC.GROUPS_GET, () => persistence.getPeerGroups());
  ipcMain.handle(IPC.GROUPS_SAVE, (_e, group: Parameters<typeof persistence.savePeerGroup>[0]) => persistence.savePeerGroup(group));
  ipcMain.handle(IPC.GROUPS_DELETE, (_e, groupId: string) => persistence.deletePeerGroup(groupId));

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

  // Network: manual IP connection. Only accepts private/loopback addresses
  // because ZenState peer presence is intentionally LAN-scoped — and because
  // an XSS or future untrusted-content surface in the renderer could otherwise
  // coerce main into TCP-connecting to public/intranet hosts (SSRF).
  ipcMain.handle('network:connect-ip', (_e, data: { host: string; port: number }) => {
    if (!networking) return false;
    if (typeof data.host !== 'string' || !data.host) return false;
    if (typeof data.port !== 'number' || data.port < 1024 || data.port > 65535) return false;
    if (!isPrivateOrLoopback(data.host)) {
      console.warn(`Rejecting connect-ip to non-private host: ${data.host}`);
      return false;
    }
    networking.connectToIP(data.host, data.port);
    return true;
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

  // Network: get WiFi info
  ipcMain.handle('network:get-wifi-info', async () => {
    const { execFile } = require('child_process');
    const path = require('path');

    if (process.platform === 'darwin') {
      // Use compiled Swift helper that calls CoreWLAN
      const helperPath = app.isPackaged
        ? path.join(process.resourcesPath, 'wifi-info')
        : path.join(__dirname, '../../resources/wifi-info');

      return new Promise((resolve) => {
        execFile(helperPath, { timeout: 10000 }, (err: Error | null, stdout: string) => {
          if (err) {
            resolve({ error: err.message });
            return;
          }
          try {
            resolve(JSON.parse(stdout));
          } catch {
            resolve({ error: 'Failed to parse WiFi info' });
          }
        });
      });
    } else if (process.platform === 'win32') {
      // Windows: parse netsh output
      return new Promise((resolve) => {
        execFile('netsh', ['wlan', 'show', 'interfaces'], { timeout: 10000 }, (err: Error | null, stdout: string) => {
          if (err) {
            resolve({ error: err.message });
            return;
          }
          const get = (key: string) => {
            const m = stdout.match(new RegExp(`^\\s*${key}\\s*:\\s*(.+)$`, 'm'));
            return m ? m[1].trim() : '';
          };
          const signalPercent = parseInt(get('Signal'), 10) || 0;
          // Convert Windows signal % to approximate dBm
          const rssi = signalPercent > 0 ? Math.round(signalPercent / 2 - 100) : 0;
          resolve({
            ssid: get('SSID'),
            bssid: get('BSSID'),
            rssi,
            noise: 0,
            channel: parseInt(get('Channel'), 10) || 0,
            band: get('Radio type')?.includes('802.11a') || get('Radio type')?.includes('802.11ac') || get('Radio type')?.includes('802.11ax') ? '5GHz' : '2.4GHz',
            txRate: parseFloat(get('Receive rate')) || parseFloat(get('Transmit rate')) || 0,
            security: get('Authentication'),
            phyMode: get('Radio type'),
            signalPercent,
            nearbyNetworks: [],
          });
        });
      });
    }
    return { error: 'Unsupported platform' };
  });

  // License management
  ipcMain.handle(IPC.ACTIVATE_LICENSE, (_e, key: string) => {
    const state = licenseManager.activateLicense(key);
    // Sync isAdmin flag to user profile
    const user = persistence.getUser();
    if (user) {
      user.isAdmin = state.isValid && state.isAdmin;
      persistence.saveUser(user);
      networking?.updateUser(user);
      broadcastToWindows(IPC.PEER_UPDATED, user);
    }
    broadcastToWindows('license:changed', state);
    return state;
  });

  ipcMain.handle(IPC.GET_LICENSE_STATE, () => {
    return licenseManager.getLicenseState();
  });

  ipcMain.handle(IPC.DEACTIVATE_LICENSE, () => {
    licenseManager.deactivateLicense();
    const state = licenseManager.getLicenseState();
    // Revoke admin when license is deactivated
    const user = persistence.getUser();
    if (user) {
      user.isAdmin = false;
      persistence.saveUser(user);
      networking?.updateUser(user);
      broadcastToWindows(IPC.PEER_UPDATED, user);
    }
    broadcastToWindows('license:changed', state);
    return state;
  });

  // ── Basecamp ──────────────────────────────────────────────────
  basecamp.on('authChanged', (state) => {
    broadcastToWindows(IPC.BC_AUTH_CHANGED, state);
  });
  basecamp.on('reauthRequired', () => {
    // Forced disconnect from a 401 → refresh-failed cascade. Tell the
    // renderer to surface a persistent banner, and fire a native
    // notification so users notice even with the dashboard closed.
    broadcastToWindows('basecamp:reauth-required', {});
    try {
      new Notification({
        title: 'Basecamp session expired',
        body: 'Reconnect in Settings to keep syncing your timesheet.',
        silent: false,
      }).show();
    } catch (err) {
      console.warn('Failed to show reauth notification:', err);
    }
  });

  // Node's fetch hides the real reason inside `err.cause` and only surfaces
  // "fetch failed" via err.message. Walk the cause chain so the renderer
  // shows something diagnosable (e.g. "ENOTFOUND 3.basecampapp.com").
  const describeError = (err: unknown, label: string): string => {
    console.error(`[Basecamp] ${label}:`, err);
    const e = err as Error & { cause?: { message?: string; code?: string } };
    if (e.cause) {
      const c = e.cause;
      const detail = [c.code, c.message].filter(Boolean).join(': ');
      if (detail) return `${e.message} (${detail})`;
    }
    return e.message || 'Unknown error';
  };

  ipcMain.handle(IPC.BC_GET_CREDENTIALS, () => basecamp.getCredentials());
  ipcMain.handle(IPC.BC_SAVE_CREDENTIALS, (_e, creds: { clientId: string; clientSecret: string }) => {
    basecamp.saveCredentials(creds);
    return true;
  });
  ipcMain.handle(IPC.BC_GET_AUTH_STATE, () => basecamp.getAuthState());
  ipcMain.handle(IPC.BC_CONNECT, async () => {
    try {
      await basecamp.connect();
      return { ok: true, state: basecamp.getAuthState() };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });
  ipcMain.handle(IPC.BC_CANCEL_CONNECT, () => {
    basecamp.oauth.cancelConnect();
    return true;
  });
  ipcMain.handle(IPC.BC_DISCONNECT, () => {
    basecamp.disconnect();
    return basecamp.getAuthState();
  });

  ipcMain.handle(IPC.BC_LIST_PROJECTS, async () => {
    try {
      return { ok: true, data: await basecamp.api.listProjects() };
    } catch (err) {
      return { ok: false, error: describeError(err, 'listProjects') };
    }
  });
  ipcMain.handle(IPC.BC_LIST_TODO_LISTS, async (_e, data: { projectId: number; todoSetId: number }) => {
    try {
      return { ok: true, data: await basecamp.api.listTodoLists(data.projectId, data.todoSetId) };
    } catch (err) {
      return { ok: false, error: describeError(err, 'listTodoLists') };
    }
  });
  ipcMain.handle(IPC.BC_LIST_TODOS, async (_e, data: { projectId: number; todoListId: number }) => {
    try {
      return { ok: true, data: await basecamp.api.listTodos(data.projectId, data.todoListId) };
    } catch (err) {
      return { ok: false, error: describeError(err, 'listTodos') };
    }
  });
  ipcMain.handle(IPC.BC_CREATE_TODO, async (_e, data: { projectId: number; todoListId: number; content: string; description?: string; parentId?: number }) => {
    try {
      return { ok: true, data: await basecamp.api.createTodo(data) };
    } catch (err) {
      return { ok: false, error: describeError(err, 'createTodo') };
    }
  });
  ipcMain.handle(IPC.BC_POST_COMMENT, async (_e, data: { projectId: number; todoId: number; content: string }) => {
    try {
      await basecamp.api.postComment(data);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: describeError(err, 'postComment') };
    }
  });
  ipcMain.handle(IPC.BC_CREATE_TIME_ENTRY, async (_e, data: { todoId: number; date: string; hours: string; description?: string }) => {
    try {
      return { ok: true, data: await basecamp.api.createTimesheetEntry(data) };
    } catch (err) {
      return { ok: false, error: describeError(err, 'createTimesheetEntry') };
    }
  });
  ipcMain.handle(IPC.BC_GET_PROJECT_TIMESHEET, async (_e, data: { projectId: number }) => {
    try {
      return { ok: true, data: await basecamp.api.getProjectTimesheet(data.projectId) };
    } catch (err) {
      return { ok: false, error: describeError(err, 'getProjectTimesheet') };
    }
  });

  // One-shot backfill: scan local sessions tagged with a Basecamp todo that
  // haven't been pushed yet, group by (todoId, date), post each as a timesheet
  // entry, and mark them synced. Returns counts so the UI can report progress.
  ipcMain.handle(IPC.BC_BACKFILL_TIMESHEET, async () => {
    if (!basecamp.oauth.isConnected()) {
      return { ok: false, error: 'Basecamp is not connected' };
    }

    type Group = {
      todoId: number;
      projectId: number;
      dateStr: string; // YYYY-MM-DD
      sessions: { sessionId: string; dateStr: string; duration: number; taskLabel: string }[];
    };

    const records = persistence.getRecords();
    const groups = new Map<string, Group>();
    let totalUnsynced = 0;

    for (const rec of records) {
      const dateStr = rec.date.split('T')[0];
      for (const s of rec.sessions) {
        if (!s.basecamp || !s.basecamp.todoId) continue;
        if (s.basecamp.synced) continue;
        if (s.duration < 60) continue; // skip sub-minute sessions
        totalUnsynced++;
        const key = `${s.basecamp.todoId}|${dateStr}`;
        const g = groups.get(key) ?? {
          todoId: s.basecamp.todoId,
          projectId: s.basecamp.projectId,
          dateStr,
          sessions: [],
        };
        g.sessions.push({ sessionId: s.id, dateStr, duration: s.duration, taskLabel: s.taskLabel });
        groups.set(key, g);
      }
    }

    if (groups.size === 0) {
      return { ok: true, data: { migrated: 0, failed: 0, totalUnsynced: 0, groups: 0 } };
    }

    let migrated = 0;
    let failed = 0;
    const projectsTouched = new Set<number>();
    const failures: string[] = [];

    for (const g of groups.values()) {
      const totalSec = g.sessions.reduce((a, b) => a + b.duration, 0);
      const hours = (totalSec / 3600).toFixed(2);
      const description = g.sessions[0].taskLabel;
      try {
        await basecamp.api.createTimesheetEntry({
          todoId: g.todoId,
          date: g.dateStr,
          hours,
          description,
        });
        for (const s of g.sessions) {
          timeTracker.markSessionSynced(s.sessionId, s.dateStr);
          migrated++;
        }
        projectsTouched.add(g.projectId);
      } catch (err) {
        failed += g.sessions.length;
        failures.push(`${g.dateStr} todo ${g.todoId}: ${(err as Error).message}`);
      }
    }

    for (const projectId of projectsTouched) {
      broadcastToWindows('basecamp:timesheet-updated', { projectId });
    }

    return {
      ok: true,
      data: { migrated, failed, totalUnsynced, groups: groups.size, failures: failures.slice(0, 5) },
    };
  });

  // ── Today plan + Recents ──────────────────────────────────────
  // The Today view is a daily ritual: plan a small set of Basecamp todos in
  // the morning, work through them, see your plan-vs-reality at end of day.
  // The state lives locally and resets at midnight (handled in persistence).

  ipcMain.handle(IPC.TODAY_GET, () => {
    return {
      plan: persistence.getTodayPlan(),
      recents: persistence.getRecentTodos(),
    };
  });

  ipcMain.handle(IPC.TODAY_PIN, (_e, item: Parameters<typeof persistence.saveTodayPlan>[0]['items'][number]) => {
    const plan = persistence.getTodayPlan();
    // Idempotent: pinning a todo that's already pinned is a no-op.
    if (plan.items.some((p) => p.todoId === item.todoId)) {
      return plan;
    }
    plan.items.push(item);
    persistence.saveTodayPlan(plan);
    broadcastToWindows(IPC.TODAY_CHANGED, plan);
    return plan;
  });

  ipcMain.handle(IPC.TODAY_UNPIN, (_e, todoId: number) => {
    const plan = persistence.getTodayPlan();
    plan.items = plan.items.filter((p) => p.todoId !== todoId);
    persistence.saveTodayPlan(plan);
    broadcastToWindows(IPC.TODAY_CHANGED, plan);
    return plan;
  });

  ipcMain.handle(IPC.TODAY_REORDER, (_e, todoIds: number[]) => {
    const plan = persistence.getTodayPlan();
    const byId = new Map(plan.items.map((p) => [p.todoId, p]));
    plan.items = todoIds.map((id) => byId.get(id)).filter(Boolean) as typeof plan.items;
    persistence.saveTodayPlan(plan);
    broadcastToWindows(IPC.TODAY_CHANGED, plan);
    return plan;
  });

  ipcMain.handle(IPC.TODAY_SET_ESTIMATE, (_e, data: { todoId: number; minutes: number | null }) => {
    const plan = persistence.getTodayPlan();
    const item = plan.items.find((p) => p.todoId === data.todoId);
    if (item) {
      if (data.minutes === null) delete item.estimateMinutes;
      else item.estimateMinutes = data.minutes;
      persistence.saveTodayPlan(plan);
      broadcastToWindows(IPC.TODAY_CHANGED, plan);
    }
    return plan;
  });

  // Toggle a today item between complete and incomplete. The flag is local to
  // ZenState (we don't push it to Basecamp) — its purpose is to drive the
  // midnight rollover behaviour: completed items get dropped from the next
  // day's plan, incomplete items carry forward.
  ipcMain.handle(IPC.TODAY_TOGGLE_COMPLETE, (_e, todoId: number) => {
    const plan = persistence.getTodayPlan();
    const item = plan.items.find((p) => p.todoId === todoId);
    if (item) {
      if (item.completedAt) delete item.completedAt;
      else item.completedAt = new Date().toISOString();
      persistence.saveTodayPlan(plan);
      broadcastToWindows(IPC.TODAY_CHANGED, plan);
    }
    return plan;
  });

  ipcMain.handle(IPC.RECENTS_GET, () => persistence.getRecentTodos());

  // ── Tomorrow plan ─────────────────────────────────────────────
  // Mirrors the today-plan IPC surface so the same UI patterns work for both.
  // Items are queued here during the day and promoted to today at midnight.

  ipcMain.handle(IPC.TOMORROW_GET, () => persistence.getTomorrowPlan());

  ipcMain.handle(IPC.TOMORROW_PIN, (_e, item: PinnedTodo) => {
    const plan = persistence.getTomorrowPlan();
    if (plan.items.some((p) => p.todoId === item.todoId)) return plan;
    plan.items.push(item);
    persistence.saveTomorrowPlan(plan);
    broadcastToWindows(IPC.TOMORROW_CHANGED, plan);
    return plan;
  });

  ipcMain.handle(IPC.TOMORROW_UNPIN, (_e, todoId: number) => {
    const plan = persistence.getTomorrowPlan();
    plan.items = plan.items.filter((p) => p.todoId !== todoId);
    persistence.saveTomorrowPlan(plan);
    broadcastToWindows(IPC.TOMORROW_CHANGED, plan);
    return plan;
  });

  ipcMain.handle(IPC.TOMORROW_REORDER, (_e, todoIds: number[]) => {
    const plan = persistence.getTomorrowPlan();
    const byId = new Map(plan.items.map((p) => [p.todoId, p]));
    plan.items = todoIds.map((id) => byId.get(id)).filter(Boolean) as typeof plan.items;
    persistence.saveTomorrowPlan(plan);
    broadcastToWindows(IPC.TOMORROW_CHANGED, plan);
    return plan;
  });

  ipcMain.handle(IPC.TOMORROW_SET_ESTIMATE, (_e, data: { todoId: number; minutes: number | null }) => {
    const plan = persistence.getTomorrowPlan();
    const item = plan.items.find((p) => p.todoId === data.todoId);
    if (item) {
      if (data.minutes === null) delete item.estimateMinutes;
      else item.estimateMinutes = data.minutes;
      persistence.saveTomorrowPlan(plan);
      broadcastToWindows(IPC.TOMORROW_CHANGED, plan);
    }
    return plan;
  });

  ipcMain.handle(IPC.TOMORROW_TOGGLE_COMPLETE, (_e, todoId: number) => {
    const plan = persistence.getTomorrowPlan();
    const item = plan.items.find((p) => p.todoId === todoId);
    if (item) {
      if (item.completedAt) delete item.completedAt;
      else item.completedAt = new Date().toISOString();
      persistence.saveTomorrowPlan(plan);
      broadcastToWindows(IPC.TOMORROW_CHANGED, plan);
    }
    return plan;
  });

  // Mini-timer pill resize (renderer-driven). The pill expands to show the
  // task switcher panel and shrinks back to compact when collapsed. When
  // expanding near the bottom of the screen, we temporarily shift the
  // window UP so the dropdown doesn't render off-screen; on collapse we
  // restore the user's saved Y.
  ipcMain.on(IPC.MINI_TIMER_RESIZE, (_e, size: { width: number; height: number }) => {
    if (!miniTimerWindow || miniTimerWindow.isDestroyed()) return;
    const { screen } = require('electron');
    const [x, y] = miniTimerWindow.getPosition();
    const [oldW, oldH] = miniTimerWindow.getSize();
    // Keep the right edge in place when width changes (compact 240 → expanded 300).
    const newX = x + (oldW - size.width);

    // Determine if we're expanding (going from compact to expanded) or
    // collapsing (going back to compact). Compact height is 36px.
    const COMPACT_H = 36;
    const isExpanding = size.height > COMPACT_H + 4;

    let newY = y;

    if (isExpanding) {
      // Find the display the pill currently sits on so we can measure its
      // bottom edge correctly on multi-monitor setups.
      const display = screen.getDisplayMatching({ x, y, width: oldW, height: oldH });
      const wa = display.workArea;
      const bottomMargin = 12;
      const bottomEdge = wa.y + wa.height - bottomMargin;
      if (y + size.height > bottomEdge) {
        // Save the user's intended Y once (don't overwrite if we resize
        // again while already shifted — e.g. dynamic panel height).
        if (pillSavedY === null) pillSavedY = y;
        newY = Math.max(wa.y + 8, bottomEdge - size.height);
      }
    } else {
      // Collapsing — restore the saved Y if we had previously shifted.
      if (pillSavedY !== null) {
        newY = pillSavedY;
        pillSavedY = null;
      }
    }

    pillProgrammaticMove = true;
    miniTimerWindow.setBounds({ x: newX, y: newY, width: size.width, height: size.height });
    // Clear the flag on the next tick — setBounds fires 'moved' synchronously
    // or microtask-soon, so a single setImmediate keeps the suppression tight.
    setImmediate(() => { pillProgrammaticMove = false; });
  });

  // Mid-session notes. The pill writes to this on every keystroke (debounced
  // in the renderer). When stopTimer fires, the buffered notes get forwarded
  // to the confirm popup AND saved on the local session record.
  ipcMain.handle(IPC.MINI_TIMER_GET_NOTES, () => currentSessionNotes);
  ipcMain.on(IPC.MINI_TIMER_SET_NOTES, (_e, notes: string) => {
    // Cap at a reasonable length — these end up as Basecamp timesheet
    // descriptions, which aren't meant to hold paragraphs.
    currentSessionNotes = (notes ?? '').slice(0, 500);
  });

  // Manual JS-driven drag for the mini-timer pill. The renderer fires a stream
  // of (dx, dy) deltas during a mousedown→mouseup gesture and we apply each
  // delta to the window's current position. We use this instead of macOS's
  // -webkit-app-region: drag because OS-level dragging swallows mousedown so
  // the click-to-expand interaction never fires.
  ipcMain.on(IPC.MINI_TIMER_MOVE_BY, (_e, delta: { dx: number; dy: number }) => {
    if (!miniTimerWindow || miniTimerWindow.isDestroyed()) return;
    const [x, y] = miniTimerWindow.getPosition();
    miniTimerWindow.setPosition(Math.round(x + delta.dx), Math.round(y + delta.dy));
  });
}

// True if `host` is a private IPv4 (RFC1918), loopback, or link-local address.
// Used to gate the manual-IP connect IPC so renderer code can't coerce main
// into reaching public or cloud-metadata endpoints.
function isPrivateOrLoopback(host: string): boolean {
  // Strip surrounding whitespace and any IPv6 zone id.
  const h = host.trim().toLowerCase();
  if (h === 'localhost') return true;
  // Reject obvious unsafe sentinels.
  if (h === '0.0.0.0' || h === '::' || h === '169.254.169.254') return false;
  // IPv6 loopback / link-local
  if (h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true;
  // IPv4 octet match
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = +m[1], b = +m[2];
  if ([a, b, +m[3], +m[4]].some((n) => n < 0 || n > 255)) return false;
  if (a === 10) return true;                       // 10.0.0.0/8
  if (a === 127) return true;                      // 127.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true;          // 192.168.0.0/16
  if (a === 169 && b === 254) return true;          // 169.254.0.0/16 link-local
  return false;
}

// Format Date as YYYY-MM-DD in local timezone (Basecamp expects ISO date, not datetime).
function isoDateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── Keyboard Shortcuts ─────────────────────────────────────────

// Apply a status change initiated by a global shortcut. Mirrors the path
// taken when the user clicks a status pill in the popover/dashboard:
// cancel any in-flight auto-revert (so the shortcut wins) and broadcast
// the new state to networking + UI.
function applyStatusChangeFromShortcut(status: AvailabilityStatus) {
  const user = persistence.getUser();
  if (!user) return;
  cancelStatusRevertTimer();
  user.status = status;
  persistence.saveUser(user);
  networking?.updateUser(user);
  updateTrayIcon(user, 0, timerIsRunning);
  broadcastToWindows(IPC.PEER_UPDATED, user);
}

function registerShortcuts() {
  globalShortcut.register('CmdOrCtrl+Shift+A', () => applyStatusChangeFromShortcut(AvailabilityStatus.Available));
  globalShortcut.register('CmdOrCtrl+Shift+P', () => applyStatusChangeFromShortcut(AvailabilityStatus.Occupied));
  globalShortcut.register('CmdOrCtrl+Shift+F', () => applyStatusChangeFromShortcut(AvailabilityStatus.Focused));
}
