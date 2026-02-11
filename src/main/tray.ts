import { Tray, Menu, nativeImage, BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { User, AvailabilityStatus } from '../shared/types';

// Cache directory for tray icon PNGs — fixes macOS template image issue
const trayIconDir = path.join(os.tmpdir(), 'zenstate-tray-icons');

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

// ── Pixel-buffer icon drawing ─────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

function setPixel(buf: Buffer, size: number, x: number, y: number, r: number, g: number, b: number, a: number) {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || ix >= size || iy < 0 || iy >= size) return;
  const idx = (iy * size + ix) * 4;
  // Alpha blending for anti-aliased edges
  const existingA = buf[idx + 3] / 255;
  const newA = a / 255;
  const outA = newA + existingA * (1 - newA);
  if (outA > 0) {
    buf[idx] = Math.round((r * newA + buf[idx] * existingA * (1 - newA)) / outA);
    buf[idx + 1] = Math.round((g * newA + buf[idx + 1] * existingA * (1 - newA)) / outA);
    buf[idx + 2] = Math.round((b * newA + buf[idx + 2] * existingA * (1 - newA)) / outA);
    buf[idx + 3] = Math.round(outA * 255);
  }
}

function drawFilledCircle(buf: Buffer, size: number, cx: number, cy: number, radius: number, r: number, g: number, b: number) {
  for (let py = Math.floor(cy - radius - 1); py <= Math.ceil(cy + radius + 1); py++) {
    for (let px = Math.floor(cx - radius - 1); px <= Math.ceil(cx + radius + 1); px++) {
      const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
      if (dist <= radius + 0.5) {
        const alpha = dist > radius - 0.5 ? Math.round((radius + 0.5 - dist) * 255) : 255;
        setPixel(buf, size, px, py, r, g, b, alpha);
      }
    }
  }
}

function drawLine(buf: Buffer, size: number, x0: number, y0: number, x1: number, y1: number, thickness: number, r: number, g: number, b: number) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.ceil(len * 3); // 3x oversampling for smooth lines

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const lx = x0 + dx * t;
    const ly = y0 + dy * t;
    drawFilledCircle(buf, size, lx, ly, thickness / 2, r, g, b);
  }
}

function createTrayIcon(color: string = '#34C759'): Electron.NativeImage {
  // 32x32 RGBA buffer, displayed at 16x16pt @2x for Retina clarity
  const size = 32;
  const buf = Buffer.alloc(size * size * 4, 0); // All transparent
  const [cr, cg, cb] = hexToRgb(color);
  const cx = size / 2;
  const cy = size / 2;

  // Central filled circle (radius ~5px at 2x = ~2.5pt)
  drawFilledCircle(buf, size, cx, cy, 5, cr, cg, cb);

  // 6 spokes at 60° intervals (matching FlowState asterisk)
  const spokeStart = 5;
  const spokeEnd = 14;
  const spokeThick = 2.8;
  for (let i = 0; i < 6; i++) {
    const rad = (i * 60 * Math.PI) / 180;
    drawLine(buf, size,
      cx + Math.sin(rad) * spokeStart, cy - Math.cos(rad) * spokeStart,
      cx + Math.sin(rad) * spokeEnd,   cy - Math.cos(rad) * spokeEnd,
      spokeThick, cr, cg, cb);
  }

  // Write to PNG file and load from path — fixes macOS template image issue.
  // nativeImage.createFromBuffer() + setTemplateImage(false) is broken in
  // Electron 33.x on macOS; the OS still treats the buffer as a template
  // image and renders it monochrome.  Loading from a real PNG file works.
  if (!fs.existsSync(trayIconDir)) {
    fs.mkdirSync(trayIconDir, { recursive: true });
  }

  const tempImg = nativeImage.createFromBuffer(buf, { width: size, height: size, scaleFactor: 2.0 });
  const pngPath = path.join(trayIconDir, `tray-${color.replace('#', '')}.png`);
  fs.writeFileSync(pngPath, tempImg.toPNG());

  const img = nativeImage.createFromPath(pngPath);
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
