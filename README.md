# ZenState

**Plan your day, track your time, and know who's around — without leaving the menu bar.**

ZenState is a desktop app for small in-house teams that pulls three workflows into one quiet surface:

1. **Plan tomorrow today, work today's plan tomorrow** — pin a few Basecamp to-dos to your day, mark them done as you go, queue what's next.
2. **Track time on what you actually did** — timers post straight to your Basecamp timesheet so you stop copy-pasting hours at the end of the week.
3. **See your team's availability at a glance** — green / orange / red status, no Slack noise, no "you up?" DMs.

It runs from the macOS menu bar (or the Windows tray) and stays out of the way.

---

## Install

Download the latest build from [Releases](https://github.com/Everything-Design/ZenState_V3/releases/latest):

| Platform | File |
|---|---|
| macOS (Apple Silicon) | `ZenState-x.y.z-arm64.dmg` |
| Windows (x64) | `ZenState Setup x.y.z.exe` |

> **First-launch on macOS** — the app isn't yet notarized with Apple, so Gatekeeper will refuse to open it. Right-click the app in `/Applications` → **Open** → confirm. You only need to do this once.

The app auto-updates from GitHub Releases — once the team is on a recent build, future versions install themselves on next restart.

---

## First-time setup

1. **Create your profile.** Type your name and a username (lowercase letters, numbers, dot, underscore, dash — 2–32 chars). Pick an avatar / colour.
2. **Connect Basecamp** (optional but recommended). Settings → Basecamp → paste your Basecamp 3 OAuth `Client ID` and `Client Secret` (one-time, see *Getting Basecamp credentials* below) → click **Connect**. A browser window opens; authorize ZenState; you're back. The connection is per-machine and the tokens are stored encrypted via Keychain (macOS) / DPAPI (Windows).
3. **You're done.** The tray/menu-bar icon is your home base from here on.

### Getting Basecamp credentials (admins only, one-time per organization)

Each teammate uses the *same* `Client ID` / `Client Secret` pair. To generate them:

1. Visit https://launchpad.37signals.com/integrations and sign in as a Basecamp admin.
2. Click **Register a new integration**.
3. Name it "ZenState" (or anything), redirect URI: `http://127.0.0.1:53682/basecamp/callback`
4. Copy the resulting Client ID and Secret. Share them inside your team (1Password, etc.) — every teammate pastes the same pair into Settings → Basecamp.

That's the integration setup. Each teammate then individually clicks **Connect** to authorize their own Basecamp account.

---

## Daily workflow

### Plan your day (Plan tab → Today)

Open the dashboard → **Plan** tab. Click **Pin a to-do** → search recents or browse your Basecamp projects → pin a few things you actually want to focus on today. Set an estimate if you want progress feedback while you work.

Tomorrow's planning: same tab, **Tomorrow** sub-tab. Whatever you pin there will be waiting on your Today tab when you come in tomorrow morning. Anything you didn't finish today carries over too — completed items get dropped.

### Run a timer

Click **Start** on a pinned to-do. The mini-timer pill appears top-right and follows you across full-screen apps. Click the pill to expand it — write notes about what you're doing as you work, switch to a different pinned to-do without losing context.

When you stop the timer:
- A confirm popup shows the elapsed time + your in-progress notes (pre-filled).
- **Post** sends a timesheet entry to Basecamp; **Discard** keeps it locally only.
- If you close the popup with the X without picking, the session stays saved locally — re-sync later from Settings → Basecamp → **Backfill**.

### Mark things done

Each pinned to-do has a checkbox. Click it when you finish. The row dims and strikes through; the popover header shows `Today · 3/5` (3 still active out of 5 pinned). Marking a task done while its timer is running auto-stops the timer.

### Status & team

Pick **Available / Occupied / Focused** in the popover or dashboard sidebar. The whole team sees your status update instantly. Optional auto-revert: pick "1h" after going Occupied and you'll bounce back to Available automatically.

**Heads-up to teammates** (Megaphone icon) — type a short message, pick recipients (or save groups for one-tap sends), hit Send. Like a Slack ping but lighter.

**Meeting requests** — Team tab, click **Request meeting** on a teammate. They get a popover with Accept / Decline + optional quick replies.

---

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Cmd/Ctrl+Shift+A` | Set your status to Available |
| `Cmd/Ctrl+Shift+P` | Set your status to Occupied |
| `Cmd/Ctrl+Shift+F` | Set your status to Focus Mode |
| `Cmd/Ctrl+Enter` *(in timesheet popup)* | Post to Basecamp |

---

## Privacy & data

- **Team presence** stays on your local network. Discovery uses Bonjour (mDNS) + UDP beacons over your office Wi-Fi. Your status, name, and avatar are visible to other ZenState users on the same subnet.
- **Time tracking** lives locally on your machine. Sessions are recorded in an electron-store JSON file (`~/Library/Application Support/ZenState` on macOS, `%APPDATA%\ZenState` on Windows). Nothing leaves your device unless you explicitly post to Basecamp.
- **Basecamp tokens** are encrypted with the OS keystore (Keychain / DPAPI). They never touch our servers — there are no servers; the OAuth flow runs directly between your machine and Basecamp.
- **License keys** are Ed25519-signed and validated offline. No phone-home, no telemetry.

If you sign out, the app wipes Basecamp tokens, in-flight timers, status, and pinned plans. If you click **Reset App** in Settings, it goes further — wipes time-tracking history, peer groups, and license too. Only your app preferences (mini-timer toggle, break reminders, etc.) survive a reset.

---

## Troubleshooting

**Teammates aren't showing up.**
Settings → Network. Check that your local IP shows up there. If teammates are on the same Wi-Fi but invisible, click **Connect to IP** and paste their address manually (private addresses only — `10.x`, `172.16-31.x`, `192.168.x`).

**Basecamp says "session expired".**
Click the orange banner that appears or go to Settings → Basecamp → **Connect**. Past timer sessions stay saved locally and you can sync them later via **Backfill**.

**The mini-timer pill is off-screen.**
Quit the app and relaunch. The pill auto-snaps back to a visible position if its saved coordinates fall outside any current display (useful when undocking from a multi-monitor setup).

**WiFi panel shows nothing on Intel Macs.**
Known issue — the WiFi helper binary is Apple Silicon-only. Doesn't affect any other functionality.

---

## Building from source

```bash
# Install
npm install

# Run in dev (hot-reload renderer + watch main)
npm run dev

# Build for production
npm run build

# Package locally
npm run dist:mac     # macOS DMG + ZIP
npm run dist:win     # Windows NSIS installer

# Publish to GitHub Releases
GH_TOKEN=$(gh auth token) npm run publish      # macOS
GH_TOKEN=$(gh auth token) npm run publish:win  # Windows
```

After publishing, mark the release non-draft:

```bash
gh release edit v$(node -p "require('./package.json').version") \
  --draft=false --repo Everything-Design/ZenState_V3
```

---

## Tech stack

Electron 33 · React 19 · TypeScript · Vite · electron-builder · electron-store · Bonjour (mDNS) · Basecamp 3 OAuth · Ed25519 license signing.

---

## License

Proprietary. © Everything Design. All rights reserved.
