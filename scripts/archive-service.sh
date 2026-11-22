#!/bin/sh
set -eu
umask 077
case "${1:-}" in
  preflight|prepare|activate|status) ;;
  *) echo "Usage: $0 preflight|prepare|activate|status" >&2; exit 2 ;;
esac
if [ "$#" -ne 1 ]; then exit 2; fi
asset=archive-air-3289776.zip
digest=1988a0c165a6e6549fb1c52cf642a3332b6cc8f0eaa2117634c183f6f8a55a82
cache="$HOME/Library/Caches/PersonalTaskArchive"
mkdir -p "$cache"
stage=$(mktemp -d "$cache/stage.XXXXXXXX")
trap 'rm -rf "$stage"' EXIT
verify_asset() {
  (cd "$stage" && printf '%s  %s\n' "$digest" "$asset" | shasum -a 256 --check --status)
}
if ! cp "$cache/$digest.zip" "$stage/$asset" 2>/dev/null || ! verify_asset; then
  gh release download archive-macos-3289776 --repo rmalde/personal-task-system --pattern "$asset" --dir "$stage" --clobber
  verify_asset
  # Publish a complete verified file atomically, including when both apps start together.
  cp "$stage/$asset" "$stage/cache-entry"
  mv -f "$stage/cache-entry" "$cache/$digest.zip"
fi
ditto -x -k "$stage/$asset" "$stage"
if [ "$1" = preflight ]; then
  "$stage/archive-air-3289776/run.command" preflight
else
  "$stage/archive-air-3289776/run.command" "$1" imessage
fi
