#!/bin/bash
# Build a stable, self-updating "Messages Inbox.app" and install it to
# /Applications. The bundle is a re-branded copy of the local Electron engine
# whose code is a thin bootstrap that pulls + rebuilds the source repo on every
# launch. Because the bundle itself never changes, its Full Disk Access grant
# persists across all future updates. Re-runnable (only needed if Electron
# itself is upgraded).
set -e

REPO="$HOME/tech/messages-inbox"
SRC_ELECTRON="$REPO/node_modules/electron/dist/Electron.app"
DEST="/Applications/Messages Inbox.app"
PB=/usr/libexec/PlistBuddy

[ -d "$SRC_ELECTRON" ] || { echo "Electron not installed — run 'npm install' first."; exit 1; }

echo "Building renderer…"
( cd "$REPO" && ./node_modules/.bin/vite build >/dev/null )

echo "Assembling app bundle…"
rm -rf "$DEST"
cp -R "$SRC_ELECTRON" "$DEST"

# Branding: name, identity, icon.
"$PB" -c "Set :CFBundleName Messages Inbox" "$DEST/Contents/Info.plist"
"$PB" -c "Set :CFBundleDisplayName Messages Inbox" "$DEST/Contents/Info.plist" 2>/dev/null \
  || "$PB" -c "Add :CFBundleDisplayName string Messages Inbox" "$DEST/Contents/Info.plist"
"$PB" -c "Set :CFBundleIdentifier com.ronak.messages-inbox" "$DEST/Contents/Info.plist"
cp "$REPO/build/icon.icns" "$DEST/Contents/Resources/electron.icns"

# App code = the auto-update bootstrap (overrides Electron's default app).
APPDIR="$DEST/Contents/Resources/app"
mkdir -p "$APPDIR"
cp "$REPO/scripts/app-bootstrap.js" "$APPDIR/bootstrap.js"
cat > "$APPDIR/package.json" <<'JSON'
{ "name": "messages-inbox", "productName": "Messages Inbox", "version": "1.0.0", "main": "bootstrap.js" }
JSON

# Ad-hoc sign so macOS will launch it and TCC has a stable identity to remember.
codesign --force --deep --sign - "$DEST" >/dev/null 2>&1 || codesign --force --sign - "$DEST"
touch "$DEST"

echo "Installed: $DEST"
