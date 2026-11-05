'use strict';

// Keeps dist/ (the built renderer) in step with src/.
//
// The installed app's bootstrap pulls new source on every launch, then
// rebuilds dist/ with whatever `node` sits at a fixed path. On a Mac where
// Node comes from nvm there is none, so that build fails silently and the app
// runs the new main process against the old renderer: new features never
// show up. So before the window opens we check whether dist/ is older than
// the renderer source and, if it is, rebuild it with the Node that ships
// inside Electron (ELECTRON_RUN_AS_NODE), which every install has.
//
// The build goes to a scratch directory and is swapped in only once it has
// succeeded, so a failed build leaves the previous renderer untouched.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// Everything the renderer bundle is built from.
const SOURCES = ['src', 'index.html', 'vite.config.mjs', 'package.json'];

// Newest mtime under `p`. Directory mtimes count too, so added and deleted
// files register as changes. 0 when `p` doesn't exist.
function newestMtime(p) {
  let st;
  try { st = fs.statSync(p); } catch { return 0; }
  if (!st.isDirectory()) return st.mtimeMs;
  let newest = st.mtimeMs;
  for (const name of fs.readdirSync(p)) newest = Math.max(newest, newestMtime(path.join(p, name)));
  return newest;
}

function needsBuild(root) {
  // A packaged build ships dist/ without its source: nothing to rebuild from.
  if (!fs.existsSync(path.join(root, 'src'))) return false;
  const built = newestMtime(path.join(root, 'dist', 'index.html'));
  const source = Math.max(...SOURCES.map((f) => newestMtime(path.join(root, f))));
  return source > built;
}

// Resolves 'fresh' | 'rebuilt' | 'skipped' | 'failed'. Never rejects, and
// never leaves dist/ worse than it found it. Details go to `logFile`.
function ensureFreshRenderer(root, logFile) {
  return new Promise((resolve) => {
    if (!needsBuild(root)) return resolve('fresh');
    const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
    if (!fs.existsSync(vite)) return resolve('skipped');

    const cache = path.join(root, 'node_modules', '.cache');
    const next = path.join(cache, 'renderer-next');
    const prev = path.join(cache, 'renderer-prev');
    const dist = path.join(root, 'dist');
    const started = Date.now();
    const log = (status, detail) => {
      try {
        fs.writeFileSync(logFile, `${new Date().toISOString()} ${status} (${Date.now() - started} ms)\n${detail || ''}\n`);
      } catch { /* logging is best effort */ }
    };

    execFile(process.execPath, [vite, 'build', '--outDir', next, '--emptyOutDir'], {
      cwd: root,
      // Run Electron's own binary as plain Node — no system Node needed.
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      timeout: 120000,
      maxBuffer: 16 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      if (err) {
        log('rebuild failed', `${err.message}\n${stdout}\n${stderr}`);
        return resolve('failed');
      }
      let movedOld = false;
      try {
        fs.rmSync(prev, { recursive: true, force: true });
        if (fs.existsSync(dist)) { fs.renameSync(dist, prev); movedOld = true; }
        fs.renameSync(next, dist);
      } catch (e) {
        // Put the old renderer back if the swap broke halfway.
        if (movedOld && !fs.existsSync(dist)) {
          try { fs.renameSync(prev, dist); } catch { /* nothing more to try */ }
        }
        log('swap failed', e.message);
        return resolve('failed');
      }
      fs.rmSync(prev, { recursive: true, force: true });
      log('rebuilt', stdout);
      resolve('rebuilt');
    });
  });
}

module.exports = { ensureFreshRenderer, needsBuild };
