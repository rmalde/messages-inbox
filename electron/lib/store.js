'use strict';

// Local-only metadata layer. We never write to Apple's chat.db — archive state
// and "read in this app" state live here, keyed by chat GUID.
//
// Archive semantics (email-like, per the user's spec):
//   - Archiving stamps `archivedAt` = now.
//   - A conversation is considered archived while its newest *incoming*
//     message is older than archivedAt. My own replies do NOT unarchive it.
//   - A new incoming message (date > archivedAt) automatically returns it to
//     the inbox.
//
// Unread semantics:
//   - `lastOpenedAt` is stamped when the conversation is opened in this app.
//   - Unread when newest incoming message date > lastOpenedAt.
//   - On first sight a conversation is baselined to "now" so the existing
//     backlog doesn't all show up as unread.

const fs = require('fs');
const path = require('path');

// Native flock (N-API — works in Electron without rebuilds). If it ever fails
// to load we degrade to unlocked read-modify-write rather than breaking.
let fsx = null;
try { fsx = require('fs-native-extensions'); } catch { /* unlocked fallback */ }

// The JSON file IS the API: external agents may edit inbox-store.json directly
// while the app runs. The contract (both sides follow it):
//   1. flock(2) ON THE DB FILE ITSELF — writers take an exclusive lock on an
//     open fd before read-modify-write and unlock after. flock auto-releases
//     if the holder crashes, so there is no stale-lock problem.
//   2. Under the lock: reload, mutate, write IN PLACE (ftruncate + write on
//     the locked fd — never rename-replace, which would swap the locked inode).
//   3. Readers tolerate torn reads (retry, never clobber in-memory state) and
//     a directory watcher reloads + notifies the app (onExternalChange) so
//     the UI reflects agent edits within a beat.
class Store {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { chats: {} };
    this.onExternalChange = null;
    this._suppressUntil = 0;
    this._load();
    this._watch();
  }

  _watch() {
    try {
      const base = path.basename(this.filePath);
      fs.watch(path.dirname(this.filePath), (_ev, fname) => {
        if (fname !== base) return;
        if (Date.now() < this._suppressUntil) return; // our own write
        clearTimeout(this._reloadT);
        this._reloadT = setTimeout(() => {
          this._load();
          if (this.onExternalChange) this.onExternalChange();
        }, 80);
      });
    } catch { /* watching is best-effort; mutators reload anyway */ }
  }

  // flock → reload → mutate → write in place → unlock.
  _mutate(fn) {
    let fd = null;
    let locked = false;
    try {
      try { fd = fs.openSync(this.filePath, 'r+'); }
      catch { fd = fs.openSync(this.filePath, 'w+'); }
      if (fsx) {
        const deadline = Date.now() + 2000;
        while (!(locked = fsx.tryLock(fd))) {
          if (Date.now() > deadline) break; // never wedge the app on a stuck holder
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
        }
      }
      this._load();
      fn();
      const json = JSON.stringify(this.data);
      this._suppressUntil = Date.now() + 400; // don't react to our own write
      fs.ftruncateSync(fd, 0);
      fs.writeSync(fd, json, 0, 'utf8');
    } finally {
      if (locked) { try { fsx.unlock(fd); } catch { /* released with fd */ } }
      if (fd != null) { try { fs.closeSync(fd); } catch { /* closed */ } }
    }
  }

  _load() {
    // Unlocked readers can catch an in-place write mid-flight: retry briefly,
    // and NEVER clobber known-good in-memory state with a failed parse (that
    // would get written back and lose data).
    for (let i = 0; i < 3; i++) {
      try {
        const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        if (!parsed.chats) parsed.chats = {};
        this.data = parsed;
        return;
      } catch (e) {
        if (e && e.code === 'ENOENT') break; // first run — keep defaults
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15);
      }
    }
    if (!this.data || !this.data.chats) this.data = { chats: {} };
  }

  _rec(guid) {
    if (!this.data.chats[guid]) this.data.chats[guid] = {};
    return this.data.chats[guid];
  }

  // Baseline newly-seen conversations so historical backlog isn't "unread".
  baseline(guid, now) {
    const r = this._rec(guid);
    if (r.lastOpenedAt == null) {
      r.lastOpenedAt = now;
      return true;
    }
    return false;
  }

  archive(guid, now) {
    this._mutate(() => { this._rec(guid).archivedAt = now; });
  }

  unarchive(guid) {
    this._mutate(() => { this._rec(guid).archivedAt = null; });
  }

  markOpened(guid, now) {
    this._mutate(() => { this._rec(guid).lastOpenedAt = now; });
  }

  // Manual section override (⌘⇧D): pin the conversation to 'theirs' or
  // 'inbox' regardless of who spoke last. Keyed to the conversation's current
  // last-message date, so ANY new message dissolves it back to natural
  // placement.
  setTurnOverride(guid, section, forDate) {
    this._mutate(() => { this._rec(guid).turnOverride = { section, forDate }; });
  }

  clearTurnOverride(guid) {
    if (!(this.data.chats[guid] || {}).turnOverride) return;
    this._mutate(() => { this._rec(guid).turnOverride = null; });
  }

  turnOverride(guid, lastDate) {
    const r = this.data.chats[guid];
    const o = r && r.turnOverride;
    return (o && o.forDate === lastDate) ? o.section : null;
  }

  isArchived(guid, lastIncomingDate) {
    const r = this.data.chats[guid];
    if (!r || r.archivedAt == null) return false;
    // A newer incoming message unarchives automatically.
    return (lastIncomingDate || 0) <= r.archivedAt;
  }

  isUnread(guid, lastIncomingDate) {
    const r = this.data.chats[guid];
    if (!r) return false;
    return (lastIncomingDate || 0) > (r.lastOpenedAt || 0);
  }

  // Decorate a conversation list (from db.getConversations) with local state,
  // baselining any first-seen chats.
  decorate(convos) {
    this._load(); // pick up any external edits since the last pass
    const now = Date.now();
    const fresh = convos.filter((c) => {
      const r = this.data.chats[c.guid];
      return !r || r.lastOpenedAt == null;
    });
    if (fresh.length) {
      this._mutate(() => {
        for (const c of fresh) {
          const r = this._rec(c.guid);
          if (r.lastOpenedAt == null) r.lastOpenedAt = now;
        }
      });
    }
    return convos.map((c) => ({
      ...c,
      archived: this.isArchived(c.guid, c.lastIncomingDate),
      unread: this.isUnread(c.guid, c.lastIncomingDate),
      turnOverride: this.turnOverride(c.guid, c.lastDate),
    }));
  }
}

module.exports = { Store };
