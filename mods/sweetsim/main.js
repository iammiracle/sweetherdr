// sweetsim: the iOS simulator's screen in a panel, with a device picker.
// View only: Xcode's own tools can show the screen but not tap it, so
// "Open" brings up Simulator itself for touching.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, theme, layout, props, appHome, home, notify, settings } from "herdr";

// Frames go in a mod folder of their own: see mods/sweetsimscreen/main.js.
const DIR = "mods/sweetsimscreen";
// Where a shot is taken before it is moved into DIR (same disk, so the move is whole).
const TMP = "cache/sweetsim";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}
// In the side panel: only while this panel is the one showing. As a pane: always.
function showing() {
  const id = props()?.panel;
  if (!id) return true;
  const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body");
  return Boolean(panel && !panel.hidden && body?.active === id);
}
const version = (runtime) => runtime.replace(/^.*SimRuntime\./, "").replace(/-/g, " ").replace(/(\d) (\d)/g, "$1.$2");

export default class Sim extends View {
  init(_props, cx) {
    this.devices = []; this.udid = localStorage.getItem("udid"); this.frame = null; this.n = 0;
    this.size = { width: 340, height: 600 }; this.ratio = 2.17; this.picking = false; this.note = null;
    this.list(cx);
    cx.timer.every(400, (cx) => this.capture(cx));
    cx.timer.every(20000, (cx) => { if (showing()) this.list(cx); });
  }

  list(cx) {
    cx.spawn(async (cx) => {
      try {
        const r = await exec("xcrun", ["simctl", "list", "devices", "available", "-j"]);
        if (r.code !== 0) throw new Error(r.stderr.trim() || "simctl failed");
        const out = [];
        for (const [runtime, list] of Object.entries(JSON.parse(r.stdout).devices ?? {}))
          for (const d of list) out.push({ udid: d.udid, name: d.name, on: d.state === "Booted", os: version(runtime) });
        out.sort((a, b) => b.on - a.on || b.os.localeCompare(a.os, undefined, { numeric: true }) || a.name.localeCompare(b.name));
        this.devices = out; this.error = null;
      } catch (e) { this.error = `xcode's simulator tools did not answer: ${e.message ?? e}`; }
      cx.notify();
    });
  }

  // The device on screen: the picked one while it runs, else the first running one.
  device() {
    return this.devices.find((d) => d.udid === this.udid && d.on) ?? this.devices.find((d) => d.on) ?? null;
  }

  capture(cx) {
    const d = this.device();
    if (this.capturing || !d || !showing() || this.picking) return;
    this.capturing = true;
    cx.spawn(async (cx) => {
      try {
        // Two names in turn, and the last frame stays drawn under the new one:
        // Herdr shows nothing for a moment while it reads a changed picture, and
        // that moment was the flicker. The shot is taken elsewhere and moved in
        // whole, so Herdr never reads half a file.
        const next = this.n ^ 1, name = `${DIR}/f${next}.jpg`, path = `${appHome()}/${name}`, shot = `${appHome()}/${TMP}/shot.jpg`;
        if (!this.made) { await exec("mkdir", ["-p", `${appHome()}/${DIR}`, `${appHome()}/${TMP}`]); this.made = true; }
        const r = await exec("xcrun", ["simctl", "io", d.udid, "screenshot", "--type=jpeg", shot], { timeout: 15000 });
        if (r.code !== 0) throw new Error(r.stderr.trim());
        await exec("mv", ["-f", shot, path]);
        // Give Herdr a moment to read the new picture before it goes on top.
        await exec("sleep", ["0.3"]);
        this.n = next; this.under = this.shot === d.udid ? this.frame : null;
        if (this.measured !== d.udid) {
          const s = await exec("sips", ["-g", "pixelWidth", "-g", "pixelHeight", path]);
          const w = /pixelWidth: (\d+)/.exec(s.stdout), h = /pixelHeight: (\d+)/.exec(s.stdout);
          if (w && h) { this.ratio = Number(h[1]) / Number(w[1]); this.measured = d.udid; }
        }
        this.frame = name; this.shot = d.udid; this.note = null;
      } catch (e) { this.note = String(e.message ?? e).split("\n")[0]; this.list(cx); }
      finally { this.capturing = false; cx.notify(); }
    });
  }

