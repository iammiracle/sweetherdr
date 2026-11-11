// Workspace spaces: stable colored avatars, worktrees under their checkout,
// grouped by machine when more than one is known. After a space's name, the repo
// its first terminal is in now, only where unusual: branch, ahead/behind. Agent state lives in the agents list, not here. Click to
// switch, right-click for its menu, drag to reorder.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, machines, panes, run, openOverlay, exec, hc, theme, shared, setShared, watchFolder, window, layout, home, appHome, readTextFile, writeTextFile, pickFolder, notify, props, closeOverlay } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// Where a space is now: its first terminal's live folder, else where it was made.
// `ps`: panes(), read once by the caller (each read copies every pane).
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}
const rowHeight = ({ tree }) => (tree ? 28 : 30);
const RAIL_CELL = 32;
const railCell = (el) => h_flex().flex_none().justify_center().child(el);
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
const base = (path) => path.replace(/\/+$/, "").split("/").pop();
// sweetherdr: a project is a name you give a group of spaces; it has no folder of
// its own, and a space in it is wherever its terminal is. A space joins when it
// is made from the project's + or dragged there (`assigned`: space id -> name).
function projectOf(w, projects, assigned) {
  const named = assigned[w.id];
  return named && projects.some((p) => p.name === named) ? { key: `p:${named}`, name: named } : null;
}
// The corner radius of sweetherdr's own dialogs and menus ("rounded-xs").
const XS = 2;
const SETTINGS = () => `${appHome()}/sweetherdr/settings.json`;
// Changes made outside Herdr (an editor's save, a commit in another app): looked
// for this often, in repos the list shows, while the window is in front.
const FALLBACK = 60000;

// What a stored color name looks like on an avatar (the same in every mod
// that draws space avatars): one strong color per hue, light and dark alike.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

// A space speaks up only when something in it needs you.
export function glyph(status) {
  return status === "blocked" || status === "done" ? "●" : "·";
}

export function tone(t, status) {
  return t[status] ?? t.unknown;
}

export default class Spaces extends View {
  init(_props, cx) {
    // sweetherdr: opened as a project's right-click menu, this copy only draws that menu.
    this.rev = shared("sweetherdr.projects.rev") ?? 0;
    // ...or as the dialog that asks before removing one: that copy takes the keyboard.
    if (props()?.projectConfirm) { this.handle = cx.focus_handle(); this.handle.focus(); return; }
    if (props()?.projectMenu) return;
    this.git = {}; // where() -> { name, branch, ahead, behind, repo, linked }, null: not a repo
    this.checked = {}; // where() -> when it was last looked at
    this.unsure = new Set(); // where()s git couldn't answer for (a machine away)
    this.pending = new Set(); // where()s to look at next
    this.busy = {}; // pane -> an agent working or a program in front of its shell
    this.ready = {}; // machine -> its layout was readable at the last look
    this.at = {}; // space -> its where() at the last look
    this.watching = new Set(); // local repos' git folders
    // Spaces made while this runs wait (at most a moment) for their git, so a
    // worktree appears under its repo instead of jumping there.
    this.shown = new Set(spaces().map((s) => s.id));
    this.born = {};
    this.pressed = null;
    this.over = null;
    this.machines = [];
    this.reconnecting = JSON.parse(localStorage.getItem("machines.reconnecting") ?? "{}");
    for (const state of Object.values(this.reconnecting)) state.busy = false;
    this.folded = new Set(JSON.parse(localStorage.getItem("machines.folded") ?? "[]"));
    this.foldedProjects = new Set(JSON.parse(localStorage.getItem("projects.folded") ?? "[]"));
    // sweetherdr: the projects added by hand, kept in sweetherdr/settings.json.
    this.projects = []; this.assigned = {}; this.projectBySpace = {}; this.settingsRaw = null; this.joining = null;
    this.naming = false;
    this.nameInput = InputState.new({ placeholder: "project name, then enter" });
    this.nameInput.on("submit", (_e, cx) => this.createProject(cx));
    this.nameInput.on("blur", (_e, cx) => { this.naming = false; cx.notify(); });
    cx.spawn(async (cx) => { await this.loadSettings(); cx.notify(); });
    this.refreshMachines(cx);
    cx.timer.every(15000, cx => this.refreshMachines(cx));
    // Refresh only when the refs could have changed (see `due`).
    cx.timer.every(250, (cx) => this.checkNew(cx));
  }

