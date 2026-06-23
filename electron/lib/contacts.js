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

module.exports = { getContactMap };
