import { Tray, Menu, nativeImage, BrowserWindow, app } from 'electron';
import path from 'path';
import { User, AvailabilityStatus } from '../shared/types';

let tray: Tray | null = null;
let onClickCallback: (() => void) | null = null;
let onStatusChangeCallback: ((status: AvailabilityStatus) => void) | null = null;
let onOpenDashboardCallback: (() => void) | null = null;

const STATUS_ICON_MAP: Record<AvailabilityStatus, string> = {
  [AvailabilityStatus.Available]: 'tray-available.png',
  [AvailabilityStatus.Occupied]: 'tray-occupied.png',
  [AvailabilityStatus.Focused]: 'tray-focused.png',
  [AvailabilityStatus.Offline]: 'tray-offline.png',
};

// ── Icon loading ─────────────────────────────────────────────

function getIconsDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'icons');
  }
  return path.join(__dirname, '../../build/icons');
}

function createTrayIcon(status: AvailabilityStatus = AvailabilityStatus.Available): Electron.NativeImage {
  const filename = STATUS_ICON_MAP[status] || STATUS_ICON_MAP[AvailabilityStatus.Offline];
  const iconPath = path.join(getIconsDir(), filename);
  const img = nativeImage.createFromPath(iconPath);
  img.setTemplateImage(false);
  return img;
}

// ── Time formatting ───────────────────────────────────────────

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── Tray creation ─────────────────────────────────────────────

interface TrayCallbacks {
  onClick: () => void;
  onStatusChange: (status: AvailabilityStatus) => void;
  onOpenDashboard: () => void;
}

export function createTray(callbacks: TrayCallbacks) {
  onClickCallback = callbacks.onClick;
  onStatusChangeCallback = callbacks.onStatusChange;
  onOpenDashboardCallback = callbacks.onOpenDashboard;

  const icon = createTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('ZenState');

  tray.on('click', () => {
    onClickCallback?.();
  });

  // Right-click context menu with wired actions
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '● Available',
      click: () => onStatusChangeCallback?.(AvailabilityStatus.Available),
    },
    {
      label: '● Occupied',
      click: () => onStatusChangeCallback?.(AvailabilityStatus.Occupied),
    },
    {
      label: '● Focused',
      click: () => onStatusChangeCallback?.(AvailabilityStatus.Focused),
    },
    { type: 'separator' },
    {
      label: 'Open Dashboard',
      click: () => onOpenDashboardCallback?.(),
    },
    { type: 'separator' },
    { label: 'Quit ZenState', role: 'quit' },
  ]);

  tray.on('right-click', () => {
    tray?.popUpContextMenu(contextMenu);
  });
}

// ── Update tray icon + title ──────────────────────────────────

export function updateTrayIcon(user: User, timerElapsed: number = 0, timerRunning: boolean = false) {
  if (!tray) return;

  const icon = createTrayIcon(user.status);
  tray.setImage(icon);

  // tray.setTitle() is macOS-only
  if (process.platform === 'darwin') {
    if (timerRunning && timerElapsed > 0) {
      tray.setTitle(` ${formatTime(timerElapsed)}`, { fontType: 'monospacedDigit' });
    } else {
      tray.setTitle('');
    }
  }

  tray.setToolTip(`ZenState — ${user.name} (${user.status})`);
}

// ── Position popover below tray ───────────────────────────────

export function positionPopover(window: BrowserWindow) {
  if (!tray) return;

  const trayBounds = tray.getBounds();
  const windowBounds = window.getBounds();

  const x = Math.round(trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2);

  let y: number;
  if (process.platform === 'darwin') {
    // macOS: tray at top → open below
    y = Math.round(trayBounds.y + trayBounds.height);
  } else {
    // Windows/Linux: tray at bottom → open above
    y = Math.round(trayBounds.y - windowBounds.height);
  }

  window.setPosition(x, y);
}
