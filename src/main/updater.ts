import { autoUpdater } from 'electron-updater';
import { app, BrowserWindow } from 'electron';

// v5.1.2 — broadcast every meaningful autoUpdater lifecycle event to the
// renderer so SettingsTab can drive its state machine off real signals
// instead of guessing from the one-shot checkForUpdate() return value.
// This was the root cause of Windows builds appearing "stuck at downloading":
// the renderer set updateStatus='available' after the initial check, then
// never received any event to advance past it because download-progress
// and error events weren't being surfaced.
function broadcast(channel: string, payload?: unknown) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      win.webContents.send(channel, payload);
    } catch (err) {
      // Window may be in a transitional state; broadcast is best-effort.
      console.warn(`updater: broadcast to ${channel} failed:`, err);
    }
  }
}

export function setupUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    broadcast('update:checking');
  });

  autoUpdater.on('update-available', (info) => {
    console.log(`Update available: ${info.version}`);
    broadcast('update:available', { version: info.version });
  });

  autoUpdater.on('update-not-available', (info) => {
    broadcast('update:not-available', { version: info?.version });
  });

  autoUpdater.on('download-progress', (progress) => {
    broadcast('update:progress', {
      percent: Math.round(progress.percent ?? 0),
      bytesPerSecond: progress.bytesPerSecond ?? 0,
      transferred: progress.transferred ?? 0,
      total: progress.total ?? 0,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`Update downloaded: ${info.version} — will install on quit`);
    broadcast('update:downloaded', { version: info.version });
  });

  autoUpdater.on('error', (err) => {
    console.error('Auto-update error:', err);
    broadcast('update:error', {
      message: err?.message ?? 'Update failed',
    });
  });

  // Check on launch
  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.warn('Initial update check failed:', err);
  });

  // Check every 4 hours
  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      console.warn('Periodic update check failed:', err);
    });
  }, 4 * 60 * 60 * 1000);
}

/**
 * Manual update check — triggered from the Settings UI's "Check for update"
 * button. Returns whether an update is available; the actual download is
 * driven by autoDownload=true and surfaces progress via the download-progress
 * + update-downloaded events broadcast above.
 *
 * v5.1.2: removed the previous autoDownload toggle dance — it was unreliable
 * on Windows (the redundant second checkForUpdatesAndNotify() call could race
 * with the in-flight download and silently abort it). Now we let the standard
 * autoDownload pipeline handle everything; this function just kicks the
 * check and returns the verdict.
 */
export async function checkForUpdate(): Promise<{ updateAvailable: boolean; version?: string }> {
  try {
    const result = await autoUpdater.checkForUpdates();
    if (!result || !result.updateInfo) {
      return { updateAvailable: false };
    }
    const latest = result.updateInfo.version;
    const current = app.getVersion();
    if (isNewerVersion(latest, current)) {
      // autoDownload is on, so a download is already in flight after the
      // check above. The renderer will receive update:available → update:progress
      // → update:downloaded events naturally.
      return { updateAvailable: true, version: latest };
    }
    return { updateAvailable: false };
  } catch (err) {
    console.error('Manual update check error:', err);
    // Surface the error so the UI can recover from a stuck state instead of
    // sitting on "checking…" forever.
    broadcast('update:error', {
      message: (err as Error)?.message ?? 'Update check failed',
    });
    return { updateAvailable: false };
  }
}

function isNewerVersion(latest: string, current: string): boolean {
  const l = latest.split('.').map(Number);
  const c = current.split('.').map(Number);
  for (let i = 0; i < Math.max(l.length, c.length); i++) {
    const lv = l[i] || 0;
    const cv = c[i] || 0;
    if (lv > cv) return true;
    if (lv < cv) return false;
  }
  return false;
}