  async loadSettings() {
    const raw = await readTextFile(SETTINGS()).catch(() => null);
    this.settingsRaw = raw;
    try { this.settings = raw ? JSON.parse(raw) : {}; } catch { this.settings = {}; }
    // { name } each; older lists held folders, which now only lend their name.
    const seen = new Set();
    this.projects = (Array.isArray(this.settings.projects) ? this.settings.projects : [])
      .map((p) => ({ name: typeof p === "string" ? base(p) : p?.name }))
      .filter((p) => typeof p.name === "string" && p.name && !seen.has(p.name) && seen.add(p.name));
    this.assigned = this.settings.spaces && typeof this.settings.spaces === "object" ? this.settings.spaces : {};
  }
  // `change(projects, assigned)` edits copies of both; they are written to
  // sweetherdr/settings.json and every copy of this mod reads them again.
  async save(change) {
    await this.loadSettings();
    const projects = this.projects.map((p) => ({ ...p })), assigned = { ...this.assigned };
    const next = change(projects, assigned) ?? projects;
    // Spaces that are gone (this computer's ids have no machine prefix) are forgotten.
    const live = new Set(spaces().map((x) => x.id));
    for (const id of Object.keys(assigned)) if (!id.includes("/") && !live.has(id)) delete assigned[id];
    const text = JSON.stringify({ ...this.settings, projects: next, spaces: assigned }, null, 2) + "\n";
    try {
      await writeTextFile(SETTINGS(), text, this.settingsRaw);
      this.settingsRaw = text; this.projects = next; this.assigned = assigned;
      this.rev = Date.now(); setShared("sweetherdr.projects.rev", this.rev);
    } catch (e) { notify({ title: "could not save your projects", body: String(e.message ?? e), level: "error" }); }
  }
  // Add project: asks for a name, in a box under the Spaces heading.
  addProject(cx) {
    this.naming = !this.naming;
    this.nameInput.set_value("");
    if (this.naming) cx.timer.after(100, () => this.nameInput.focus());
    cx.notify();
  }
  createProject(cx) {
    const name = this.nameInput.value().trim().replace(/\s+/g, " ");
    this.naming = false;
    if (!name) return cx.notify();
    if (this.projects.some((p) => p.name === name)) { notify({ title: `there is already a project called ${name}`, level: "warning" }); return cx.notify(); }
    cx.spawn(async (cx) => {
      await this.save((projects) => { projects.push({ name }); });
      this.foldedProjects.delete(`p:${name}`);
      cx.notify();
    });
  }
  // Puts a space in a project ("" takes it out of every project).
  assign(id, name, cx) {
    cx.spawn(async (cx) => { await this.save((_projects, assigned) => { assigned[id] = name; }); cx.notify(); });
  }
  // A new space made from a project's + joins it once Herdr has made it.
  startIn(name) {
    this.joining = { name, known: new Set(spaces().map((x) => x.id)), until: Date.now() + 8000 };
    run("space.new");
  }

  // A project's right-click menu. Nothing here touches a folder or a file: it
  // only closes spaces (their terminals end) and edits the project list, and
  // each item asks first, in a dialog.
  projectMenu(t) {
    const m = props().projectMenu, n = m.spaces.length, plural = n === 1 ? "" : "s";
    const ask = (action) => () => {
      closeOverlay(props().overlay);
      openOverlay({ mod: "sweetspaces", kind: "dialog", frame: "none", width: 440, height: 190, props: { projectConfirm: { ...m, action } } });
    };
    const item = (id, icon, label, action, danger) => h_flex().id(`pm-${id}`).h(31).px(13).gap(9).rounded(0).items_center()
      .text_color(t.foreground).hover((el) => el.bg(t.hover)).cursor_pointer().on_click(action)
      .child(svg(`mods/workspace-chrome/${icon}.svg`).size(14).flex_none().text_color(danger ? t.blocked : t.muted))
      .child(div().flex_1().min_w(0).truncate().child(label));
    return v_flex().w_full().py(5).rounded(XS).bg(t.popover).border_1().border_color(t.input).text_size(12.8)
      .child(div().px(13).pt(4).pb(6).text_size(11).text_color(t.dim).truncate().child(m.name))
      .when(n === 0, (el) => el.child(item("remove", "archive", "remove project…", ask("remove"), true)))
      .when(n > 0, (el) => el
        .child(item("close", "x", `close its ${n} space${plural}…`, ask("close")))
        .child(item("ungroup", "archive", `remove project, keep space${plural}…`, ask("remove")))
        .child(item("remove", "archive", `remove project, close space${plural}…`, ask("remove-close"), true)))
      .child(div().px(13).pt(6).pb(4).text_size(10.5).text_color(t.dim).child("folders and files stay on disk."));
  }

