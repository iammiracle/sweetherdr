#!/bin/sh
# check.sh: asks Herdr to check every sweetherdr mod, and says whether this repo
# matches what is installed.
#   ./check.sh          the mods installed in ~/.config/herdr-app
#   ./check.sh --repo   the copies in this repo
# Exits 1 if any mod fails.
set -eu

HERDR_HOME="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
REPO="$(cd "$(dirname "$0")" && pwd)"
WHERE="$HERDR_HOME"
[ "${1:-}" = "--repo" ] && WHERE="$REPO"

APP="$(command -v herdr-app 2>/dev/null || true)"
[ -z "$APP" ] && [ -x "$HOME/.local/bin/herdr-app" ] && APP="$HOME/.local/bin/herdr-app"
[ -n "$APP" ] || { echo "herdr-app was not found. Install the Herdr app and open it once." >&2; exit 1; }

count=0
failed=0
for dir in "$WHERE"/mods/sweet*; do
  [ -d "$dir" ] || continue
  count=$((count + 1))
  if ! "$APP" check "$dir" >/dev/null 2>&1; then
    failed=$((failed + 1))
    echo "check failed: $(basename "$dir")"
    "$APP" check "$dir" || true
  fi
done
[ "$count" -gt 0 ] || { echo "No sweetherdr mods in $WHERE/mods" >&2; exit 1; }
if [ "$failed" = 0 ]; then
  echo "All $count mods passed Herdr's check ($WHERE/mods)."
else
  echo "$failed of $count mods failed."
fi

# Does the repo hold what is installed? Herdr's own files and the simulator's frames are left out.
if [ -d "$HERDR_HOME/mods" ] && [ -d "$REPO/mods" ]; then
  differs=0
  for dir in "$HERDR_HOME"/mods/sweet* "$REPO"/mods/sweet*; do
    [ -d "$dir" ] || continue
    name="$(basename "$dir")"
    if ! diff -rq -x 'gpui-kit.d.ts' -x 'jsconfig.json' -x '*.jpg' -x '*.error' -x '.DS_Store' \
        "$HERDR_HOME/mods/$name" "$REPO/mods/$name" >/dev/null 2>&1; then
      differs=1
    fi
  done
  cmp -s "$HERDR_HOME/layouts/sweetherdr.json" "$REPO/layouts/sweetherdr.json" || differs=1
  if [ "$differs" = 1 ]; then
    echo "The repo and the installed layout differ: ./sync.sh copies your changes in, ./install.sh puts the repo's version back."
  else
    echo "The repo matches what is installed."
  fi
fi

[ "$failed" = 0 ]
