import { Tray, Menu, nativeImage, BrowserWindow } from 'electron';
import { User, AvailabilityStatus } from '../shared/types';

let tray: Tray | null = null;
let onClickCallback: (() => void) | null = null;
let onStatusChangeCallback: ((status: AvailabilityStatus) => void) | null = null;
let onOpenDashboardCallback: (() => void) | null = null;

const STATUS_COLORS: Record<AvailabilityStatus, string> = {
  [AvailabilityStatus.Available]: '#34C759',
  [AvailabilityStatus.Occupied]: '#FF9500',
  [AvailabilityStatus.Focused]: '#FF3B30',
  [AvailabilityStatus.Offline]: '#8E8E93',
};

// ── SVG-based tray icon ───────────────────────────────────────

function createTrayIcon(color: string = '#34C759'): Electron.NativeImage {
  // 6-spoke asterisk icon at 32x32 (displayed 16x16pt @2x for Retina)
  const cx = 16;
  const cy = 16;
  const spokeStart = 5;
  const spokeEnd = 14;
  const strokeWidth = 2.8;

  // Generate 6 spokes at 60° intervals
  const spokes: string[] = [];
  for (let i = 0; i < 6; i++) {
    const rad = (i * 60 * Math.PI) / 180;
    const x1 = cx + Math.sin(rad) * spokeStart;
    const y1 = cy - Math.cos(rad) * spokeStart;
    const x2 = cx + Math.sin(rad) * spokeEnd;
    const y2 = cy - Math.cos(rad) * spokeEnd;
    spokes.push(
      `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round"/>`
    );
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <circle cx="${cx}" cy="${cy}" r="5" fill="${color}"/>
  ${spokes.join('\n  ')}
</svg>`;

  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  const img = nativeImage.createFromDataURL(dataUrl);
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

  const color = STATUS_COLORS[user.status] || STATUS_COLORS[AvailabilityStatus.Offline];
  const icon = createTrayIcon(color);
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
