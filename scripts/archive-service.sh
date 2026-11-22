#!/bin/sh
set -eu
umask 077
case "${1:-}" in
  preflight|prepare|activate|status) ;;
  *) echo "Usage: $0 preflight|prepare|activate|status" >&2; exit 2 ;;
esac
if [ "$#" -ne 1 ]; then exit 2; fi
asset=archive-air-e06da97.zip
digest=0de073fff1439e86aa8e2b440590e04c8fc8489f33e8711fb6ad804ee44e99aa
cache="$HOME/Library/Caches/PersonalTaskArchive"
mkdir -p "$cache"
stage=$(mktemp -d "$cache/stage.XXXXXXXX")
trap 'rm -rf "$stage"' EXIT
verify_asset() {
  (cd "$stage" && printf '%s  %s\n' "$digest" "$asset" | shasum -a 256 --check --status)
}
if ! cp "$cache/$digest.zip" "$stage/$asset" 2>/dev/null || ! verify_asset; then
  gh release download archive-macos-e06da97 --repo rmalde/personal-task-system --pattern "$asset" --dir "$stage" --clobber
  verify_asset
  # Publish a complete verified file atomically, including when both apps start together.
  cp "$stage/$asset" "$stage/cache-entry"
  mv -f "$stage/cache-entry" "$cache/$digest.zip"
fi
ditto -x -k "$stage/$asset" "$stage"
if [ "$1" = preflight ]; then
  "$stage/archive-air-e06da97/run.command" preflight
else
  "$stage/archive-air-e06da97/run.command" "$1" imessage
fi
