// sweettimeline: the Claude Code conversation in the focused terminal's folder,
// prompt by prompt, newest first: how long each took, the tokens written, the
// files changed, the commands run and the reply. Reads Claude Code's own
// session file through timeline.py; Codex sessions are not read yet.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, focused, exec, theme, layout, props, appHome, home, settings } from "herdr";

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
function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder || home(), on: space?.machine ?? null, status: pane?.status ?? null };
}
const span = (s) => s == null ? "" : s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor(s % 3600 / 60)}m`;
const count = (n) => n < 1000 ? String(n) : n < 1e6 ? `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k` : `${(n / 1e6).toFixed(1)}M`;
function when(at) {
  if (!at) return "";
  const d = new Date(at), now = new Date(), time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return d.toDateString() === now.toDateString() ? time : `${d.getDate()} ${["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"][d.getMonth()]} ${time}`;
}
const clip = (text, n) => text.length > n ? `${text.slice(0, n).trimEnd()}…` : text;

export default class Timeline extends View {
  init(_props, cx) {
    this.data = null; this.context = null; this.open = new Set();
    this.refresh(cx);
    // The session file grows while the agent works: ask every 2s, and the
    // script answers "same" in a few ms when nothing was written.
    cx.timer.every(2000, (cx) => this.refresh(cx));
  }

  refresh(cx) {
    if (this.loading || !showing()) return;
    const { cwd, on } = location(), context = `${on ?? ""}:${cwd}`;
    if (context !== this.context) { this.context = context; this.data = null; this.error = null; this.open = new Set(); }
    if (on) { this.error = "sessions on another machine are not read yet."; return; }
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        let root = "";
        try { const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd }); if (top.code === 0) root = top.stdout.trim(); } catch { /* not a repo */ }
        const args = [`${appHome()}/mods/sweettimeline/timeline.py`, cwd, root === cwd ? "" : root];
        if (this.data?.mtime) args.push("--since", String(this.data.mtime));
        const r = await exec("python3", args, { timeout: 20000 });
        if (context !== this.context) return;
        if (r.code !== 0) throw new Error(r.stderr.trim().split("\n").pop() || "the reader failed");
        const out = JSON.parse(r.stdout);
        if (!out.same) { this.data = out; this.error = null; cx.notify(); }
      } catch (e) { if (context === this.context) { this.error = `could not read the session: ${e.message ?? e}`; cx.notify(); } }
      finally { this.loading = false; }
    });
  }

  render(cx) {
    const { cwd, on, status } = location();
    if (`${on ?? ""}:${cwd}` !== this.context) this.refresh(cx);
    const t = theme(), data = this.data, turns = data?.turns ?? [], mono = settings().font_family ?? "JetBrains Mono";
    const fact = (text, color = t.dim) => div().flex_none().text_color(color).child(text);
    const card = (turn, i) => {
      const open = this.open.has(turn.at), live = i === 0 && status === "working";
      return v_flex().id(`turn-${turn.at}-${i}`).w_full().flex_none().px(10).py(8).gap(6).rounded(0).border_l(2).border_color(live ? t.working : open ? t.accent : t.border)
        .hover((s) => s.bg(t.hover))
        .cursor_pointer().on_click((_e, cx) => { if (open) this.open.delete(turn.at); else this.open.add(turn.at); cx.notify(); })
        .child(h_flex().gap(8).items_center().text_size(10.5)
          .child(fact(when(turn.at), t.muted))
          .when(live, (el) => el.child(svg("mods/workspace-chrome/spinner.svg").size(11).flex_none().text_color(t.working).spin(900)).child(fact("working", t.working)))
          .when(!live && turn.secs != null, (el) => el.child(fact(span(turn.secs))))
          .when(turn.tokens > 0, (el) => el.child(fact(`${count(turn.tokens)} tokens`)))
          .when(turn.tools > 0, (el) => el.child(fact(`${turn.tools} tool call${turn.tools === 1 ? "" : "s"}`))))
        .child(div().w_full().min_w(0).text_color(t.foreground).child(open ? turn.prompt : clip(turn.prompt.replace(/\s+/g, " "), 180)))
        .when(turn.files.length > 0, (el) => el.child(h_flex().w_full().flex_wrap().gap(4)
          .children((open ? turn.files : turn.files.slice(0, 4)).map((f) => div().px(5).py(1).rounded(0).border_1().border_color(t.border).text_size(10.5).text_color(t.ansi2).child(f)))
          .when(turn.files.length + turn.more_files > (open ? turn.files.length : 4), (e) => e.child(div().py(1).text_size(10.5).text_color(t.dim).child(`+${turn.files.length + turn.more_files - (open ? turn.files.length : 4)} more`)))))
        .when(turn.commands.length > 0, (el) => el.child(v_flex().w_full().gap(2).font_family(mono).text_size(10.5).text_color(t.muted)
          .children((open ? turn.commands : turn.commands.slice(0, 2)).map((c) => div().w_full().truncate().child(`$ ${c}`)))
          .when(turn.commands.length + turn.more_commands > (open ? turn.commands.length : 2), (e) => e.child(div().text_color(t.dim).child(`+${turn.commands.length + turn.more_commands - (open ? turn.commands.length : 2)} more commands`)))))
        .when(Boolean(turn.reply), (el) => el.child(div().w_full().min_w(0).text_size(12).text_color(t.muted).child(open ? turn.reply : clip(turn.reply.replace(/\*\*|`|^#+ /gm, "").replace(/\s+/g, " "), 160))));
    };
    return v_flex().id("timeline").size_full().min_h(0).rounded(0).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("timeline"))
        .when(Boolean(data?.total), (el) => el.child(div().px(5).py(1).rounded(0).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(`${data.total} prompts`)))
        .child(div().flex_1())
        .when(Boolean(data?.context), (el) => el.child(div().text_size(11).text_color(t.dim).child(`context ${count(data.context)}`))))
      .when(Boolean(data?.title), (el) => el.child(div().flex_none().px(14).py(6).truncate().text_size(11).text_color(t.muted).border_b(1).border_color(t.border).child(data.title)))
      .child(v_flex().id("timeline-list").flex_1().min_h(0).overflow_y_scrollbar().p(6).gap(4)
        .children(turns.map(card))
        .when(!turns.length, (el) => el.child(div().p(8).text_color(t.dim).child(this.error ?? (data ? "no claude code conversation in this folder yet." : "reading the conversation…")))))
      .when(data?.total > turns.length, (el) => el.child(div().h(24).flex_none().px(12).flex().items_center().text_size(10).text_color(t.dim).border_t(1).border_color(t.border).child(`showing the latest ${turns.length} of ${data.total}`)));
  }
}