  // The dialog that asks before a project is removed or its spaces are closed.
  // action: "remove" (its spaces stay open), "remove-close", "close" (the project stays).
  projectConfirm(t) {
    const m = props().projectConfirm, n = m.spaces.length, plural = n === 1 ? "" : "s", closes = m.action !== "remove" && n > 0;
    const title = m.action === "close" ? `close ${n} space${plural} in ${m.name}?` : `remove project ${m.name}?`;
    const detail = [
      m.action === "close" ? "the project stays in the sidebar." : n === 0 ? "" : closes ? "" : `its ${n} space${plural} stay${n === 1 ? "s" : ""} open and move${n === 1 ? "s" : ""} out of the project.`,
      closes ? `${n === 1 ? "its space" : `its ${n} spaces`} will be closed. that ends ${n === 1 ? "its" : "their"} terminals and any agents running in ${n === 1 ? "it" : "them"}.` : "",
      "no folders or files are deleted.",
    ].filter(Boolean).join(" ");
    const cancel = () => closeOverlay(props().overlay);
    const yes = (cx) => {
      if (this.confirming) return;
      this.confirming = true;
      if (closes) for (const id of m.spaces) run("space.close", { id, confirmed: true });
      if (m.action === "close") return cancel();
      cx.spawn(async () => {
        await this.save((projects, assigned) => {
          for (const [id, name] of Object.entries(assigned)) if (name === m.name) delete assigned[id];
          return projects.filter((p) => p.name !== m.name);
        });
        cancel();
      });
    };
    const button = (id, label, bg, fg, border, action) => h_flex().id(id).h(32).px(14).items_center().rounded(XS).border_1().border_color(border).bg(bg).text_color(fg)
      .hover((s) => s.opacity(0.88)).cursor_pointer().on_click(action).child(label);
    return v_flex().id("project-confirm").track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "enter") yes(cx);
        else if (e.key === "escape") cancel();
        else return;
        cx.stop_propagation();
      })
      .size_full().min_h(0).p(18).gap(12).rounded(XS).bg(t.popover).border_1().border_color(t.input).text_size(13)
      .child(h_flex().items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(15).font_semibold().text_color(t.foreground).child(title))
        .child(div().flex_none().text_size(11).text_color(t.dim).child("esc")))
      .child(div().flex_1().min_h(0).text_color(t.muted).child(detail))
      .child(h_flex().justify_end().gap(8).text_size(12)
        .child(button("no", "cancel", t.raised, t.foreground, t.input, cancel))
        .child(button("yes", m.action === "close" ? "close spaces" : closes ? "remove and close" : "remove", closes ? t.blocked : t.solid, closes ? t.background : t.solid_foreground, closes ? t.blocked : t.solid, (_e, cx) => yes(cx))));
  }

  checkNew(cx) {
    const rev = shared("sweetherdr.projects.rev") ?? 0;
    if (rev !== this.rev) { this.rev = rev; cx.spawn(async (cx) => { await this.loadSettings(); cx.notify(); }); }
    // sweetherdr: the space a project's + asked for has appeared: it joins that project.
    if (this.joining) {
      const fresh = spaces().find((x) => !this.joining.known.has(x.id));
      if (fresh) { const name = this.joining.name; this.joining = null; this.assign(fresh.id, name, cx); }
      else if (Date.now() > this.joining.until) this.joining = null;
    }
    const now = Date.now();
    const sp = spaces();
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    const due = this.due(now, sp, panes());
    if (due.size) this.refreshGit(due, cx);
    if (sp.some((s) => !this.shown.has(s.id)) || this.orderingDue(now)) cx.notify();
  }

  // Places whose git could have changed: new ones (a new space, a cd), where a
  // command or an agent's turn just ended (a checkout, a commit, edits), those on
  // a machine that is back, and repos in view whose fallback is due.
  due(now, sp, ps) {
    // Moved there: what it knew of that place may be old.
    const at = {};
    for (const s of sp) at[s.id] = where(s, ps);
    const keys = new Set(Object.values(at).filter((k) => JSON.parse(k)[1]));
    const due = new Set([...keys].filter((k) => !(k in this.git)));
    for (const [id, k] of Object.entries(at)) if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane]) this.sameRepo(at[spaceOf[p.tab].id], keys).forEach((k) => due.add(k));
    }
    this.busy = busy;
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name] === false) for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k);
      this.ready[m.name] = ready;
    }
    if (window().active) {
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k);
        if (asks && !this.folded.has(JSON.parse(k)[0]) && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
      }
    }
    return due;
  }

  // `key` and the other places in its repo (a commit there moves their ahead/behind).
  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : [])];
  }

  refreshMachines(cx) {
    cx.spawn(async cx => {
      try { const r = await hc(["machine", "ls", "--json"]); if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary); } catch {}
      cx.notify();
    });
  }

  rebuilt(machine) {
    return machine?.state === "unreachable" && /^a different core answers there \("[^"]+"\)$/.test(machine.why ?? "");
  }

  reconnect(machine, cx) {
    const name = machine.name;
    if (this.reconnecting[name]?.busy) return;
    const state = this.reconnecting[name] ??= { machine, removed: false };
    state.busy = true;
    state.error = null;
    localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
    cx.notify();
    cx.spawn(async cx => {
      try {
        const ask = async args => {
          const r = await hc([...args, "--json"]);
          if (r.code !== 0) {
            let error;
            try { error = JSON.parse(r.stdout || r.stderr).error?.message; } catch {}
            throw new Error(error || r.stderr || r.stdout || "couldn't connect.");
          }
        };
        if (!state.removed) {
          await ask(["machine", "rm", name]);
          state.removed = true;
          localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
        }
        const args = ["machine", "add"];
        if (machine.via) args.push("--via", machine.target);
        else args.push(machine.target);
        args.push("--name", name);
        if (machine.session) args.push("--session", machine.session);
        if (machine.temporary) args.push("--temp");
        await ask(args);
        this.folded.delete(name);
        localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
        delete this.reconnecting[name];
      } catch (e) {
        state.error = String(e.message ?? e);
        state.busy = false;
      }
      localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
      this.refreshMachines(cx);
      cx.notify();
    });
  }

  // One look at a time, each place once however often it was asked for meanwhile.
  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        await Promise.all(keys.map((key) => this.check(key, cx)));
      }
      const used = new Set(Object.values(this.git).filter(Boolean).map((g) => JSON.parse(g.repo)).filter(([on]) => !on).map(([, repo]) => repo));
      for (const repo of this.watching) if (!used.has(repo)) this.watching.delete(repo);
      this.refreshing = false;
      cx.notify();
    });
  }

  // One place's git: branch, ahead/behind, its repo.
  async check(key, cx) {
    const [on, cwd] = JSON.parse(key);
    this.checked[key] = Date.now();
    this.unsure.delete(key);
    try {
      // Ref-only reads avoid scanning the worktree or waking its index watch.
      // Two reads: a folder name may itself contain a newline.
      const [r, common] = await Promise.all([
        exec("git", ["rev-parse", "--path-format=absolute", "--show-toplevel"], { cwd, on }),
        exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on }),
      ]);
      if (r.code !== 0 || common.code !== 0) {
        // Only git's own "no" is remembered as no repo; anything else is asked again.
        if (!/not a git repository/i.test(r.code !== 0 ? r.stderr : common.stderr)) this.unsure.add(key);
        this.git[key] = null;
        return;
      }
      // The repo's own .git folder names it; a worktree's top differs from it.
      const top = r.stdout.replace(/\n$/, ""), repo = common.stdout.replace(/\n$/, "");
      // sweetherdr: the uncommitted count too. --no-optional-locks leaves the index alone,
      // so the read never wakes the .git watch that asked for it.
      const [branch, counts, status] = await Promise.all([
        exec("git", ["symbolic-ref", "-q", "HEAD"], { cwd, on }),
        exec("git", ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], { cwd, on }),
        exec("git", ["--no-optional-locks", "status", "--porcelain"], { cwd, on }),
      ]);
      const dirty = status.code === 0 ? status.stdout.split("\n").filter(Boolean).length : 0;
      const name = repo.endsWith("/.git") ? base(repo.slice(0, -5)) : base(repo).replace(/\.git$/, "");
      const [ahead, behind] = counts.code === 0 ? counts.stdout.trim().split(/\s+/).map(Number) : [0, 0];
      const info = { name, branch: branch.code === 0 ? branch.stdout.trim().replace(/^refs\/heads\//, "") : "(detached)", ahead, behind, dirty, repo: JSON.stringify([on, repo]), linked: repo !== `${top}/.git` };
      this.git[key] = info;
      if (!on) this.watch(repo, cx);
    } catch {
      // Couldn't ask (the machine is away): keep what it showed, look again later.
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }

  watch(repo, cx) {
    if (this.watching.has(repo)) return;
    this.watching.add(repo);
    cx.spawn(async (cx) => {
      try {
        while (this.watching.has(repo)) {
          await watchFolder(repo);
          const mine = JSON.stringify([null, repo]);
          if (this.watching.has(repo)) this.refreshGit(Object.keys(this.git).filter((k) => this.git[k]?.repo === mine), cx);
        }
      } catch { this.watching.delete(repo); }
    });
  }

  menu(w) {
    // A popup is as tall as its items; height is only the most.
    openOverlay({ mod: "sweetmenu", kind: "popup", frame: "none", width: 200, height: 260, props: { tab: "space", target: { id: w.id } } });
  }

  orderingDue(now) {
    return this.ordering && now - this.ordering.at >= 1000
      && this.ordering.machines.every(name => machines().some(m => m.name === name && m.layout === "ready"));
  }

  // Spaces in order, each worktree space moved under its main checkout's, and
  // (sweetherdr) spaces of one project next to each other.
  ordered() {
    const sp = spaces(), ps = panes();
    const ready = (w) => this.shown.has(w.id) || where(w, ps) in this.git || Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    const list = sp.map((w, i) => ({ w, i, g: this.git[where(w, ps)] ?? null }));
    const mains = new Set(list.filter((r) => r.g && !r.g.linked).map((r) => r.g.repo));
    const nested = (r) => r.g?.linked && mains.has(r.g.repo);
    const out = [];
    const placed = new Set(); // repos whose worktrees are listed (under the first of its spaces)
    for (const r of list) {
      if (nested(r)) continue;
      out.push({ ...r, tree: null });
      if (!r.g || r.g.linked || placed.has(r.g.repo)) continue;
      placed.add(r.g.repo);
      const kids = list.filter((k) => nested(k) && k.g.repo === r.g.repo);
      kids.forEach((k, n) => out.push({ ...k, tree: n === kids.length - 1 ? "└─" : "├─" }));
    }
    // sweetherdr: within each machine, spaces without a project first, then each
    // project's spaces together, projects in the order they were made. A
    // worktree row follows its checkout's row, so it takes that row's project.
    let last = null;
    for (const r of out) { r.project = r.tree && last ? last.project : projectOf(r.w, this.projects, this.assigned); if (!r.tree) last = r; }
    this.projectBySpace = Object.fromEntries(out.map((r) => [r.w.id, r.project?.name ?? ""]));
    const rank = new Map(this.projects.map((p, n) => [`p:${p.name}`, n + 1]));
    const machineRank = new Map();
    for (const r of out) if (!machineRank.has(r.w.machine ?? null)) machineRank.set(r.w.machine ?? null, machineRank.size);
    const position = new Map(out.map((r, n) => [r, n]));
    out.sort((a, b) => machineRank.get(a.w.machine ?? null) - machineRank.get(b.w.machine ?? null)
      || (rank.get(a.project?.key) ?? 0) - (rank.get(b.project?.key) ?? 0)
      || position.get(a) - position.get(b));
    // Simulate the batch so later indexes include earlier moves. An attempted
    // write can lose a sync conflict: allow the echo to settle before retrying.
    const order = sp.map(w => w.id);
    const target = out.map(r => r.w.id);
    const key = JSON.stringify([order, target, machines()]);
    if (order.every((id, i) => id === target[i])) {
      this.ordering = null;
    } else if (this.ordering?.key !== key || this.orderingDue(Date.now())) {
      const moved = new Set();
      this.ordering = { key, at: Date.now(), machines: [] };
      for (let i = 0; i < out.length; i++) {
        const from = order.indexOf(out[i].w.id);
        if (from === i) continue;
        run("space.move", { id: out[i].w.id, index: i + 1 });
        moved.add(out[i].w.machine ?? null);
        order.splice(i, 0, order.splice(from, 1)[0]);
      }
      this.ordering.machines = [...moved];
    }
    return out.filter(r => this.shown.has(r.w.id));
  }

  // The rows, under a header per machine once one isn't this computer.
  grouped(t, collapsed) {
    const rows = this.ordered();
    const one = (r) => (collapsed ? this.compact(r, t) : this.row(r, t));
    // sweetherdr: a header per project, in the order they were made; spaces in no
    // project come first. `local`: this computer's rows (empty projects show there).
    const drawAll = (list, local) => {
      if (collapsed || !this.projects.length) return list.map(one);
      const everySpace = spaces();
      const head = (p, mine) => {
        const key = `p:${p.name}`, folded = this.foldedProjects.has(key), active = mine.some((x) => x.w.active);
        const els = [h_flex().id(`project-${key}`).h(26).flex_none().pl(16).pr(10).gap(7).items_center().text_size(11).text_color(folded && active ? t.foreground : t.dim)
          .hover((s) => s.bg(t.hover))
          .cursor_pointer().on_click((_e, cx) => {
            folded ? this.foldedProjects.delete(key) : this.foldedProjects.add(key);
            localStorage.setItem("projects.folded", JSON.stringify([...this.foldedProjects]));
            cx.notify();
          })
          // A space dragged onto the heading joins the project.
          .on_mouse_up("left", (_e, cx) => {
            if (this.pressed === null) return;
            const id = this.pressed;
            this.pressed = null; this.over = null;
            if ((this.projectBySpace?.[id] ?? "") !== p.name) this.assign(id, p.name, cx);
            cx.notify();
          })
          .on_mouse_down("right", () => openOverlay({ mod: "sweetspaces", kind: "popup", frame: "none", width: 260, height: 190,
            props: { projectMenu: { name: p.name, spaces: everySpace.filter((x) => (this.projectBySpace?.[x.id] ?? "") === p.name).map((x) => x.id) } } }))
          .child(svg("mods/workspace-chrome/folder.svg").size(13).flex_none())
          .child(div().flex_1().min_w(0).truncate().child(p.name))
          .child(div().flex_none().child(String(mine.filter((x) => !x.tree).length)))
          .child(div().id(`project-add-${key}`).size(20).flex_none().flex().items_center().justify_center().rounded(0)
            .text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(`new space in ${p.name}`)
            .cursor_pointer().on_click((_e, cx) => {
              cx.stop_propagation();
              this.foldedProjects.delete(key);
              localStorage.setItem("projects.folded", JSON.stringify([...this.foldedProjects]));
              this.startIn(p.name);
              cx.notify();
            })
            .child(svg("mods/workspace-chrome/plus.svg").size(12)))
          .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(11).flex_none())];
        return els;
      };
      const els = list.filter((r) => !r.project).map(one);
      for (const p of this.projects) {
        const mine = list.filter((r) => r.project?.key === `p:${p.name}`);
        if (!mine.length && !local) continue;
        els.push(...head(p, mine));
        if (!this.foldedProjects.has(`p:${p.name}`)) els.push(...mine.map(one));
      }
      return els;
    };
    const remote = [...new Set([...rows.map(r => r.w.machine).filter(Boolean), ...this.machines.map(m => m.name), ...Object.keys(this.reconnecting)])].sort();
    const loading = m => {
      const layout = machines().find(k => k.name === m)?.layout;
      return layout === "loading" || (!layout && this.machines.some(k => k.name === m && k.state === "connected"))
        || spaces().some(s => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    const loadingRow = m => h_flex().id(`machine-loading-${m ?? "local"}`).h(28).flex_none().px(collapsed ? 0 : 16).items_center().when(collapsed, el => el.justify_center()).text_size(12).text_color(t.dim).child(collapsed ? "…" : "loading…");
    if (!remote.length) return loading(null) && !rows.length ? [loadingRow(null)] : drawAll(rows, true);
    const machineNames = [null, ...remote];
    return machineNames.flatMap((m) => {
      const mine = rows.filter((r) => (r.w.machine ?? null) === m);
      const repair = this.reconnecting[m];
      const machine = this.machines.find(k => k.name === m) ?? repair?.machine;
      const connected = !m || machine?.state === "connected";
      const rebuilt = this.rebuilt(machine) || !!repair;
      const login = machine?.state === "needs_login" ? `hc machine login ${m}` : null;
      const folded = this.folded.has(m);
      const icon = svg(`mods/workspace-chrome/${m ? "server" : "monitor"}.svg`).size(13).flex_none();
      const badge = div().absolute().right(-3).bottom(-2).size(6).rounded(0).border_1().border_color(t.chrome).bg(connected ? t.ansi2 : t.dim);
      const head = h_flex().id(`machine-${m ?? "local"}`).h(26).flex_none().px(collapsed ? 0 : 16).gap(7).items_center().text_size(11).text_color(t.dim)
        .when(collapsed, el => el.mt(4).w(RAIL_CELL).justify_center().rounded(0).tooltip(login ? `${m} needs a login: run ${login}. click for copy.` : m ? `${m} · ${connected ? "connected" : (machine?.state ?? "asleep").replace(/_/g, " ")}` : "this computer"))
        .hover(s => s.bg(t.hover))
        .cursor_pointer().on_click((_e, cx) => {
          if (collapsed && login) { openOverlay({ mod: "sweetsettings", kind: "dialog", frame: "none", width: 880, height: 620, props: { section: "machines" } }); return; }
          folded ? this.folded.delete(m) : this.folded.add(m);
          localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
          cx.notify();
        })
        .when(!collapsed, el => el.child(icon))
        .when(collapsed, el => el.child(div().relative().flex_none().child(icon).when(Boolean(m), el => el.child(badge))))
        .when(!collapsed, el => el.child(div().flex_1().truncate().child(m ?? "this computer"))
          .when(!connected && !rebuilt && !login, el => el.child(div().flex_none().child((machine?.state ?? "asleep").replace(/_/g, " "))))
          .when(rebuilt, el => el.child(h_flex().flex_none().gap(3).items_center()
            .child(div().max_w(140).truncate().child(repair?.error || "rebuilt ·"))
            .child(div().id(`machine-connect-${m}`).text_color(repair?.error ? t.blocked : t.muted)
              .hover(s => s.text_color(t.foreground))
              .tooltip(repair?.error || "this machine was rebuilt or replaced. click to connect to the new one.")
              .cursor_pointer().on_click((_e, cx) => { cx.stop_propagation(); this.reconnect(machine, cx); })
              .child(repair?.busy ? "connecting…" : "connect"))))
          .when(connected, el => el.child(div().id(`machine-add-${m ?? "local"}`).flex_none().px(4).rounded(0).hover(s => s.bg(t.hover).text_color(t.foreground))
            .cursor_pointer().on_click((_e, cx) => { cx.stop_propagation(); run("space.new", { machine: m ?? "" }); }).child("+")))
          .child(div().size(6).rounded(0).flex_none().bg(connected ? t.ansi2 : t.dim))
          .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(11).flex_none()));
      const empty = h_flex().id(`machine-new-${m ?? "local"}`).h(28).flex_none().px(collapsed ? 0 : 16).gap(7).items_center().rounded(0)
        .text_size(12).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
        .cursor_pointer().on_click(() => run("space.new", { machine: m ?? "" }))
        .when(collapsed, el => el.w(RAIL_CELL).rounded(0).justify_center().tooltip(`new space on ${m ?? "this computer"}`)
          .child(h_flex().size(18).rounded(0).border_1().border_color(t.dim).items_center().justify_center()
            .child(svg("mods/workspace-chrome/plus.svg").size(10))))
        .when(!collapsed, el => el.child(svg("mods/workspace-chrome/plus.svg").size(12)).child("new space there"));
      if (!collapsed && rebuilt) return [head];
      const cell = collapsed ? railCell : (el) => el;
      const guidance = !collapsed && login ? [v_flex().px(16).pb(6).gap(3).flex_none()
        .child(div().text_size(11).text_color(t.blocked).child("needs a login: run"))
        .child(h_flex().gap(5).items_center()
          .child(div().flex_1().min_w(0).truncate().tooltip(login).text_size(11).text_color(t.muted).child(login))
          .child(div().id(`machine-login-copy-${m}`).flex_none().px(5).py(2).rounded(0)
            .text_size(11).text_color(t.foreground).bg(t.raised).hover(s => s.bg(t.hover))
            .cursor_pointer().on_click((_e, cx) => { cx.stop_propagation(); cx.write_to_clipboard(login); this.copiedLogin = login; cx.notify(); })
            .child(this.copiedLogin === login ? "copied" : "copy")))] : [];
      return [cell(head), ...guidance, ...(folded ? [] : mine.length ? drawAll(mine, !m) : [loading(m) ? loadingRow(m) : cell(empty)])];
    });
  }

  // Only what's unusual, after the name: "herdr \u00b7 spike \u21912 \u21931". The repo or
  // branch goes when the name already says it (a worktree is named after its branch),
  // and master/main go: nearly every space is on one.
  gitTail(g, tree, name, t) {
    const raw = g.branch ?? "detached";
    const same = (a) => a.toLowerCase() === name.toLowerCase();
    const branch = same(raw) || raw === "master" || raw === "main" ? "" : raw;
    const repo = tree || same(g.name) ? "" : g.name;
    const where = [repo, branch].filter(Boolean).join(" \u00b7 ");
    return h_flex()
      .flex_1()
      .min_w(0)
      .gap(5)
      .justify_end()
      .items_center()
      .text_size(11.5)
      .text_color(t.dim)
      .when(Boolean(where), (el) => el.child(div().min_w(0).truncate().child(where)))
      .when(g.dirty > 0, (el) => el.child(div().flex_none().text_color(t.ansi3).child(`\u00b1${g.dirty}`)))
      .when(g.ahead > 0, (el) => el.child(div().flex_none().text_color(t.ansi2).child(`\u2191${g.ahead}`)))
      .when(g.behind > 0, (el) => el.child(div().flex_none().text_color(t.ansi1).child(`\u2193${g.behind}`)));
  }

  row({ w, i, g, tree, project }, t) {
    const on = w.active;
    const fromIndex = this.pressed === null ? -1 : spaces().findIndex(s => s.id === this.pressed);
    const colors = shared("space.colors") ?? {};
    const color = colors[w.id] ?? "ansi6";
    const fill = color.startsWith("#") ? color : (MARK[color] ?? t[color]);
    return v_flex()
      .relative()
      .id(`space-${w.id}`)
      // sweetherdr: in a project, a space starts under the project's name.
      .pl(project ? 36 : 16)
      .pr(16)
      .h(rowHeight({ tree }))
      .flex_none()
      .justify_center()
      .rounded(0)
      .cursor_pointer()
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .when(this.pressed === w.id && this.over !== w.id, (el) => el.opacity(0.5))
      .when(this.pressed !== null && this.over === w.id && this.pressed !== w.id, (el) => el.child(
        div().absolute().left(0).right(0).h(2).bg(t.accent)
          .when(fromIndex < i, line => line.bottom(0))
          .when(fromIndex > i, line => line.top(0)),
      ))
      .on_mouse_down("left", () => {
        this.pressed = w.id;
        this.over = w.id;
      })
      .on_mouse_move((_e, cx) => {
        const source = spaces().find(s => s.id === this.pressed);
        const over = source && (source.machine ?? null) === (w.machine ?? null) ? w.id : null;
        if (this.pressed !== null && this.over !== over) {
          this.over = over;
          cx.notify();
        }
      })
      .on_mouse_up("left", (_e, cx) => {
        const from = this.pressed;
        const over = this.over;
        this.pressed = null;
        this.over = null;
        if (from !== null && over === w.id && from !== w.id) {
          const index = spaces().findIndex(s => s.id === w.id);
          if (index !== -1) run("space.move", { id: from, index: index + 1 });
          // sweetherdr: dropped on a space, it joins that space's project (or none).
          if ((this.projectBySpace?.[from] ?? "") !== (project?.name ?? "")) this.assign(from, project?.name ?? "", cx);
        } else if (from === w.id) run("space.select", { id: w.id });
        cx.notify();
      })
      .on_mouse_down("right", () => this.menu(w))
      .child(
        h_flex()
          .gap(9)
          .items_center()
          .when(Boolean(tree), el => el.pl(22).child(svg("mods/workspace-chrome/branch.svg").size(13).text_color(t.dim)))
          .when(!tree, el => el.child(h_flex().size(18).flex_none().rounded(0).bg(fill).items_center().justify_center().text_size(10.5).font_bold().text_color("#ffffff").child([...w.name][0]?.toLowerCase() ?? "?")))
          .child(div().flex_shrink(0).max_w(150).truncate().text_color(t.foreground).child(w.name))
          .child(g ? this.gitTail(g, tree, w.name, t) : div().flex_1()),
      );
  }

  compact({ w, i }, t) {
    return railCell(h_flex()
      .id(`space-${w.id}`)
      .relative()
      .w(RAIL_CELL)
      .h(26)
      .rounded(0)
      .justify_center()
      .items_center()
      .when(w.active, (el) => el.bg(t.selected))
      .when(!w.active, (el) => el.hover((s) => s.bg(t.hover)))
      .cursor_pointer().on_click(() => run("space.select", { id: w.id }))
      .child(div().text_color(w.active ? t.foreground : t.muted).child(String(i + 1)))
      .child(div().absolute().right(5).text_color(tone(t, w.status)).child(glyph(w.status))));
  }

  render() {
    const t = theme();
    if (props()?.projectMenu) return this.projectMenu(t);
    if (props()?.projectConfirm) return this.projectConfirm(t);
    const collapsed = narrow();
    const palette = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
    const sp = spaces();
    const ids = new Set(sp.map(p => p.id));
    const kept = Object.fromEntries(Object.entries(shared("space.colors") ?? {}).filter(([id]) => ids.has(id)));
    let changed = Object.keys(kept).length !== Object.keys(shared("space.colors") ?? {}).length;
    for (const p of sp) {
      if (kept[p.id] || p.name === "~") continue;
      const uses = c => Object.values(kept).filter(v => v === c).length;
      kept[p.id] = palette.reduce((best, c) => uses(c) < uses(best) ? c : best);
      changed = true;
    }
    if (changed) setShared("space.colors", kept);
    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(13)
      .child(h_flex().h(31).pl(16).pr(10).items_center().justify_between().text_size(11.5).text_color(t.dim)
        .when(collapsed, el => el.pl(0).pr(0).justify_center())
        .when(!collapsed, el => el.child("spaces"))
        .child(h_flex().flex_none().items_center()
          .when(!collapsed, el => el.child(div().id("project-new").size(26).flex_none().flex().items_center().justify_center().rounded(0).hover(s => s.bg(t.hover).text_color(t.foreground))
            .tooltip("new project: a name for a group of spaces").cursor_pointer().on_click((_e, cx) => this.addProject(cx)).child(svg("mods/workspace-chrome/folder-plus.svg").size(14))))
          .child(div().id("space-new").size(26).flex_none().flex().items_center().justify_center().rounded(0).hover(s => s.bg(t.hover).text_color(t.foreground))
            .tooltip("new space").cursor_pointer().on_click(() => run("space.new")).child(svg("mods/workspace-chrome/plus.svg").size(14)))))
      .when(this.naming && !collapsed, el => el.child(h_flex().h(34).flex_none().px(16).items_center()
        .child(div().id("project-name").flex_1().min_w(0).h(26).px(8).flex().items_center().rounded(0).border_1().border_color(t.accent).cursor_text()
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.nameInput).h_full().text_size(12).text_color(t.foreground)))))
      .child(v_flex().flex_1().min_h(0).pb(14).overflow_y_scrollbar().mode("always")
        .on_mouse_up("left", (_e, cx) => { this.pressed = null; cx.notify(); })
        .children(this.grouped(t, collapsed)));
  }
}
