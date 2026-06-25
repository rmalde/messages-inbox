'use strict';

const { execFile } = require('child_process');
const os = require('os');
const path = require('path');
const { decodeAttributedBody } = require('./attributedBody');
const { getContactMap } = require('./contacts');
const { SQLITE } = require('./bin');

const CHAT_DB = path.join(os.homedir(), 'Library', 'Messages', 'chat.db');
const ATTACH_DIR = path.join(os.homedir(), 'Library', 'Messages', 'Attachments');

// Apple's Core Data epoch is 2001-01-01. `message.date` is nanoseconds since
// then. Convert to a normal unix-millis timestamp.
const APPLE_EPOCH_MS = 978307200000;
function appleToMs(ns) {
  if (!ns) return 0;
  return Math.round(ns / 1e6) + APPLE_EPOCH_MS;
}

function query(sql) {
  return new Promise((resolve, reject) => {
    execFile(
      SQLITE,
      ['-readonly', '-json', CHAT_DB, sql],
      { maxBuffer: 256 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(err);
        const out = stdout.trim();
        if (!out) return resolve([]);
        try {
          resolve(JSON.parse(out));
        } catch (e) {
          reject(e);
        }
      }
    );
  });
}

function textOf(row) {
  if (row.text && row.text.trim()) return row.text;
  if (row.body_hex) {
    const decoded = decodeAttributedBody(row.body_hex);
    if (decoded) return decoded;
  }
  return '';
}

// Strip the 36-char UUID out of guid references like "p:0/<UUID>" or
// "<UUID>/0" used by tapbacks and replies.
function extractGuid(ref) {
  if (!ref) return null;
  const m = ref.match(/[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}/);
  return m ? m[0] : null;
}

const TAPBACKS = {
  2000: '❤️', 2001: '👍', 2002: '👎', 2003: '😂', 2004: '‼️', 2005: '❓',
};

function displayNameFor(identifier, contacts) {
  if (!identifier) return 'Unknown';
  if (contacts && contacts[normalizePhone(identifier)]) {
    return contacts[normalizePhone(identifier)];
  }
  if (contacts && contacts[identifier.toLowerCase()]) {
    return contacts[identifier.toLowerCase()];
  }
  return identifier;
}

