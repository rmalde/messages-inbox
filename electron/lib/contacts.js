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

let imgCache = null;
let imgCacheTime = 0;

function blobToDataUrl(hex) {
  if (!hex || hex.length < 200) return null; // skip references / empties
  const buf = Buffer.from(hex, 'hex').subarray(1); // drop the 0x01 prefix
  let mime = 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50) mime = 'image/png';
  else if (buf[0] !== 0xff || buf[1] !== 0xd8) return null; // not a known image
  return `data:${mime};base64,${buf.toString('base64')}`;
}

async function getImageMap() {
  const now = Date.now();
  if (imgCache && now - imgCacheTime < TTL) return imgCache;

  const map = {};
  const pick = `CASE
      WHEN length(r.ZTHUMBNAILIMAGEDATA) > 1000 THEN hex(r.ZTHUMBNAILIMAGEDATA)
      WHEN length(r.ZIMAGEDATA) > 1000 THEN hex(r.ZIMAGEDATA)
      ELSE NULL END`;
  for (const db of findDbs()) {
    const phones = await query(
      db,
      `SELECT p.ZFULLNUMBER AS handle, ${pick} AS img
       FROM ZABCDPHONENUMBER p JOIN ZABCDRECORD r ON r.Z_PK = p.ZOWNER
       WHERE p.ZFULLNUMBER IS NOT NULL AND (${pick}) IS NOT NULL;`
    );
    for (const row of phones) {
      const url = blobToDataUrl(row.img);
      if (url) map[normalizePhone(row.handle)] = url;
    }
    const emails = await query(
      db,
      `SELECT e.ZADDRESS AS handle, ${pick} AS img
       FROM ZABCDEMAILADDRESS e JOIN ZABCDRECORD r ON r.Z_PK = e.ZOWNER
       WHERE e.ZADDRESS IS NOT NULL AND (${pick}) IS NOT NULL;`
    );
    for (const row of emails) {
      const url = blobToDataUrl(row.img);
      if (url) map[row.handle.toLowerCase()] = url;
    }
  }

  imgCache = map;
  imgCacheTime = now;
  return map;
}

async function getContactImage(handle) {
  if (!handle) return null;
  const map = await getImageMap();
  return map[normalizePhone(handle)] || map[String(handle).toLowerCase()] || null;
}

module.exports = { getContactMap, getContactImage };
