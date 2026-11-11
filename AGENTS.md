# sweetherdr

A personal layout for the Herdr app, kept as files. Herdr draws its whole window from `~/.config/herdr-app`; this repo holds the sweetherdr part of that folder.

## Read first

`~/.config/herdr-app/AGENTS.md`, with `herdr.d.ts` and `gpui-kit.d.ts` beside it. That is Herdr's own contract for layouts, mods and commands, rewritten for the installed version on every start. Everything below adds to it.

## Where to edit

Edit the **live** copy in `~/.config/herdr-app`: Herdr reloads it within a second. Then run `./sync.sh` to bring the change into this repo. `./install.sh` goes the other way, onto a machine.

A change is done when all three hold:

1. `herdr-app check <mod folder>` passes for every mod you touched (`./check.sh` runs it on all of them and says whether the repo matches the install).
2. `herdr-app status` shows `"errors": []`.
3. `herdr-app shot <file.png>` shows the change in the window.

The programs are `~/.local/bin/herdr-app` and `~/.local/bin/hc`; call them by that path.

## Names

- Mods are `sweet<part>`: lowercase letters only, one word, directly in `mods/` (`sweettabs`, `sweetnewmenu`).
- Herdr owns the plain names (`tabs`, `spaces`, `agents`, `files`, `changes`, `pane`, `menu`, `new-menu`) and rewrites those folders on every start, so every mod here carries `sweet` in front.
- Letters only is a hard rule. A mod in a subfolder is not found, and opening a mod named with a dot closed the Herdr window.
- The layout is `sweetherdr`. The person's own data lives in `~/.config/herdr-app/sweetherdr/` (projects, task lists, backups) and stays on their machine: `sync.sh` leaves it out.

## Look

Every part follows the same look:

- **Square**: radius 0. Dialogs, menus and Settings use radius 2.
- **Lowercase**: every label, button, heading and message the layout writes. The person's own names and data from Herdr keep their case.
- **Edge to edge**: a row's highlight spans its list. Put the side padding on the row and none on the list.
- **Hand cursor** on everything that takes a click.
- **Theme colours** by name from `theme()` (`chrome`, `border`, `accent`), so it follows the person's theme, light or dark.

A dialog or menu of ours is opened with `frame: "none"` and draws its own frame; Herdr's frame is rounder.

## Taking an idea from another layout

1. Read that layout's README or recipe.
2. Write the part fresh as a `sweet<part>` mod, in this look.
3. Credit it: a row in `CREDITS.md` and the "inspired by" column of the README's table.

The idea comes over; their files stay where they are.

## Herdr's own code

`NOTICE` lists the mods that began as copies of Herdr's. To change something Herdr ships, copy it first (`herdr-app do mod.clone '{"name":"<theirs>","as":"sweet<part>"}'`), point the layout or the calling mod at the copy, and add it to `NOTICE`.

## Checking what you cannot click

You drive Herdr through its command line, so clicks, hovers and right-clicks are out of reach. `herdr-app check` covers a mod's first render only. For a path behind a click (a menu, a dialog, a list that opens):

1. Copy the mod to a scratch folder.
2. Replace `props()` or the opening state with made-up values.
3. Run `herdr-app check <scratch folder> --print-spec` and read the labels it prints.

Ask the person before opening anything in their running window, and tell them what you could only check this way.

## Gotchas

- Sizes from `on_size_change` arrive after zoom: divide by `settings().zoom`.
- An `image()` redraws only when its file under `mods/` changes. `sweetsimscreen` exists to hold the simulator's frames for that reason.
- Start async reads from `init` or a `cx.timer`. One started from `render` did not run.
- Herdr keeps a mod's `localStorage` by mod name, so renaming a mod resets it.
- A tab that shows only a mod stores that mod's name; after a rename the tab must be reopened.

## Committing

Commit and push when the person asks for it.
