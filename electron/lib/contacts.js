'use strict';

// Best-effort contact-name resolution from the macOS AddressBook SQLite
// stores. Everything here is wrapped so that any failure (no access, schema
// drift, no contacts) silently degrades to "show the raw phone/email".

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SQLITE } = require('./bin');

const SOURCES_DIR = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'AddressBook',
  'Sources'
);

let cache = null;
let cacheTime = 0;
const TTL = 5 * 60 * 1000;

function normalizePhone(s) {
  if (!s) return s;
  if (s.includes('@')) return s.toLowerCase();
  const digits = s.replace(/[^0-9]/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function query(db, sql) {
  return new Promise((resolve) => {
    execFile(SQLITE, ['-readonly', '-json', db, sql], { maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve([]);
      const out = (stdout || '').trim();
      if (!out) return resolve([]);
      try {
        resolve(JSON.parse(out));
      } catch {
        resolve([]);
      }
    });
  });
}

function findDbs() {
  const dbs = [];
  try {
    for (const src of fs.readdirSync(SOURCES_DIR)) {
      const p = path.join(SOURCES_DIR, src, 'AddressBook-v22.abcddb');
      if (fs.existsSync(p)) dbs.push(p);
    }
  } catch {
    /* no addressbook access */
  }
  return dbs;
}

async function getContactMap() {
  const now = Date.now();
  if (cache && now - cacheTime < TTL) return cache;

  const map = {};
  for (const db of findDbs()) {
    const fullName = `TRIM(COALESCE(r.ZFIRSTNAME,'') || ' ' || COALESCE(r.ZLASTNAME,''))`;
    const phones = await query(
      db,
      `SELECT ${fullName} AS name, p.ZFULLNUMBER AS num
       FROM ZABCDPHONENUMBER p JOIN ZABCDRECORD r ON r.Z_PK = p.ZOWNER
       WHERE p.ZFULLNUMBER IS NOT NULL;`
    );
    for (const row of phones) {
      const name = (row.name || '').trim();
      if (name && row.num) map[normalizePhone(row.num)] = name;
    }
    const emails = await query(
      db,
      `SELECT ${fullName} AS name, e.ZADDRESS AS addr
       FROM ZABCDEMAILADDRESS e JOIN ZABCDRECORD r ON r.Z_PK = e.ZOWNER
       WHERE e.ZADDRESS IS NOT NULL;`
    );
    for (const row of emails) {
      const name = (row.name || '').trim();
      if (name && row.addr) map[row.addr.toLowerCase()] = name;
    }
  }

  cache = map;
  cacheTime = now;
  return map;
}

// ---- Contact photos -------------------------------------------------------
// Images are stored inline in the AddressBook DB with a 1-byte prefix (0x01)
// followed by raw JPEG/PNG bytes. (Some records hold a tiny ~38-byte reference
// instead of real data — those are skipped.)

function blobToDataUrl(hex) {
  if (!hex || hex.length < 200) return null; // skip references / empties
  if (hex.length > 4_000_000) return null; // ~2MB image cap (memory safety)
  const buf = Buffer.from(hex, 'hex').subarray(1); // drop the 0x01 prefix
  let mime = 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50) mime = 'image/png';
  else if (buf[0] !== 0xff || buf[1] !== 0xd8) return null; // not a known image
  return `data:${mime};base64,${buf.toString('base64')}`;
}

// SQL fragment that picks the better of the two image columns.
const PICK_IMG = `CASE
    WHEN length(r.ZTHUMBNAILIMAGEDATA) > 1000 THEN hex(r.ZTHUMBNAILIMAGEDATA)
    WHEN length(r.ZIMAGEDATA) > 1000 THEN hex(r.ZIMAGEDATA)
    ELSE NULL END`;

// Lightweight index of which handles HAVE a photo — handle -> [{db, num, kind}].
// Crucially this carries NO image bytes (loading every contact's photo at once
// was blowing the heap); the actual photo is fetched one at a time on demand.
let idxCache = null;
let idxCacheTime = 0;

async function getPhotoIndex() {
  const now = Date.now();
  if (idxCache && now - idxCacheTime < TTL) return idxCache;

  const idx = {};
  const add = (key, entry) => { (idx[key] = idx[key] || []).push(entry); };
  for (const db of findDbs()) {
    const phones = await query(
      db,
      `SELECT p.ZFULLNUMBER AS num
       FROM ZABCDPHONENUMBER p JOIN ZABCDRECORD r ON r.Z_PK = p.ZOWNER
       WHERE p.ZFULLNUMBER IS NOT NULL
         AND (length(r.ZTHUMBNAILIMAGEDATA) > 1000 OR length(r.ZIMAGEDATA) > 1000);`
    );
    for (const row of phones) {
      if (row.num) add(normalizePhone(row.num), { db, num: row.num, kind: 'phone' });
    }
    const emails = await query(
      db,
      `SELECT e.ZADDRESS AS addr
       FROM ZABCDEMAILADDRESS e JOIN ZABCDRECORD r ON r.Z_PK = e.ZOWNER
       WHERE e.ZADDRESS IS NOT NULL
         AND (length(r.ZTHUMBNAILIMAGEDATA) > 1000 OR length(r.ZIMAGEDATA) > 1000);`
    );
    for (const row of emails) {
      if (row.addr) add(row.addr.toLowerCase(), { db, num: row.addr, kind: 'email' });
    }
  }

  idxCache = idx;
  idxCacheTime = now;
  return idx;
}

// Per-handle result cache so repeated avatar renders don't re-query.
const urlCache = new Map();

async function getContactImage(handle) {
  if (!handle) return null;
  const key = normalizePhone(handle);
  if (urlCache.has(key)) return urlCache.get(key);

  const idx = await getPhotoIndex();
  const hits = idx[key] || idx[String(handle).toLowerCase()];
  if (!hits || !hits.length) { urlCache.set(key, null); return null; }

  for (const h of hits) {
    const col = h.kind === 'phone' ? 'p.ZFULLNUMBER' : 'e.ZADDRESS';
    const join = h.kind === 'phone'
      ? 'ZABCDPHONENUMBER p JOIN ZABCDRECORD r ON r.Z_PK = p.ZOWNER'
      : 'ZABCDEMAILADDRESS e JOIN ZABCDRECORD r ON r.Z_PK = e.ZOWNER';
    const esc = String(h.num).replace(/'/g, "''");
    const rows = await query(
      h.db,
      `SELECT ${PICK_IMG} AS img FROM ${join}
       WHERE ${col} = '${esc}' AND (${PICK_IMG}) IS NOT NULL LIMIT 1;`
    );
    const url = rows[0] && blobToDataUrl(rows[0].img);
    if (url) { urlCache.set(key, url); return url; }
  }
  urlCache.set(key, null);
  return null;
}

module.exports = { getContactMap, getContactImage };
