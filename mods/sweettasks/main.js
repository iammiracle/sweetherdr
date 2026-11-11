// sweettasks: a task board per project, kept by the person and their agents:
// To do, Doing, Done as columns, or as one list. Opens as a tab of its own from
// the tab bar's Tasks button.
// Each project's tasks are a plain markdown file under
// ~/.config/herdr-app/sweetherdr/tasks/: "- [ ] task" is to do, "- [~] task" is
// being done, "- [x] task" is done, so an agent moves a task by editing it.
// A task can go to the focused agent, to a new agent, or to a new agent in a
// git worktree of its own; sending one moves it to Doing.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, panes, focused, agents, exec, hc, readTextFile, writeTextFile, watchFolder, knownAgents, run, notify, theme, appHome, home, settings } from "herdr";

const DIR = () => `${appHome()}/sweetherdr/tasks`;
const LINE = /^- \[( |x|X|~|\/)\] (.*)$/;
const STATES = [
  { key: "todo", mark: " ", title: "to do", hint: "no tasks here yet." },
  { key: "doing", mark: "~", title: "doing", hint: "nothing in progress." },
  { key: "done", mark: "x", title: "done", hint: "nothing done yet." },
];
const stateOf = (mark) => mark === " " ? "todo" : mark === "~" || mark === "/" ? "doing" : "done";

// Where the project is: the focused terminal's folder; from the Tasks tab itself
// (a mod pane has no folder), where the space's first terminal is.
function location() {
  const space = spaces().find((s) => s.active), f = focused(), all = panes();
  const pane = f?.pane ? all.find((p) => p.pane === f.pane) : null;
  const tabs = new Set((space?.tabs ?? []).map((tab) => tab.id));
  const first = all.find((p) => tabs.has(p.tab) && p.cwd)?.cwd;
  return { cwd: pane?.cwd || f?.cwd || first || space?.folder || home(), on: space?.machine ?? null };
}
const tilde = (path) => path === home() ? "~" : path.startsWith(home() + "/") ? `~${path.slice(home().length)}` : path;
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");

export default class Todo extends View {
  init(_props, cx) {
    this.items = []; this.raw = null; this.text = ""; this.root = null; this.repo = false; this.context = null;
    this.view = localStorage.getItem("view") ?? "board"; this.width = 900;
    this.input = InputState.new({ placeholder: "add a task, then enter" });
    this.input.on("change", () => { this.text = this.input.value(); });
    this.input.on("submit", (_e, cx) => this.add(cx));
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.resolve(cx);
    // Follows the focused terminal to another project (a no-op while it stays put).
    cx.timer.every(1500, (cx) => this.resolve(cx));
    // An agent ticking an item is a change to the file: watch the folder of lists.
    cx.spawn(async (cx) => {
      await exec("mkdir", ["-p", DIR()]);
      try { for (;;) { await watchFolder(DIR()); await this.load(); cx.notify(); } } catch { /* the timer below still reloads */ }
    });
    cx.timer.every(15000, (cx) => { cx.spawn(async (cx) => { await this.load(); cx.notify(); }); });
  }

  // The project is the repo that folder is in, else the folder itself.
  resolve(cx) {
    const { cwd, on } = location(), context = `${on ?? ""}:${cwd}`;
    if (context === this.context) return;
    this.context = context;
    cx.spawn(async (cx) => {
      let root = cwd, repo = false;
      try {
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
        if (top.code === 0 && top.stdout.trim()) { root = top.stdout.trim(); repo = true; }
      } catch { /* not a folder git can read: the folder itself is the project */ }
      if (this.context !== context) return;
      this.root = root; this.repo = repo && !on; this.file = `${DIR()}/${root.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+/, "") || "home"}.md`;
      this.raw = null; this.items = [];
      await this.load();
      cx.notify();
    });
  }

  async load() {
    if (!this.file) return;
    const file = this.file, raw = await readTextFile(file).catch(() => null);
    if (file !== this.file || raw === this.raw) return;
    this.raw = raw;
    this.items = (raw ?? "").split("\n").map((line, index) => ({ index, match: LINE.exec(line) }))
      .filter((l) => l.match).map((l) => ({ line: l.index, state: stateOf(l.match[1]), text: l.match[2] }));
  }

