import { autoUpdater } from 'electron-updater';
import { BrowserWindow } from 'electron';

export function setupUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    console.log(`Update available: ${info.version}`);
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('update:available', { version: info.version });
    }
  });

  autoUpdater.on('update-not-available', () => {
    console.log('No updates available');
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('update:not-available');
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`Update downloaded: ${info.version} — will install on quit`);
    // Notify all renderer windows so they can show a restart prompt
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('update:downloaded', { version: info.version });
    }
  });

  autoUpdater.on('error', (err) => {
    console.error('Auto-update error:', err);
    // Notify renderers so "Checking..." doesn't hang forever
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('update:error', err.message);
    }
  });

  // Check on launch
  autoUpdater.checkForUpdatesAndNotify();

  // Check every 4 hours
  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify();
  }, 4 * 60 * 60 * 1000);
}

export function checkForUpdate() {
  autoUpdater.checkForUpdates();
}
