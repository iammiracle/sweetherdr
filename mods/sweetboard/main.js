// sweetboard: the Agents board. Every agent on one screen, in four columns by
// what it needs: Needs you, Done, Working, Idle. A click goes to the agent.
// Opens as a tab of its own from the tab bar's Agents button.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, spaces, run, theme } from "herdr";

const COLUMNS = [
  { status: "blocked", title: "needs you", hint: "nothing is waiting on you." },
  { status: "done", title: "done", hint: "nothing finished while you were away." },
  { status: "working", title: "working", hint: "no agent is working." },
  { status: "idle", title: "idle", hint: "no idle agents." },
];
const since = (at) => {
  if (!at) return "";
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  return s < 60 ? "now" : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
};

export default class Board extends View {
  init(_props, cx) {
    // Only the "12m" on each card ages by itself: once a minute is enough.
    cx.timer.every(60000, (cx) => cx.notify());
  }

  render() {
    const t = theme(), all = agents(), tabs = new Map();
    for (const s of spaces()) for (const tab of s.tabs) tabs.set(tab.id, tab);
    const card = (a) => {
      const tab = tabs.get(a.tab), at = a.status === "working" ? tab?.working_since : tab?.changed_at;
      return v_flex().id(`card-${a.address}`).w_full().flex_none().px(10).py(8).gap(5).rounded(0).bg(t.background).border_1().border_color(a.focused ? t.accent : t.border).border_l(3)
        .hover((s) => s.bg(t.hover))
        .cursor_pointer().on_click(() => { run("space.select", { id: a.space }); run("tab.select", { id: a.tab }); run("agent.focus", { terminal: a.address }); })
        .child(h_flex().gap(7).items_center()
          .when(Boolean(a.program?.icon), (el) => el.child(a.program.tint ? svg(a.program.icon).size(14).flex_none().text_color(t.muted) : image(a.program.icon).size(14).flex_none()))
          .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.muted).child(a.program?.name ?? a.app ?? "agent"))
          .when(a.pinned, (el) => el.child(svg("mods/workspace-chrome/pin.svg").size(11).flex_none().text_color(t.dim)))
          .when(a.status === "working", (el) => el.child(svg("mods/workspace-chrome/spinner.svg").size(11).flex_none().text_color(t.working).spin(900)))
          .child(div().flex_none().text_size(10.5).text_color(t.dim).child(since(at))))
        .child(div().w_full().min_w(0).text_color(t.foreground).child(a.title || a.tab_name || "untitled"))
        .child(div().w_full().truncate().text_size(11).text_color(t.dim).child(`${a.space_name} · ${a.tab_name}`));
    };
    const column = (c) => {
      const list = all.filter((a) => a.status === c.status).sort((x, y) => y.pinned - x.pinned || y.seq - x.seq), color = t[c.status] ?? t.idle;
      return v_flex().flex_1().min_w(180).h_full().min_h(0).bg(t.chrome).border_1().border_color(t.border)
        .child(h_flex().h(34).flex_none().px(10).gap(8).items_center().border_b(1).border_color(t.border)
          .child(div().size(7).flex_none().rounded(0).bg(color))
          .child(div().flex_1().text_size(10.5).text_color(t.muted).child(c.title))
          .child(div().text_size(11).text_color(list.length ? t.foreground : t.dim).child(String(list.length))))
        .child(v_flex().id(`col-${c.status}`).flex_1().min_h(0).overflow_y_scrollbar().p(6).gap(6)
          .children(list.map(card))
          .when(!list.length, (el) => el.child(div().p(6).text_size(11).text_color(t.dim).child(c.hint))));
    };
    return v_flex().id("board").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      // No title row: the pane header above already says Agents.
      .child(h_flex().flex_1().min_h(0).p(8).gap(8).items_start().children(COLUMNS.map(column)));
  }
}