  // Every change rewrites the file from what it holds now, and only if nobody
  // (an agent) changed it since we read it; otherwise we read again.
  async save(change, cx) {
    await this.load();
    const lines = this.raw === null ? [`# Tasks: ${tilde(this.root)}`, ""] : this.raw.replace(/\n$/, "").split("\n");
    if (change(lines) === false) return;
    const text = lines.join("\n") + "\n";
    try { await writeTextFile(this.file, text, this.raw); }
    catch { this.raw = undefined; await this.load(); notify({ title: "the list changed under you", body: "it was read again. try once more.", level: "warning" }); }
    await this.load();
    cx.notify();
  }

  add(cx) {
    const text = this.text.trim().replace(/\s+/g, " ");
    if (!text || !this.file) return;
    this.text = ""; this.input.set_value("");
    cx.spawn((cx) => this.save((lines) => { lines.push(`- [ ] ${text}`); }, cx));
  }
  // to: "todo" | "doing" | "done", or null to delete.
  // The line must still say what the row says: an agent may have edited the file.
  move(item, cx, to) {
    cx.spawn((cx) => this.save((lines) => {
      if (LINE.exec(lines[item.line] ?? "")?.[2] !== item.text) return false;
      if (to === null) lines.splice(item.line, 1);
      else lines[item.line] = `- [${STATES.find((s) => s.key === to).mark}] ${item.text}`;
    }, cx));
  }
  clearDone(cx) {
    cx.spawn((cx) => this.save((lines) => {
      for (let i = lines.length - 1; i >= 0; i--) if (/^- \[[xX]\] /.test(lines[i])) lines.splice(i, 1);
    }, cx));
  }
  setView(view, cx) {
    this.view = view; localStorage.setItem("view", view); cx.notify();
  }

  brief(item) {
    return `${item.text}\n\nThis is a task from the list in ${this.file}. When it is done and checked, tick it off there: on the line that ends with "${item.text}", change the box to "[x]".`;
  }
  target() {
    const space = spaces().find((s) => s.active), all = agents();
    return all.find((a) => a.focused) ?? all.find((a) => a.address === focused()?.agent) ?? all.find((a) => a.space === space?.id) ?? null;
  }
  async agentToStart() {
    try { return (await knownAgents()).find((a) => a.installed) ?? null; } catch { return null; }
  }
  send(item, cx) {
    const to = this.target();
    if (!to) return this.start(item, cx);
    cx.spawn(async (cx) => {
      const r = await hc(["send", to.address, this.brief(item)]);
      if (r.code !== 0) return notify({ title: "could not send the task", body: (r.stderr || r.stdout).trim().split("\n")[0], level: "error" });
      notify({ title: `sent to ${to.program?.name ?? "the agent"}`, body: item.text, level: "success", timeout: 3000 });
      this.move(item, cx, "doing");
    });
  }
  start(item, cx) {
    cx.spawn(async (cx) => {
      const agent = await this.agentToStart();
      if (!agent) return notify({ title: "no agent is installed", body: "install claude code or codex to start one from a task.", level: "warning" });
      run("tab.new", { name: item.text.slice(0, 32), folder: this.root, argv: agent.run, task: this.brief(item) });
      this.move(item, cx, "doing");
    });
  }
  // A branch and a checkout of its own, where Herdr's worktree dialog puts them.
  worktree(item, cx) {
    if (!this.repo || this.busy != null) return;
    this.busy = item.line; cx.notify();
    cx.spawn(async (cx) => {
      try {
        const agent = await this.agentToStart();
        if (!agent) throw new Error("no agent is installed");
        const name = slug(item.text) || "task", branch = `task/${name}`;
        const path = `${home()}/.herdr/worktrees/${this.root.split("/").pop()}/task-${name}`;
        const made = await exec("git", ["worktree", "add", "-b", branch, path], { cwd: this.root, timeout: 120000 });
        if (made.code !== 0) throw new Error((made.stderr || made.stdout).trim().split("\n").pop());
        run("space.new", { folder: path, argv: agent.run, task: this.brief(item) });
        this.move(item, cx, "doing");
      } catch (e) { notify({ title: "could not start the worktree", body: String(e.message ?? e), level: "error" }); }
      finally { this.busy = null; cx.notify(); }
    });
  }

