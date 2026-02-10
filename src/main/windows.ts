import { BrowserWindow } from 'electron';
import path from 'path';

const isMac = process.platform === 'darwin';

export function createPopoverWindow(url: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 320,
    height: 450,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    transparent: isMac,
    ...(isMac
      ? { vibrancy: 'sidebar' as const, visualEffectState: 'active' as const }
      : { backgroundColor: '#1c1c1e' }),
    hasShadow: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.loadURL(url);

  // Open DevTools in dev mode for debugging
  if (!require('electron').app.isPackaged) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  // Hide when clicking outside
  win.on('blur', () => {
    // Don't hide if devtools is focused (dev mode)
    if (!require('electron').app.isPackaged) return;
    win.hide();
  });

  return win;
}

export function createDashboardWindow(url: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 900,
    height: 650,
    minWidth: 800,
    minHeight: 600,
    ...(isMac
      ? { titleBarStyle: 'hiddenInset' as const, vibrancy: 'sidebar' as const, visualEffectState: 'active' as const }
      : { backgroundColor: '#1c1c1e' }),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.loadURL(url);

  // Open DevTools in dev mode for debugging
  if (!require('electron').app.isPackaged) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  return win;
}

export function createAlertWindow(url: string, options: { width: number; height: number }): BrowserWindow {
  const win = new BrowserWindow({
    width: options.width,
    height: options.height,
    show: true,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    closable: true,
    hasShadow: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.setVisibleOnAllWorkspaces(true);

  // Center on screen (offset up slightly like the Swift version)
  const { screen } = require('electron');
  const display = screen.getPrimaryDisplay();
  const x = Math.round(display.bounds.width / 2 - options.width / 2);
  const y = Math.round(display.bounds.height / 2 - options.height / 2 - 100);
  win.setPosition(x, y);

  win.loadURL(url);
  return win;
}
