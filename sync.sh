#!/bin/sh
# sync.sh: copies sweetherdr from your Herdr config into this repo, ready to commit.
# Run it after you change the layout on this machine. It never copies your
# projects, task lists or anything else personal.
set -eu

HERDR_HOME="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
REPO="$(cd "$(dirname "$0")" && pwd)"
THEMES="tokyo-night rose-pine catppuccin-mocha"

[ -f "$HERDR_HOME/layouts/sweetherdr.json" ] || { echo "No sweetherdr layout in $HERDR_HOME" >&2; exit 1; }

mkdir -p "$REPO/layouts" "$REPO/mods" "$REPO/themes"
cp "$HERDR_HOME/layouts/sweetherdr.json" "$HERDR_HOME/layouts/sweetherdr.svg" "$REPO/layouts/"

# Each mod whole, without what Herdr writes itself and the simulator's frames.
for dir in "$HERDR_HOME"/mods/sweet*; do
  [ -d "$dir" ] || continue
  name="$(basename "$dir")"
  rsync -a --delete \
    --exclude 'gpui-kit.d.ts' --exclude 'jsconfig.json' --exclude '*.jpg' --exclude '*.error' --exclude '.DS_Store' \
    "$dir/" "$REPO/mods/$name/"
done
# A mod that is gone from your config is only reported: remove it from the repo yourself.
for dir in "$REPO"/mods/sweet*; do
  [ -d "$dir" ] || continue
  name="$(basename "$dir")"
  [ -d "$HERDR_HOME/mods/$name" ] || echo "note: mods/$name is in the repo but no longer in your Herdr config"
done

for theme in $THEMES; do
  [ -f "$HERDR_HOME/themes/$theme.json" ] && cp "$HERDR_HOME/themes/$theme.json" "$REPO/themes/"
done
[ -f "$HERDR_HOME/sweetherdr/CREDITS.md" ] && cp "$HERDR_HOME/sweetherdr/CREDITS.md" "$REPO/CREDITS.md"

echo "Copied sweetherdr from $HERDR_HOME into $REPO"
echo "Next: git status, then commit what changed."
