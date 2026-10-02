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
// Mute semantics (in-app, like Gmail's mute — nothing to do with Messages'
// own Hide Alerts):
//   - Muting stamps `mutedAt`. A muted conversation is archived whatever
//     archivedAt says, and new incoming messages do NOT bring it back.
//   - Unmuting clears `mutedAt` only, restoring the archive state it had
//     before it was muted (what Undo relies on).
//   - Move to Inbox (unarchive) clears both, so it always lands in the inbox.
//
// Unread semantics:
//   - `lastOpenedAt` is stamped when the conversation is opened in this app.
//   - Unread when newest incoming message date > lastOpenedAt.
//   - On first sight a conversation is baselined to "now" so the existing
//     backlog doesn't all show up as unread.

const fs = require('fs');

class Store {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { chats: {} };
    this._load();
  }

  _load() {
    try {
      this.data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (!this.data.chats) this.data.chats = {};
    } catch {
      this.data = { chats: {} };
    }
  }

  _save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data));
    } catch (e) {
      // best effort
    }
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
    this._rec(guid).archivedAt = now;
    this._save();
  }

  unarchive(guid) {
    const r = this._rec(guid);
    r.archivedAt = null;
    r.mutedAt = null; // Move to Inbox always lands in the inbox
    this._save();
  }

  mute(guid, now) {
    this._rec(guid).mutedAt = now;
    this._save();
  }

  unmute(guid) {
    this._rec(guid).mutedAt = null;
    this._save();
  }

  isMuted(guid) {
    const r = this.data.chats[guid];
    return !!(r && r.mutedAt != null);
  }

  markOpened(guid, now) {
    this._rec(guid).lastOpenedAt = now;
    this._save();
  }

  isArchived(guid, lastIncomingDate) {
    const r = this.data.chats[guid];
    if (!r) return false;
    // Muted: stays archived no matter how many new messages arrive.
    if (r.mutedAt != null) return true;
    if (r.archivedAt == null) return false;
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
    const now = Date.now();
    let changed = false;
    for (const c of convos) {
      if (this.baseline(c.guid, now)) changed = true;
    }
    if (changed) this._save();
    return convos.map((c) => ({
      ...c,
      archived: this.isArchived(c.guid, c.lastIncomingDate),
      muted: this.isMuted(c.guid),
      unread: this.isUnread(c.guid, c.lastIncomingDate),
    }));
  }
}

module.exports = { Store };
