# Messages Inbox

A local, private wrapper around macOS Messages that adds an **email-style inbox
with archiving** — the thing the real Messages app can't do. Nothing is sent
anywhere; everything runs on your machine.

## What it does

- **Inbox / Archived split.** Every conversation lives in the Inbox until you
  archive it. Archiving is *email semantics*: a thread stays in the Inbox even
  after you reply — it only leaves when **you** archive it, and it
  **automatically returns to the Inbox the moment someone sends a new message**.
- **Archive shortcut:** `⌘⇧E` (Conversation → Archive Conversation).
  - `⌘⇧A` toggle Inbox/Archived view · `⌘⇧R` mark read · `⌘↑/⌘↓` move between
    conversations.
- **Full iMessage-style UI:** blue/green/gray bubbles, tapback reactions,
  reply quoting, inline image attachments, day/time separators, group sender
  labels, unread dots, emoji picker, send/appear animations.
- **Respects system Light/Dark mode** automatically.

## How it works

- **Reading:** read-only queries against `~/Library/Messages/chat.db` (the same
  SQLite DB Messages uses). Message text is decoded straight out of the
  `attributedBody` blob. Polls every few seconds for new messages. **It never
  writes to Apple's database.**
- **Sending:** via AppleScript (`osascript`) to the existing chat — the same
  channel Messages.app uses. Works for iMessage and SMS, 1:1 and groups.
- **Archive / read state:** stored separately in a small JSON file in the app's
  userData dir, keyed by chat GUID. Your real Messages app is untouched.

## Run it (development)

```bash
npm install
npm run dev      # live-reload dev mode (Vite + Electron)
# or
npm start        # production build + launch
```

## Install as a Mac app

```bash
npm run dist     # builds release/Messages Inbox-<version>-arm64.dmg
```

Open the `.dmg` and drag **Messages Inbox** into `/Applications`. The app is
**unsigned** (local use), so the first launch needs a right-click → **Open** to
get past Gatekeeper. Then grant the two permissions below.

## Auto-updating launcher (always runs the latest source)

The packaged `.dmg` is a frozen snapshot. For a build that updates itself every
time you open it, use the launcher:

```bash
npm run make-launcher   # creates "Messages Inbox.app" in the repo
```

Drag that **Messages Inbox.app** into `/Applications` (and/or your Dock).
Opening it runs `scripts/update-and-launch.sh`, which `git pull`s the latest
source, rebuilds only if something changed, and launches the app — so each
relaunch is up to date. (Grant Full Disk Access to this launcher's engine the
first time; the app shows a guided screen if it's missing.)

> True in-place auto-update of a distributed app (Electron's `electron-updater`)
> requires Apple code-signing + notarization (paid Developer ID). The launcher
> above is the free equivalent for personal use.

### Requirements / permissions

- **Full Disk Access** — required to read `chat.db`. System Settings → Privacy
  & Security → Full Disk Access → add **Messages Inbox** (or, in dev, the
  terminal you launch from).
- **Automation** — sending prompts for permission to control Messages the first
  time; click Allow.

## Project layout

```
electron/
  main.js              Electron main: window, menu/shortcuts, IPC
  preload.js           Safe contextBridge API
  lib/
    db.js              chat.db queries -> conversations & messages
    attributedBody.js  decode message text from the binary blob
    contacts.js        best-effort name resolution from AddressBook
    store.js           local archive + read-state (JSON)
    send.js            AppleScript send
    bin.js             absolute paths to system sqlite3 / osascript
build/                 app icon (.icns) + entitlements for packaging
src/
  App.jsx              state, polling, archive logic, keyboard wiring
  components/          Sidebar, Thread, Bubble, Composer, Avatar, Attachment
```

## Notes & limits

- Reactions and replies are **displayed**; sending them isn't supported by
  AppleScript, so the composer sends plain text (and lands in the right thread).
- Contact names come from your local AddressBook; unknown numbers show as the
  raw phone/email.

## Roadmap

- AI drafting: suggested replies that learn from your own writing style
  (planned, not yet built).
