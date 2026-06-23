'use strict';

// A Finder-launched .app gets a minimal PATH, so resolve system binaries by
// absolute path. /usr/bin is always present on macOS; allow an env override
// just in case.
const fs = require('fs');

function pick(candidates, envVar) {
  if (process.env[envVar] && fs.existsSync(process.env[envVar])) return process.env[envVar];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch { /* ignore */ }
  }
  return candidates[candidates.length - 1]; // last resort: let PATH resolve it
}

const SQLITE = pick(['/usr/bin/sqlite3', 'sqlite3'], 'SQLITE3_PATH');
const OSASCRIPT = pick(['/usr/bin/osascript', 'osascript'], 'OSASCRIPT_PATH');

module.exports = { SQLITE, OSASCRIPT };
