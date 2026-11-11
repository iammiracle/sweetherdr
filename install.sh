#!/bin/sh
# install.sh: puts sweetherdr into your Herdr config (~/.config/herdr-app).
#   ./install.sh            install, then switch Herdr to the sweetherdr layout
#   ./install.sh --dry-run  only say what it would do
# Anything it replaces is copied to sweetherdr/backups/<time>/ first. It does not
# touch your keys.json, settings.json, projects or task lists.
set -eu

DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

HERDR_HOME="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
REPO="$(cd "$(dirname "$0")" && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$HERDR_HOME/sweetherdr/backups/$STAMP"

say() { echo "$@"; }
run() { if [ "$DRY" = 1 ]; then echo "  would run: $*"; else "$@"; fi; }

if [ ! -d "$HERDR_HOME" ]; then
  echo "Herdr's folder $HERDR_HOME does not exist. Open the Herdr app once, then run this again." >&2
  exit 1
fi

# 1. Keep a copy of what is about to be replaced.
found=0
[ -f "$HERDR_HOME/layouts/sweetherdr.json" ] && found=1
for dir in "$HERDR_HOME"/mods/sweet*; do [ -d "$dir" ] && found=1; done
if [ "$found" = 1 ]; then
  say "Backing up the sweetherdr that is installed now to $BACKUP"
  run mkdir -p "$BACKUP/layouts" "$BACKUP/mods" "$BACKUP/themes"
  for f in sweetherdr.json sweetherdr.svg; do
    [ -f "$HERDR_HOME/layouts/$f" ] && run cp "$HERDR_HOME/layouts/$f" "$BACKUP/layouts/"
  done
  for dir in "$HERDR_HOME"/mods/sweet*; do
    [ -d "$dir" ] && run cp -R "$dir" "$BACKUP/mods/"
  done
fi

# 2. Copy the layout, the mods and the themes.
say "Installing the layout"
run mkdir -p "$HERDR_HOME/layouts" "$HERDR_HOME/mods" "$HERDR_HOME/themes" "$HERDR_HOME/sweetherdr/tasks"
run cp "$REPO/layouts/sweetherdr.json" "$REPO/layouts/sweetherdr.svg" "$HERDR_HOME/layouts/"

say "Installing the mods"
for dir in "$REPO"/mods/sweet*; do
  [ -d "$dir" ] || continue
  name="$(basename "$dir")"
  # Herdr's own files in each mod folder (its type files) and the simulator's frames stay.
  run rsync -a --exclude 'gpui-kit.d.ts' --exclude 'jsconfig.json' --exclude '*.jpg' "$dir/" "$HERDR_HOME/mods/$name/"
done

say "Installing the themes"
for theme in "$REPO"/themes/*.json; do
  [ -f "$theme" ] || continue
  name="$(basename "$theme")"
  if [ -f "$HERDR_HOME/themes/$name" ] && ! cmp -s "$theme" "$HERDR_HOME/themes/$name"; then
    run mkdir -p "$BACKUP/themes"
    run cp "$HERDR_HOME/themes/$name" "$BACKUP/themes/"
  fi
  run cp "$theme" "$HERDR_HOME/themes/"
done
[ -f "$REPO/CREDITS.md" ] && run cp "$REPO/CREDITS.md" "$HERDR_HOME/sweetherdr/CREDITS.md"

# 3. Let Herdr check every mod, then show the layout.
APP="$(command -v herdr-app 2>/dev/null || true)"
[ -z "$APP" ] && [ -x "$HOME/.local/bin/herdr-app" ] && APP="$HOME/.local/bin/herdr-app"
if [ -z "$APP" ]; then
  say "herdr-app was not found, so the mods were not checked. Open Herdr and pick the sweetherdr layout in Settings."
  exit 0
fi
if [ "$DRY" = 1 ]; then
  say "  would check each mod with $APP and switch to the sweetherdr layout"
  exit 0
fi
failed=0
for dir in "$HERDR_HOME"/mods/sweet*; do
  [ -d "$dir" ] || continue
  if ! "$APP" check "$dir" >/dev/null 2>&1; then
    failed=1
    say "check failed: $(basename "$dir")"
    "$APP" check "$dir" || true
  fi
done
[ "$failed" = 0 ] && say "Every mod passed Herdr's check."
if "$APP" do layout.switch '{"name":"sweetherdr"}' >/dev/null 2>&1; then
  say "Herdr is now showing sweetherdr."
else
  say "Herdr is not running. Open it and pick the sweetherdr layout in Settings."
fi
