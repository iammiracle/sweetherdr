// sweetskills: the skills, agents and MCP servers Claude Code and Codex have on
// this machine, side by side. A skill one tool lacks can be copied to it; a
// click shows its SKILL.md. Reads through skills.py; MCP shows names only.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, TextView } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, theme, layout, props, appHome, home, notify } from "herdr";

const TOOLS = [{ key: "claude", name: "claude code", dir: ".claude/skills" }, { key: "codex", name: "codex", dir: ".codex/skills" }];

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}
function showing() {
  const id = props()?.panel;
  if (!id) return true;
  const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body");
  return Boolean(panel && !panel.hidden && body?.active === id);
}
function folder() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  return space?.machine ? "" : pane?.cwd || f?.cwd || space?.folder || "";
}

export default class Skills extends View {
  init(_props, cx) {
    this.data = null; this.tab = "skills"; this.open = null; this.text = null; this.busy = null;
    this.refresh(cx);
    cx.timer.every(30000, (cx) => this.refresh(cx));
    // The first read waits until the panel shows; a new folder may bring project skills.
    cx.timer.every(1500, (cx) => { if (!this.data || folder() !== this.project) this.refresh(cx); });
  }

  refresh(cx, force) {
    if (this.loading || (!force && !showing())) return;
    this.loading = true; this.project = folder();
    cx.spawn(async (cx) => {
      try {
        const r = await exec("python3", [`${appHome()}/mods/sweetskills/skills.py`, this.project], { timeout: 30000 });
        if (r.code !== 0) throw new Error(r.stderr.trim().split("\n").pop() || "the reader failed");
        this.data = JSON.parse(r.stdout); this.error = null;
      } catch (e) { this.error = `could not read the skills: ${e.message ?? e}`; }
      finally { this.loading = false; cx.notify(); }
    });
  }

  show(skill, cx) {
    this.open = skill; this.text = null; cx.notify();
    if (!skill) return;
    const path = `${Object.values(skill.where)[0]}/SKILL.md`;
    cx.spawn(async (cx) => {
      const text = await readTextFile(path).catch(() => null);
      // The front matter is the description already shown above.
      if (this.open === skill) { this.text = text === null ? "could not read this skill's SKILL.md (missing or over 1 mb)." : text.replace(/^---\s*\n[\s\S]*?\n---\s*\n/, ""); cx.notify(); }
    });
  }

  // Copies a skill's folder to the tool that lacks it. Never overwrites.
  copy(skill, tool, cx) {
    const from = skill.where.claude ?? skill.where.codex ?? skill.where.project, to = `${home()}/${tool.dir}/${skill.name}`;
    if (!from || this.busy) return;
    this.busy = skill.name; cx.notify();
    cx.spawn(async (cx) => {
      try {
        const exists = await exec("test", ["-e", to]);
        if (exists.code === 0) throw new Error(`${tool.name} already has a ${skill.name}`);
        await exec("mkdir", ["-p", `${home()}/${tool.dir}`]);
        // -L: a skill that is a link here becomes real files there.
        const r = await exec("cp", ["-RL", from, to]);
        if (r.code !== 0) throw new Error(r.stderr.trim().split("\n")[0]);
        notify({ title: `copied to ${tool.name}`, body: skill.name, level: "success", timeout: 3000 });
      } catch (e) { notify({ title: "could not copy the skill", body: String(e.message ?? e), level: "error" }); }
      finally { this.busy = null; this.open = null; this.refresh(cx, true); }
    });
  }

