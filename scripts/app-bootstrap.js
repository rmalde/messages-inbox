'use strict';

// Entry point baked into the installed "Messages Inbox.app" bundle. The bundle
// itself is a stable, ad-hoc-signed shell (so its Full Disk Access grant
// persists forever); all real code lives in the source repo. On each launch we
// pull the latest source, rebuild the renderer, then hand off to the live
// main process. This is what makes the installed app auto-update without ever
// rebuilding the bundle (which would reset the FDA grant).

const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFileSync } = require('child_process');

const REPO = path.join(os.homedir(), 'tech', 'messages-inbox');
const SRC_MAIN = path.join(REPO, 'electron', 'main.js');
const PATHV = '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin';

function update() {
  const env = { ...process.env, PATH: PATHV };
  try {
    execFileSync('/usr/bin/git', ['-C', REPO, 'pull', '--ff-only'], {
      env, timeout: 20000, stdio: 'ignore',
    });
  } catch { /* offline / diverged — keep current source */ }
  try {
    execFileSync('/usr/local/bin/node', [path.join(REPO, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], {
      cwd: REPO, env, timeout: 90000, stdio: 'ignore',
    });
  } catch { /* build failed — fall back to existing dist */ }
}

if (fs.existsSync(SRC_MAIN)) {
  update();
  require(SRC_MAIN); // hands control to the live source main process
} else {
  // Source repo is missing — nothing to run.
  const { app, dialog } = require('electron');
  app.whenReady().then(() => {
    dialog.showErrorBox(
      'Messages Inbox',
      `Source not found at ${REPO}. Clone/keep the repo there to run the app.`
    );
    app.quit();
  });
}
