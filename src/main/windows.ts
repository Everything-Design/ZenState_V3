import { BrowserWindow } from 'electron';
import path from 'path';

const isMac = process.platform === 'darwin';

export function createPopoverWindow(url: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 360,
    height: 480,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    transparent: isMac,
    // `type: 'panel'` makes this an NSPanel on macOS — non-activating so it
    // doesn't steal focus from the underlying app, and it floats correctly
    // over full-screen Spaces (hover-to-dismiss bug fix).
    ...(isMac ? { type: 'panel' as const } : {}),
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

  if (isMac) {
    // Show on all spaces and stay visible above full-screen apps.
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    // 'screen-saver' is the highest standard window level — keeps the popover
    // above full-screen app windows, which sit at the 'main-menu' level.
    win.setAlwaysOnTop(true, 'screen-saver');
  }

  win.loadURL(url);

  // Open DevTools in dev mode for debugging
  if (!require('electron').app.isPackaged) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  // Hide when the user clicks outside, but ignore the spurious blur that
  // can fire immediately after `show()` while the underlying full-screen
  // Space is still settling. A short grace window prevents the popover
  // from instantly disappearing the first time it's opened on top of a
  // full-screen app.
  let lastShownAt = 0;
  win.on('show', () => { lastShownAt = Date.now(); });
  win.on('blur', () => {
    if (!require('electron').app.isPackaged) return; // devtools focus in dev
    if (Date.now() - lastShownAt < 250) return;       // ignore show→blur race
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

// A small frameless pill that floats above all other windows — including
// full-screen apps — so the user always sees whether their timer is running.
// `type: 'panel'` is critical here: regular BrowserWindows on macOS don't
// reliably stay above full-screen Spaces even with `setVisibleOnAllWorkspaces`
// + `screen-saver` level. NSPanel does. The opaque CSS background in
// mini-timer.html acts as a fallback so the panel renders reliably even
// before React mounts (the documented edge case for transparent panels).
export function createMiniTimerWindow(url: string, position?: { x: number; y: number }): BrowserWindow {
  const width = 240;
  const height = 36;
  const win = new BrowserWindow({
    width,
    height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000', // explicit ARGB so transparent compositing is reliable
    alwaysOnTop: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: true,
    paintWhenInitiallyHidden: true,
    ...(isMac ? { type: 'panel' as const } : {}),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  if (isMac) {
    // Stay visible across Spaces and over full-screen apps. The order matters:
    // setVisibleOnAllWorkspaces first, then bump the always-on-top level.
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setAlwaysOnTop(true, 'screen-saver');
  } else {
    // 'screen-saver' is also the highest standard level on Windows — without
    // it the pill won't sit above full-screen exclusive apps (presentations,
    // games). Electron documents this argument as cross-platform.
    win.setAlwaysOnTop(true, 'screen-saver');
  }

  // Default position: top-right of primary display, 60px below the work area
  // top edge so it clears the menu bar and notch area on MacBooks.
  // If a saved position is supplied, validate it lies inside *some* current
  // display's work area — common Windows scenario: pill was on a secondary
  // monitor that's no longer connected, so the saved coordinates would spawn
  // it off-screen.
  const { screen } = require('electron');
  const computeDefaultPos = () => {
    const display = screen.getPrimaryDisplay();
    return {
      x: display.workArea.x + display.workArea.width - width - 20,
      y: display.workArea.y + 60,
    };
  };
  const isPositionVisible = (x: number, y: number): boolean => {
    return screen.getAllDisplays().some((d: { workArea: { x: number; y: number; width: number; height: number } }) => {
      const wa = d.workArea;
      // Require the entire pill rect to fit, not just a corner.
      return x >= wa.x && y >= wa.y && (x + width) <= (wa.x + wa.width) && (y + height) <= (wa.y + wa.height);
    });
  };
  if (position && isPositionVisible(position.x, position.y)) {
    win.setPosition(position.x, position.y);
  } else {
    const def = computeDefaultPos();
    win.setPosition(def.x, def.y);
  }

  win.loadURL(url);
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
