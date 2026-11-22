#!/bin/sh
set -eu
umask 077
case "${1:-}" in
  preflight|prepare|activate|status) ;;
  *) echo "Usage: $0 preflight|prepare|activate|status" >&2; exit 2 ;;
esac
if [ "$#" -ne 1 ]; then exit 2; fi
asset=archive-air-f0da7cc.zip
digest=0a6f4c521dece41929bd477462b82baec616dcd13ff4bab3ed0fc2c33b6d9f13
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
gh release download archive-macos-f0da7cc --repo rmalde/personal-task-system --pattern "$asset" --dir "$stage"
(cd "$stage" && printf '%s  %s\n' "$digest" "$asset" | shasum -a 256 --check --status)
ditto -x -k "$stage/$asset" "$stage"
if [ "$1" = preflight ]; then
  "$stage/archive-air-f0da7cc/run.command" preflight
else
  "$stage/archive-air-f0da7cc/run.command" "$1" imessage
fi
