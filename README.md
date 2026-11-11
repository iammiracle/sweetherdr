# sweetherdr

My personal setup for the [Herdr app](https://herdr.dev): one layout that gathers the ideas I like from community layouts and makes them my own. Square corners, lowercase labels, Tokyo Night colours.

This repo is that setup as files, so a new machine gets it with one command. When I see a part I like somewhere, I write my own version of it here and credit where the idea came from.

## What is in the layout

| Part | Where | What it does | Inspired by |
| --- | --- | --- | --- |
| projects | sidebar | Named groups that hold your spaces. Right-click a project to close its spaces or remove it. | Over9k, Orca for Herdr |
| agents | tab bar | Every agent in four columns: needs you, done, working, idle. | jkuepker's Board |
| tasks | tab bar | A board per project (to do, doing, done, or one list). Send a task to the focused agent, a new agent, or a new agent in its own git worktree. Agents can update it. | Over9k, Shepherdr, bercail |
| timeline | side panel | The Claude Code conversation in this folder, prompt by prompt: time, tokens, files, commands, reply. | Over9k |
| simulator | side panel | The running iOS simulator's screen, live, with a device picker. View only. | Herdr Sim |
| skills | side panel | The skills, agents and MCP servers of Claude Code and Codex side by side; copy a skill to the tool that lacks it. | skillshare |
| tabs | tab bar | Slim flat tabs with a line on the open one. | Herdr T3 |
| spaces | sidebar | Herdr's own list, with an uncommitted-changes count per space. | Over9k |
| files, changes, settings, menus | | Herdr's own, restyled: square or 2px corners, lowercase, rows that highlight edge to edge. | Herdr |

Each one is written for this layout; none of those layouts' code is included. [CREDITS.md](CREDITS.md) has the links, authors and licences.

## Install on a new machine

You need the Herdr app (0.1.15 or newer), opened at least once.

```sh
git clone https://github.com/iammiracle/sweetherdr.git
cd sweetherdr
./install.sh
```

`./install.sh --dry-run` only says what it would do.

The installer copies the layout, its mods and three themes into `~/.config/herdr-app`, asks Herdr to check every mod, and switches Herdr to the sweetherdr layout. Anything it replaces is copied to `~/.config/herdr-app/sweetherdr/backups/<time>/` first. It does not touch your `keys.json`, `settings.json`, projects or task lists.

To go back to Herdr's own layout, press `cmd-shift-l`, or pick it in Settings.

## Save changes you made on this machine

After changing the layout in `~/.config/herdr-app`, copy it back into the repo:

```sh
./sync.sh
git status
```

Then commit what changed.

## What is not in the repo

Your own data stays on your machine: your projects (`sweetherdr/settings.json`), your task lists (`sweetherdr/tasks/`) and backups.

## What the layout runs on your machine

Mods are trusted code. sweetherdr's mods run these, and send nothing over the network:

- `git`, read-only, in your spaces' folders: branch, ahead and behind, uncommitted count. Tasks runs `git worktree add` when you start a task in its own worktree. Changes runs `git add -A` and `git commit` when you press commit.
- `xcrun simctl` to list simulators, take the screen pictures the Simulator panel shows, and for its buttons (start, shut down, light or dark, save a screenshot).
- `python3` with two small readers that ship in the mods: `sweettimeline/timeline.py` reads Claude Code's session files in `~/.claude/projects`, and `sweetskills/skills.py` reads the skill folders of Claude Code and Codex and the names (never the values) of their MCP servers.
- `cp` when you copy a skill from one tool to the other, and `open` to show a file in Finder or open Simulator.
- `hc send` when you send a task to an agent.

Files it writes: your projects and task lists under `~/.config/herdr-app/sweetherdr/`, and the simulator's two latest frames in `mods/sweetsimscreen/`.

## Limits

- The mod folders are named `sweettabs`, `sweettasks` and so on. Herdr keeps its own mods under the plain names (`tabs`, `spaces`, …) and rewrites them on every start, so ours carry the `sweet` in front.
- Built and tested on macOS with Herdr 0.1.15. The Simulator panel needs Xcode.
- The Timeline reads Claude Code sessions only.
- Eleven of the mods are copies of Herdr's own (see [NOTICE](NOTICE)). They do not pick up Herdr's later changes until they are copied again.
- `cmd-,` and the command palette open Herdr's own Settings; the sidebar's settings button opens sweetherdr's copy.

## Credits and licence

sweetherdr copies no code from the community layouts that inspired it; each idea was read from its public README and written again. [CREDITS.md](CREDITS.md) lists every one, with its author and licence.

Apache-2.0, see [LICENSE](LICENSE) and [NOTICE](NOTICE).
