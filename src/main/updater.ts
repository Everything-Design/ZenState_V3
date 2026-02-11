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

/**
 * Manual update check — returns the result directly via Promise.
 * Does not rely on event listeners.
 */
export async function checkForUpdate(): Promise<{ updateAvailable: boolean; version?: string }> {
  try {
    const result = await autoUpdater.checkForUpdates();
    if (result && result.updateInfo) {
      const latest = result.updateInfo.version;
      const current = app.getVersion();
      if (latest !== current) {
        return { updateAvailable: true, version: latest };
      }
    }
    return { updateAvailable: false };
  } catch (err) {
    console.error('Manual update check error:', err);
    return { updateAvailable: false };
  }
}
