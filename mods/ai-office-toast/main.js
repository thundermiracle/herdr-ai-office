// ai-office-toast: 右下の通知を描く。レイアウトのいちばん外側の "toast": "ai-office-toast"（layouts/ai-office.json と
// main-dots-office.json）で、Herdr の同梱の toast の代わりに使われる。Herdr の「エージェントが待っている・終わった」も、
// mod の notify() も、通知はみんなここを通る。
// オフィスの上の帯の「通知」スイッチ（shared の ai-office.toasts）が "off" なら、出たらすぐ閉じて何も描かない。
// それ以外（初め）は出す。出すときの見た目は、Herdr 0.1.16 の同梱の toast（~/.config/herdr-app/mods/toast/main.js）の写し
// （クリックで action を動かして閉じる）。Herdr の更新で同梱の toast が変わったら、ここも写し直す。

import { View, div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, run, theme, shared, checking } from "herdr";

const DOT = { error: "blocked", warning: "working", success: "done", info: "accent" };

export default class Toast extends View {
  // 出すかどうかは、通知が出たときのスイッチで決める（出ている間にスイッチを替えても、その通知はそのまま）
  init() {
    this.quiet = shared("ai-office.toasts") === "off";
    const id = props()?.overlay;
    if (this.quiet && id && !checking()) closeOverlay(id);
  }

  render(cx) {
    if (this.quiet) return div();
    const t = theme();
    const p = props() ?? {};
    const login = /^([a-z0-9][a-z0-9_.-]{0,31}) needs login; run hc machine login \1$/.exec(p.body ?? "");
    const command = login ? `hc machine login ${login[1]}` : null;
    return h_flex()
      .id("toast")
      .size_full()
      .px(18)
      .gap(12)
      .items_center()
      .bg(t.popover)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(() => {
        if (p.action?.name) run(p.action.name, p.action.args ?? {});
        closeOverlay(p.overlay);
      })
      .child(p.icon ? image(p.icon).w(18).h(18).flex_none() : div().size(8).rounded(4).flex_none().bg(t[DOT[p.level] ?? "accent"]))
      .child(
        v_flex()
          .flex_1()
          .overflow_hidden()
          .child(div().truncate().font_semibold().text_size(13).text_color(t.foreground).child(login ? `${login[1]} needs a login: run` : p.title ?? ""))
          .when(!login && Boolean(p.body), (el) => el.child(div().truncate().text_size(12).text_color(t.muted).child(p.body ?? "")))
          .when(Boolean(login), (el) => el.child(h_flex().gap(8).items_center()
            .child(div().flex_1().min_w(0).truncate().tooltip(command).text_size(12).text_color(t.muted).child(command))
            .child(div().id("toast-login-copy").flex_none().px(6).py(3).rounded(4).bg(t.raised)
              .text_size(12).text_color(t.foreground).cursor_pointer().hover(s => s.bg(t.hover))
              .on_click((_e, cx) => { cx.stop_propagation(); cx.write_to_clipboard(command); this.copied = true; cx.notify(); })
              .child(this.copied ? "Copied" : "Copy")))),
      );
  }
}
