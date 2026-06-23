#!/bin/bash
# Pull the latest source, rebuild only if something changed, then launch the
# app detached. Used by the "Messages Inbox" auto-update launcher and by
# `npm run launch`.

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"
REPO="$HOME/tech/messages-inbox"
LOG="/tmp/messages-inbox-update.log"
cd "$REPO" || exit 1

{
  echo "=== $(date) ==="
  if [ -d .git ]; then
    before=$(git rev-parse HEAD 2>/dev/null || echo none)
    git pull --ff-only || echo "git pull skipped (offline or diverged) — using current source"
    after=$(git rev-parse HEAD 2>/dev/null || echo none)
    if [ "$before" != "$after" ]; then
      echo "updated: $before -> $after"
      if git diff --name-only "$before" "$after" 2>/dev/null | grep -q 'package-lock.json\|package.json'; then
        npm install --no-audit --no-fund
      fi
      npm run build
    else
      echo "already up to date"
    fi
  fi
  # First-run safety nets.
  [ -d node_modules ] || npm install --no-audit --no-fund
  [ -d dist ] || npm run build
} >"$LOG" 2>&1

# Launch the native Electron binary directly (no node needed) and detach so the
# calling launcher can quit, leaving only the app running.
ELECTRON="$REPO/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
nohup "$ELECTRON" "$REPO" >/tmp/messages-inbox-run.log 2>&1 &
