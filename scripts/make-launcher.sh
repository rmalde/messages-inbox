#!/bin/bash
# Build a double-clickable "Messages Inbox.app" launcher that auto-updates from
# source on every open. Reproducible — safe to re-run anytime.
set -e

REPO="$HOME/tech/messages-inbox"
APP="$REPO/Messages Inbox.app"
SCRIPT="$REPO/scripts/update-and-launch.sh"

chmod +x "$SCRIPT"
rm -rf "$APP"

# An AppleScript applet that just runs the update+launch script.
osacompile -o "$APP" -e "do shell script \"'$SCRIPT'\""

# Give it the real app icon.
if [ -f "$REPO/build/icon.icns" ]; then
  cp "$REPO/build/icon.icns" "$APP/Contents/Resources/applet.icns"
fi
touch "$APP"

echo "Launcher built: $APP"
echo "Drag it into /Applications and/or your Dock. Opening it always runs the latest source."
