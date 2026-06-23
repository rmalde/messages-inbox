#!/usr/bin/env node
'use strict';

// Bulk-archive every conversation whose latest message is on or before a given
// date. Usage:
//
//   node scripts/archive-before.js 2026-06-15
//
// Archiving just stamps `archivedAt` in the local store (same semantics as the
// in-app archive): the thread leaves the Inbox and returns automatically if
// someone sends a new message after now. Apple's database is never touched.
//
// Run with the app QUIT — the app keeps the store in memory and would overwrite
// external edits on its next save.

const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../electron/lib/db');

function resolveStorePath() {
  const base = path.join(os.homedir(), 'Library', 'Application Support');
  const candidates = ['Messages Inbox', 'messages-inbox']
    .map((n) => path.join(base, n, 'inbox-store.json'))
    .filter((p) => fs.existsSync(p));
  if (candidates.length === 0) {
    // default to the productName location
    return path.join(base, 'Messages Inbox', 'inbox-store.json');
  }
  // The app the user is running writes to exactly one of these — pick whichever
  // was touched most recently.
  candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return candidates[0];
}

async function main() {
  const dateArg = process.argv[2];
  if (!dateArg || !/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
    console.error('Usage: node scripts/archive-before.js YYYY-MM-DD');
    process.exit(1);
  }
  const cutoff = new Date(`${dateArg}T23:59:59.999`).getTime();
  const now = Date.now();

  const storePath = resolveStorePath();
  let store = { chats: {} };
  try { store = JSON.parse(fs.readFileSync(storePath, 'utf8')); } catch { /* fresh */ }
  if (!store.chats) store.chats = {};

  const convos = await db.getConversations();
  let archived = 0;
  for (const c of convos) {
    if (c.lastDate <= cutoff) {
      const rec = store.chats[c.guid] || {};
      rec.archivedAt = now;
      if (rec.lastOpenedAt == null) rec.lastOpenedAt = now; // don't resurface as unread
      store.chats[c.guid] = rec;
      archived++;
    }
  }

  fs.writeFileSync(storePath, JSON.stringify(store));
  console.log(`Store: ${storePath}`);
  console.log(`Cutoff: ${new Date(cutoff).toString()}`);
  console.log(`Conversations scanned: ${convos.length}`);
  console.log(`Archived (last message on/before ${dateArg}): ${archived}`);
  console.log(`Remaining in inbox: ${convos.length - archived}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