  render() {
    const t = theme(), by = { todo: [], doing: [], done: [] };
    for (const item of this.items) by[item.state].push(item);
    const stop = (_e, cx) => cx.stop_propagation(), color = { todo: t.input, doing: t.working, done: t.done };
    const button = (id, icon, action, on = true) => div().id(id).size(22).flex().flex_none().items_center().justify_center().rounded(0)
      .text_color(on ? t.dim : t.border).when(on, (el) => el.hover((s) => s.bg(t.hover).text_color(t.foreground)).on_mouse_down("left", stop).cursor_pointer().on_click(action))
      .child(icon.endsWith(".svg") ? svg(icon).size(13) : icon);
    // What an open item can do: go to an agent three ways.
    const sends = (item) => [
      button(`send-${item.line}`, "mods/sweettasks/send.svg", (_e, cx) => this.send(item, cx)),
      button(`new-${item.line}`, "mods/sweettasks/plus.svg", (_e, cx) => this.start(item, cx)),
      button(`tree-${item.line}`, "mods/workspace-chrome/branch.svg", (_e, cx) => this.worktree(item, cx), this.repo && this.busy == null),
    ];
    const remove = (item) => button(`del-${item.line}`, "mods/pane/close.svg", (_e, cx) => this.move(item, cx, null));

    // List: a box per item. A click ticks it (or unticks it); Doing shows a half box.
    const row = (item) => h_flex().id(`todo-${item.line}`).w_full().flex_none().px(8).py(5).gap(8).items_start().rounded(0).hover((s) => s.bg(t.hover))
      .child(div().id(`tick-${item.line}`).size(14).mt(2).flex_none().flex().items_center().justify_center().rounded(0).border_1()
        .border_color(item.state === "done" ? t.accent : item.state === "doing" ? t.working : t.input).bg(item.state === "done" ? t.accent : t.background)
        .cursor_pointer().on_click((_e, cx) => this.move(item, cx, item.state === "done" ? "todo" : "done"))
        .when(item.state === "done", (el) => el.child(svg("mods/workspace-chrome/check.svg").size(10).text_color(t.accent_foreground)))
        .when(item.state === "doing", (el) => el.child(div().size(6).rounded(0).bg(t.working))))
      .child(div().flex_1().min_w(0).text_color(item.state === "done" ? t.dim : t.foreground).when(item.state === "done", (el) => el.line_through()).child(item.text))
      .when(item.state !== "done", (el) => el.children(sends(item)))
      .child(remove(item));
    const heading = (state, count, extra) => h_flex().px(8).pt(12).pb(4).gap(6).items_center().text_size(10).text_color(t.dim)
      .child(div().size(6).flex_none().rounded(0).bg(color[state.key]))
      .child(div().flex_1().child(`${state.title} · ${count}`))
      .when(Boolean(extra), (el) => el.child(extra));
    const clear = () => div().id("todo-clear").hover((s) => s.text_color(t.foreground)).cursor_pointer().on_click((_e, cx) => this.clearDone(cx)).child("clear");
    const list = () => v_flex().id("todo-list").flex_1().min_h(0).overflow_y_scrollbar().p(6)
      .when(by.doing.length > 0, (el) => el.child(heading(STATES[1], by.doing.length)).children(by.doing.map(row)))
      .when(by.doing.length > 0 && by.todo.length > 0, (el) => el.child(heading(STATES[0], by.todo.length)))
      .children(by.todo.map(row))
      .when(by.done.length > 0, (el) => el.child(heading(STATES[2], by.done.length, clear())).children(by.done.map(row)))
      .when(!this.items.length, (el) => el.child(div().p(8).text_color(t.dim).child(this.root ? "no tasks here yet." : "finding the project…")));

    // Board: a card per item, moved a column left or right with its arrows.
    const card = (item) => {
      const at = STATES.findIndex((s) => s.key === item.state);
      return v_flex().id(`card-${item.line}`).w_full().flex_none().px(8).pt(7).pb(4).gap(4).rounded(0).bg(t.background).border_1().border_color(t.border)
        .child(div().w_full().min_w(0).text_color(item.state === "done" ? t.dim : t.foreground).when(item.state === "done", (el) => el.line_through()).child(item.text))
        .child(h_flex().w_full().items_center()
          .child(button(`left-${item.line}`, "←", (_e, cx) => this.move(item, cx, STATES[at - 1].key), at > 0))
          .child(button(`right-${item.line}`, "→", (_e, cx) => this.move(item, cx, STATES[at + 1].key), at < 2))
          .child(div().flex_1())
          .when(item.state !== "done", (el) => el.children(sends(item)))
          .child(remove(item)));
    };
    const column = (state, wide) => {
      const items = by[state.key];
      return v_flex().min_w(0).bg(t.chrome).border_1().border_color(t.border)
        .when(wide, (el) => el.flex_1().h_full().min_h(0)).when(!wide, (el) => el.w_full().flex_none())
        .child(h_flex().h(30).flex_none().px(8).gap(6).items_center().border_b(1).border_color(t.border).text_size(10.5)
          .child(div().size(6).flex_none().rounded(0).bg(color[state.key]))
          .child(div().flex_1().text_color(t.muted).child(state.title))
          .when(state.key === "done" && items.length > 0, (el) => el.child(clear().text_color(t.dim)))
          .child(div().text_color(items.length ? t.foreground : t.dim).child(String(items.length))))
        .child(v_flex().id(`todo-col-${state.key}`).p(6).gap(6)
          .when(wide, (el) => el.flex_1().min_h(0).overflow_y_scrollbar())
          .children(items.map(card))
          .when(!items.length, (el) => el.child(div().p(4).text_size(11).text_color(t.dim).child(state.hint))));
    };
    // Three columns need about 170px each; a narrow panel stacks them instead.
    const wide = this.width >= 540;
    const board = () => wide
      ? h_flex().flex_1().min_h(0).p(8).gap(8).items_start().children(STATES.map((s) => column(s, true)))
      : v_flex().id("todo-board").flex_1().min_h(0).overflow_y_scrollbar().p(8).gap(8).children(STATES.map((s) => column(s, false)));

    const seg = (view, label) => div().id(`todo-view-${view}`).h_full().px(10).flex().flex_none().items_center().rounded(0).text_size(11)
      .bg(this.view === view ? t.selected : t.background).text_color(this.view === view ? t.foreground : t.muted).hover((s) => s.text_color(t.foreground))
      .on_mouse_down("left", stop).cursor_pointer().on_click((_e, cx) => this.setView(view, cx)).child(label);
    const legend = (icon, label) => h_flex().gap(4).flex_none().items_center().child(svg(icon).size(11)).child(label);
    const open = by.todo.length + by.doing.length;
    return v_flex().id("todo").size_full().min_h(0).rounded(0).overflow_hidden().bg(t.background).text_color(t.foreground).text_size(13)
      // Sizes arrive after zoom; the 540 above is written before it.
      .on_size_change((size, cx) => { const width = size.width / (settings().zoom ?? 1); if (width !== this.width) { this.width = width; cx.notify(); } })
      // No title row: the pane header above already says Tasks.
      .child(h_flex().flex_none().p(10).gap(8).border_b(1).border_color(t.border)
        .child(div().id("todo-input").flex_1().min_w(0).h(32).px(10).flex().items_center().rounded(0).border_1().border_color(this.typing ? t.accent : t.border).cursor_text().on_mouse_down("left", stop)
          .child(Input.new(this.input).h_full().text_size(12).text_color(t.foreground)))
        .child(h_flex().h(32).flex_none().items_center().border_1().border_color(t.border).child(seg("list", "list")).child(seg("board", "board"))))
      .child(this.view === "board" ? board() : list())
      .child(h_flex().h(28).flex_none().px(12).gap(12).items_center().overflow_hidden().border_t(1).border_color(t.border).text_size(10).text_color(t.dim)
        .child(legend("mods/sweettasks/send.svg", "focused agent")).child(legend("mods/sweettasks/plus.svg", "new agent")).child(legend("mods/workspace-chrome/branch.svg", "own worktree"))
        .child(div().flex_1().min_w(0).truncate().text_right().child(this.root ? `${open} open · ${tilde(this.root)}` : "")));
  }
}