function normalizePhone(s) {
  if (!s) return s;
  if (s.includes('@')) return s.toLowerCase();
  const digits = s.replace(/[^0-9]/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

// ---- Conversation list ----------------------------------------------------

async function getConversations() {
  const contacts = await getContactMap().catch(() => ({}));

  // Last non-tapback message per chat.
  const rows = await query(`
    SELECT c.ROWID            AS chat_id,
           c.guid             AS guid,
           c.chat_identifier  AS chat_identifier,
           c.display_name     AS display_name,
           c.style            AS style,
           m.ROWID            AS msg_id,
           m.date             AS date,
           m.is_from_me       AS is_from_me,
           m.text             AS text,
           hex(m.attributedBody) AS body_hex,
           m.cache_has_attachments AS has_attach,
           m.service          AS service
    FROM chat c
    JOIN chat_message_join cmj ON cmj.chat_id = c.ROWID
    JOIN message m ON m.ROWID = cmj.message_id
    JOIN (
      SELECT cmj.chat_id AS cid, MAX(m.date) AS maxdate
      FROM chat_message_join cmj
      JOIN message m ON m.ROWID = cmj.message_id
      WHERE m.associated_message_type = 0 AND m.item_type = 0
      GROUP BY cmj.chat_id
    ) last ON last.cid = c.ROWID AND m.date = last.maxdate
    WHERE m.associated_message_type = 0
    GROUP BY c.ROWID
    ORDER BY m.date DESC;
  `);

  // Participants per chat (for naming + avatars of 1:1 and groups).
  const handleRows = await query(`
    SELECT chj.chat_id AS chat_id, h.id AS handle
    FROM chat_handle_join chj
    JOIN handle h ON h.ROWID = chj.handle_id;
  `);
  const participants = {};
  for (const r of handleRows) {
    (participants[r.chat_id] = participants[r.chat_id] || []).push(r.handle);
  }

  // Last incoming (not-from-me) message date per chat — drives archive +
  // unread logic.
  const incomingRows = await query(`
    SELECT cmj.chat_id AS chat_id, MAX(m.date) AS maxdate
    FROM chat_message_join cmj
    JOIN message m ON m.ROWID = cmj.message_id
    WHERE m.is_from_me = 0 AND m.associated_message_type = 0
    GROUP BY cmj.chat_id;
  `);
  const lastIncoming = {};
  for (const r of incomingRows) lastIncoming[r.chat_id] = appleToMs(r.maxdate);

  return rows.map((r) => {
    const isGroup = r.style === 43;
    const people = participants[r.chat_id] || [r.chat_identifier];
    let name;
    if (r.display_name && r.display_name.trim()) {
      name = r.display_name.trim();
    } else if (isGroup) {
      name = people.map((p) => displayNameFor(p, contacts)).join(', ');
    } else {
      name = displayNameFor(r.chat_identifier, contacts);
    }
    return {
      chatId: r.chat_id,
      guid: r.guid,
      identifier: r.chat_identifier,
      name,
      isGroup,
      participants: people,
      lastDate: appleToMs(r.date),
      lastFromMe: !!r.is_from_me,
      lastText: textOf(r),
      lastHasAttachment: !!r.has_attach,
      service: r.service,
      lastIncomingDate: lastIncoming[r.chat_id] || 0,
    };
  });
}

// ---- Messages within a conversation --------------------------------------

async function getMessages(chatId, limit = 1000) {
  const contacts = await getContactMap().catch(() => ({}));
  const rows = await query(`
    SELECT m.ROWID AS id,
           m.guid AS guid,
           m.date AS date,
           m.is_from_me AS is_from_me,
           m.text AS text,
           hex(m.attributedBody) AS body_hex,
           m.service AS service,
           m.associated_message_type AS assoc_type,
           m.associated_message_guid AS assoc_guid,
           m.associated_message_emoji AS assoc_emoji,
           m.thread_originator_guid AS reply_guid,
           m.cache_has_attachments AS has_attach,
           m.item_type AS item_type,
           h.id AS handle
    FROM chat_message_join cmj
    JOIN message m ON m.ROWID = cmj.message_id
    LEFT JOIN handle h ON h.ROWID = m.handle_id
    WHERE cmj.chat_id = ${Number(chatId)}
    ORDER BY m.date DESC
    LIMIT ${Number(limit)};
  `);

  // We fetched the newest `limit` messages (DESC) so long conversations always
  // include the latest; flip back to chronological order for display.
  rows.reverse();

  // Attachments for these messages.
  const ids = rows.map((r) => r.id);
  let attachByMsg = {};
  if (ids.length) {
    const att = await query(`
      SELECT maj.message_id AS mid, a.ROWID AS aid, a.filename AS filename,
             a.mime_type AS mime, a.transfer_name AS tname
      FROM message_attachment_join maj
      JOIN attachment a ON a.ROWID = maj.attachment_id
      WHERE maj.message_id IN (${ids.join(',')});
    `);
    for (const a of att) {
      (attachByMsg[a.mid] = attachByMsg[a.mid] || []).push({
        id: a.aid,
        path: a.filename ? a.filename.replace(/^~/, os.homedir()) : null,
        mime: a.mime || '',
        name: a.tname || '',
      });
    }
  }

  const byGuid = {};
  const messages = [];
  const tapbacks = []; // deferred until all base messages known

  for (const r of rows) {
    // Skip non-message events (group renames, joins, etc.) for v1.
    if (r.item_type !== 0) continue;

    if (r.assoc_type && r.assoc_type >= 2000) {
      tapbacks.push(r);
      continue;
    }

    const msg = {
      id: r.id,
      guid: r.guid,
      date: appleToMs(r.date),
      fromMe: !!r.is_from_me,
      text: textOf(r),
      service: r.service,
      sender: r.is_from_me ? 'Me' : displayNameFor(r.handle, contacts),
      handle: r.handle,
      replyToGuid: extractGuid(r.reply_guid),
      attachments: attachByMsg[r.id] || [],
      reactions: [],
    };
    byGuid[r.guid] = msg;
    messages.push(msg);
  }

  // Attach tapbacks to their targets.
  for (const r of tapbacks) {
    const targetGuid = extractGuid(r.assoc_guid);
    const target = byGuid[targetGuid];
    if (!target) continue;
    const isRemoval = r.assoc_type >= 3000;
    if (isRemoval) continue;
    let glyph = TAPBACKS[r.assoc_type];
    if (!glyph) {
      // Emoji/sticker reactions (2006+): the emoji lives in its own column.
      glyph = r.assoc_emoji || null;
    }
    if (!glyph) continue;
    target.reactions.push({
      glyph,
      fromMe: !!r.is_from_me,
      sender: r.is_from_me ? 'Me' : displayNameFor(r.handle, contacts),
    });
  }

  // Resolve reply previews.
  for (const m of messages) {
    if (m.replyToGuid && byGuid[m.replyToGuid]) {
      const t = byGuid[m.replyToGuid];
      m.replyPreview = { sender: t.sender, text: t.text };
    }
  }

  return messages;
}

// The most recent real (non-tapback) message in this chat: its timestamp (ms)
// and whether it's from Ronak. Matches getConversations' notion of "last
// message" so a draft's forDate can be compared for currency.
async function lastMessage(guid) {
  const g = String(guid).replace(/'/g, "''");
  try {
    const rows = await query(`
      SELECT m.date AS date, m.is_from_me AS fromme
      FROM chat c
      JOIN chat_message_join cmj ON cmj.chat_id = c.ROWID
      JOIN message m ON m.ROWID = cmj.message_id
      WHERE c.guid = '${g}' AND m.associated_message_type = 0 AND m.item_type = 0
      ORDER BY m.date DESC LIMIT 1;
    `);
    if (!rows.length) return null;
    return { date: appleToMs(rows[0].date), fromMe: !!rows[0].fromme };
  } catch {
    return null;
  }
}

module.exports = { getConversations, getMessages, lastMessage, appleToMs, normalizePhone, ATTACH_DIR };
