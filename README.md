

https://github.com/user-attachments/assets/98284b56-b711-4832-a695-8cf65bb4ce90




# Messages Inbox

A local, private wrapper around macOS Messages that adds an **email-style inbox
with archiving** — the thing the real Messages app can't do. Nothing is sent
anywhere; everything runs on your machine.

## What it does

- **Inbox / Archived split.** Every conversation lives in the Inbox until you
  archive it. Archiving is *email semantics*: a thread stays in the Inbox even
  after you reply — it only leaves when **you** archive it, and it
  **automatically returns to the Inbox the moment someone sends a new message**.
- **Mute:** `⌘⇧M` (or the bell button in the conversation header) archives a
  conversation for good — new messages **don't** bring it back to the Inbox.
  Muted threads keep a bell-slash mark in Archived and show a **Muted** banner
  with an **Unmute** button; the toast after muting has **Undo**, and `⌘⇧M`
  again moves it back to the Inbox. This is the app's own mute: it doesn't
  change Hide Alerts in Messages, so notifications still arrive as before.
- **Archive shortcut:** `⌘⇧E` (Conversation → Archive Conversation).
  - `⌘⇧M` mute / unmute · `⌘⇧A` toggle Inbox/Archived view · `⌘⇧R` mark read ·
    `⌘↑/⌘↓` move between conversations.
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
- **Archive / mute / read state:** stored separately in a small JSON file in
  the app's userData dir, keyed by chat GUID. Your real Messages app is
  untouched.

## Run it (development)

```bash
npm install
npm run dev      # live-reload dev mode (Vite + Electron)
# or
npm start        # production build + launch
```

## Install as a self-updating Mac app (recommended)

```bash
npm run make-app   # builds & installs /Applications/Messages Inbox.app
```

This installs a real **Messages Inbox.app** (proper name + icon, stable
identity) whose code is a thin bootstrap: on every launch it `git pull`s the
latest source, rebuilds the renderer, then runs it. Because the *bundle* never
changes, you grant **Full Disk Access once** and it persists across every future
update. First launch shows a guided "Full Disk Access" screen if needed — add
`/Applications/Messages Inbox.app` and toggle it on.

Requires the repo to stay at `~/tech/messages-inbox`. Re-run `make-app` only if
the Electron version itself is upgraded.

### Frozen snapshot (alternative)

```bash
npm run dist       # builds release/Messages Inbox-<version>-arm64.dmg
```

A static `.dmg` that does not auto-update. Unsigned, so first launch needs a
right-click → **Open**.

> A true in-place auto-updater (Electron's `electron-updater`) would need Apple
> code-signing + notarization (paid Developer ID). The self-updating app above
> is the free equivalent for personal use.

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

## AI drafting (branch: `ai-drafting`)

Auto-drafts replies in your voice and learns from your edits. All local except
the model calls (Anthropic API).

- **Style prompt (v0):** hand-built from ~170 of your real sent messages — tone,
  abbreviations, emoji, length-matching, with positive/negative examples. Seeded
  into `ai-prompts.json`; this is the start of the evolving prompt.
- **Drafting:** Haiku 4.5 (`claude-haiku-4-5-20251001`) drafts a reply for every
  chat with an incoming message **received today** that's awaiting your reply.
  The draft prefills the composer (with an "AI draft" flag) and shows a **Draft**
  chip in the sidebar. New messages get drafted as they arrive.
- **Archiving a chat with a live draft deletes the draft** (and logs it as a
  "didn't want to reply" signal).
- **Continual learning:** every **20** sent/archived drafts, the diff between the
  draft and what you actually sent is fed to a reflection step (Sonnet 4.6),
  which rewrites the style prompt to reduce future edits. Each version is saved.
- **Prompt-evolution viewer:** the ✦ button in the sidebar top bar opens a
  timeline — v0 baseline, then every revision with the reflection + new prompt.

Files (all in the app's userData dir): `ai-prompts.json` (versions),
`ai-drafts.json` (per-chat drafts), `ai-learning.json` (pending edit samples).
Key is read from `ANTHROPIC_API_KEY` (env or `~/.zshrc`).

> Requires Anthropic API **credits**. Without them, the prompt viewer shows a
> "credit balance too low" notice and no drafts are generated; everything else
> works and drafting resumes automatically once credits are added.

## Roadmap

- Sendable tapbacks (blocked by macOS), clustered group avatars, search across
  message bodies.