  pick(d, cx) {
    this.picking = false; this.udid = d.udid; localStorage.setItem("udid", d.udid); this.frame = null; this.under = null;
    if (d.on) return cx.notify();
    this.note = `starting ${d.name}…`;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("xcrun", ["simctl", "boot", d.udid], { timeout: 180000 });
        if (r.code !== 0 && !/current state: Booted/.test(r.stderr)) throw new Error(r.stderr.trim());
        this.note = null;
      } catch (e) { this.note = `could not start ${d.name}: ${String(e.message ?? e).split("\n")[0]}`; }
      this.list(cx);
    });
    cx.notify();
  }

  act(label, args, cx, after) {
    const d = this.device();
    if (!d) return;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("xcrun", ["simctl", ...args(d)], { timeout: 60000 });
        if (r.code !== 0) throw new Error(r.stderr.trim());
        after?.(r, d);
      } catch (e) { notify({ title: `${label} failed`, body: String(e.message ?? e).split("\n")[0], level: "error" }); }
      this.list(cx);
    });
  }

  render() {
    const t = theme(), d = this.device(), stop = (_e, cx) => cx.stop_propagation();
    const button = (id, label, action, on = true) => div().id(id).h(24).px(8).flex().flex_none().items_center().rounded(0)
      .border_1().border_color(t.border).text_size(11).text_color(on ? t.muted : t.dim)
      .when(on, (el) => el.hover((s) => s.bg(t.hover).text_color(t.foreground)).on_mouse_down("left", stop).cursor_pointer().on_click(action)).child(label);
    // The screen, as large as fits: 12px around it, under the header and the buttons.
    const room = { w: Math.max(80, this.size.width - 24), h: Math.max(80, this.size.height - 42 - 40 - 24 - (this.note ? 24 : 0)) };
    const width = Math.min(room.w, room.h / this.ratio), height = width * this.ratio;
    const groups = [];
    for (const dev of this.devices) {
      const key = dev.on ? "running" : dev.os;
      if (groups[groups.length - 1]?.key !== key) groups.push({ key, list: [] });
      groups[groups.length - 1].list.push(dev);
    }
    return v_flex().id("sim").size_full().min_h(0).rounded(0).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      // Sizes arrive after zoom; widths and heights are written before it.
      .on_size_change((size, cx) => { const z = settings().zoom ?? 1; this.size = { width: size.width / z, height: size.height / z }; cx.notify(); })
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("simulator"))
        .child(h_flex().id("sim-pick").h(24).px(8).gap(6).min_w(0).items_center().rounded(0).border_1().border_color(this.picking ? t.accent : t.border).text_size(11).text_color(t.muted)
          .hover((s) => s.bg(t.hover)).cursor_pointer().on_click((_e, cx) => { this.picking = !this.picking; if (this.picking) this.list(cx); cx.notify(); })
          .child(div().size(6).flex_none().rounded(0).bg(d ? t.done : t.dim))
          .child(div().min_w(0).truncate().child(d ? `${d.name} · ${d.os}` : "pick a device"))
          .child(div().text_color(t.dim).child(this.picking ? "×" : "▾")))
        .child(div().flex_1()))
      .when(this.picking, (el) => el.child(v_flex().id("sim-devices").flex_1().min_h(0).overflow_y_scrollbar().p(6)
        .children(groups.flatMap((g) => [
          div().px(8).pt(8).pb(4).text_size(10).text_color(t.dim).child(g.key.toLowerCase()),
          ...g.list.map((dev) => h_flex().id(`dev-${dev.udid}`).h(28).flex_none().px(8).gap(8).items_center().rounded(0)
            .when(dev.udid === d?.udid, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover)).cursor_pointer().on_click((_e, cx) => this.pick(dev, cx))
            .child(div().size(6).flex_none().rounded(0).bg(dev.on ? t.done : t.border))
            .child(div().flex_1().min_w(0).truncate().child(dev.name))
            .when(dev.on, (e) => e.child(div().text_size(11).text_color(t.dim).child(dev.os)))),
        ]))
        .when(!this.devices.length, (e) => e.child(div().p(8).text_color(t.dim).child(this.error ?? "looking for simulators…")))))
      .when(!this.picking, (el) => el
        .child(h_flex().h(40).flex_none().px(12).gap(6).items_center().border_b(1).border_color(t.border)
          .child(button("sim-open", "open", (_e, cx) => { cx.spawn(async () => { await exec("open", ["-a", "Simulator"]); }); }))
          .child(button("sim-dark", "light / dark", (_e, cx) => {
            const d0 = this.device();
            if (!d0) return;
            cx.spawn(async (cx) => {
              const now = await exec("xcrun", ["simctl", "ui", d0.udid, "appearance"]);
              this.act("switching appearance", (x) => ["ui", x.udid, "appearance", now.stdout.trim() === "dark" ? "light" : "dark"], cx);
            });
          }, Boolean(d)))
          .child(button("sim-save", "save shot", (_e, cx) => {
            const file = `${home()}/Desktop/Simulator ${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.png`;
            this.act("screenshot", (x) => ["io", x.udid, "screenshot", file], cx, () => notify({ title: "screenshot saved", body: "on your desktop", level: "success" }));
          }, Boolean(d)))
          .child(div().flex_1())
          .child(button("sim-off", "shut down", (_e, cx) => { this.frame = null; this.act("shut down", (x) => ["shutdown", x.udid], cx); cx.notify(); }, Boolean(d))))
        .child(div().flex_1().min_h(0).overflow_hidden().flex().items_center().justify_center().bg(t.canvas)
          .when(Boolean(d && this.frame && this.shot === d.udid), (e) => e.child(div().relative().w(width).h(height).flex_none().border_1().border_color(t.border)
            .when(Boolean(this.under), (el) => el.child(image(this.under).absolute().top(0).left(0).w(width).h(height)))
            .child(image(this.frame).absolute().top(0).left(0).w(width).h(height))))
          .when(!(d && this.frame && this.shot === d?.udid), (e) => e.child(v_flex().gap(8).items_center().text_color(t.dim).px(20)
            .child(svg("mods/sweetsim/phone.svg").size(28))
            .child(div().text_size(12).child(this.error ?? (d ? "reading the screen…" : this.devices.length ? "no simulator is running. pick a device to start one." : "looking for simulators…")))))))
      .when(Boolean(this.note), (el) => el.child(div().h(24).flex_none().px(12).flex().items_center().text_size(11).text_color(t.muted).border_t(1).border_color(t.border).child(div().truncate().child(this.note))));
  }
}
