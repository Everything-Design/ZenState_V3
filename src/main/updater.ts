import { autoUpdater } from 'electron-updater';
import { app, BrowserWindow } from 'electron';

export function setupUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    console.log(`Update available: ${info.version}`);
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('update:available', { version: info.version });
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`Update downloaded: ${info.version} — will install on quit`);
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('update:downloaded', { version: info.version });
    }
  });

  autoUpdater.on('error', (err) => {
    console.error('Auto-update error:', err);
  });

  // Check on launch
  autoUpdater.checkForUpdatesAndNotify();

  // Check every 4 hours
  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify();
  }, 4 * 60 * 60 * 1000);
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

/**
 * Manual update check — returns the result directly via Promise.
 * Temporarily disables autoDownload to avoid side effects.
 */
export async function checkForUpdate(): Promise<{ updateAvailable: boolean; version?: string }> {
  try {
    // Disable autoDownload during manual check to prevent unwanted downloads
    autoUpdater.autoDownload = false;
    const result = await autoUpdater.checkForUpdates();
    autoUpdater.autoDownload = true;

    if (result && result.updateInfo) {
      const latest = result.updateInfo.version;
      const current = app.getVersion();
      if (isNewerVersion(latest, current)) {
        // Trigger the actual download now that we know there's a real update
        autoUpdater.checkForUpdatesAndNotify();
        return { updateAvailable: true, version: latest };
      }
    }
    return { updateAvailable: false };
  } catch (err) {
    autoUpdater.autoDownload = true;
    console.error('Manual update check error:', err);
    return { updateAvailable: false };
  }
}