  render() {
    const t = theme(), data = this.data, stop = (_e, cx) => cx.stop_propagation();
    const counts = { skills: data?.skills.length ?? 0, agents: data?.agents.length ?? 0, mcp: data?.mcp.length ?? 0 };
    const tab = (id, label) => h_flex().id(`skills-tab-${id}`).h(26).px(8).gap(5).flex_none().items_center().rounded(0).text_size(12)
      .border_b(2).border_color(this.tab === id ? t.accent : t.background).text_color(this.tab === id ? t.foreground : t.muted).hover((s) => s.text_color(t.foreground))
      .cursor_pointer().on_click((_e, cx) => { this.tab = id; this.open = null; cx.notify(); })
      .child(label).child(div().text_size(10).text_color(t.dim).child(String(counts[id])));
    const badge = (label, on, warn) => div().px(4).py(1).flex_none().rounded(0).border_1().text_size(9.5)
      .border_color(on ? (warn ? t.working : t.border) : t.border).text_color(on ? (warn ? t.working : t.muted) : t.border).bg(on ? t.raised : t.background).child(label);
    const button = (id, label, action, on = true) => div().id(id).h(24).px(8).flex().flex_none().items_center().rounded(0).border_1().border_color(t.border).text_size(11)
      .text_color(on ? t.muted : t.dim).when(on, (el) => el.hover((s) => s.bg(t.hover).text_color(t.foreground)).on_mouse_down("left", stop).cursor_pointer().on_click(action)).child(label);
    const row = (id, name, description, badges, action) => v_flex().id(id).w_full().flex_none().px(8).py(6).gap(3).rounded(0).hover((s) => s.bg(t.hover))
      .when(Boolean(action), (el) => el.cursor_pointer().on_click(action))
      .child(h_flex().gap(6).items_center().child(div().flex_1().min_w(0).truncate().child(name)).children(badges))
      .when(Boolean(description), (el) => el.child(div().w_full().truncate().text_size(11).text_color(t.dim).child(description)));
    const empty = (text) => div().p(8).text_color(t.dim).child(text);
    const skill = this.open;

    let body;
    if (skill) {
      const missing = TOOLS.filter((tool) => !skill.where[tool.key] && data?.tools[tool.key]);
      body = v_flex().flex_1().min_h(0)
        .child(v_flex().flex_none().px(12).py(10).gap(8).border_b(1).border_color(t.border)
          .child(h_flex().gap(8).items_center()
            .child(div().id("skills-back").w(20).text_color(t.muted).hover((s) => s.text_color(t.foreground)).cursor_pointer().on_click((_e, cx) => this.show(null, cx)).child("←"))
            .child(div().flex_1().min_w(0).truncate().font_semibold().child(skill.name)))
          .when(Boolean(skill.description), (el) => el.child(div().w_full().text_size(11).text_color(t.muted).child(skill.description)))
          .child(h_flex().gap(6).flex_wrap()
            .children(missing.map((tool) => button(`copy-${tool.key}`, this.busy ? "copying…" : `copy to ${tool.name}`, (_e, cx) => this.copy(skill, tool, cx), !this.busy)))
            .child(button("skills-reveal", "show in finder", (_e, cx) => { cx.spawn(async () => { await exec("open", ["-R", Object.values(skill.where)[0]]); }); })))
          .when(skill.differs, (el) => el.child(div().text_size(11).text_color(t.working).child("claude code's and codex's copies of this skill are not the same."))))
        .child(div().id("skill-text").flex_1().min_h(0).overflow_y_scrollbar().px(12).py(10).text_size(12)
          .child(this.text === null ? div().text_color(t.dim).child("reading…") : TextView.markdown(`skill-md-${skill.name}`, this.text).selectable()));
    } else if (this.tab === "skills") {
      body = v_flex().id("skills-list").flex_1().min_h(0).overflow_y_scrollbar().p(6)
        .children((data?.skills ?? []).map((s) => row(`skill-${s.name}`, s.name, s.description, [
          ...(s.where.project ? [badge("project", true)] : []),
          ...TOOLS.map((tool) => badge(tool.name, Boolean(s.where[tool.key]), s.differs)),
        ], (_e, cx) => this.show(s, cx))))
        .when(!counts.skills, (el) => el.child(empty(this.error ?? (data ? "no skills are installed for claude code or codex." : "reading the skills…"))));
    } else if (this.tab === "agents") {
      body = v_flex().id("skills-agents").flex_1().min_h(0).overflow_y_scrollbar().p(6)
        .children((data?.agents ?? []).map((a) => row(`agent-${a.scope}-${a.name}`, a.name, a.description, [badge(a.scope === "project" ? "project" : "claude code", true)],
          (_e, cx) => { cx.spawn(async () => { await exec("open", ["-R", a.path]); }); })))
        .when(!counts.agents, (el) => el.child(empty("no custom agents. claude code keeps them in ~/.claude/agents and in a project's .claude/agents.")));
    } else {
      body = v_flex().id("skills-mcp").flex_1().min_h(0).overflow_y_scrollbar().p(6)
        .children((data?.mcp ?? []).map((m, i) => row(`mcp-${i}`, m.name, m.kind, [badge(m.tool === "codex" ? "codex" : "claude code", true)])))
        .when(!counts.mcp, (el) => el.child(empty("no mcp servers are set up for claude code or codex.")));
    }
    return v_flex().id("skills").size_full().min_h(0).rounded(0).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("skills"))
        .child(div().flex_1())
        .child(button("skills-refresh", this.loading ? "reading…" : "refresh", (_e, cx) => this.refresh(cx, true), !this.loading)))
      .when(!skill, (el) => el.child(h_flex().h(34).flex_none().px(8).gap(4).items_end().border_b(1).border_color(t.border)
        .child(tab("skills", "skills")).child(tab("agents", "agents")).child(tab("mcp", "mcp servers"))))
      .child(body);
  }
}
