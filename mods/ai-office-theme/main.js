// ai-office-theme: オフィスの右上の「テーマ」をクリックすると出る、テーマのドロップダウン。使っているテーマの左にチェック。
// 選ぶと shared の ai-office.theme に置く（どのオフィスのコピーもそのテーマに替わる）。名札のメニュー（Herdr の menu）と
// 同じ見た目とキー（↑↓ で選び、Enter、Esc で閉じる）。使えなかったテーマは下に薄く、理由と一緒に出す（選べない）。
// props: { themes: [{ name, label, description }], current: 使っているテーマの name, skipped: [{ name, why }] }
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, setShared, theme } from "herdr";

export default class ThemeMenu extends View {
  init(_props, cx) {
    const list = props()?.themes ?? [];
    this.at = Math.max(0, list.findIndex((x) => x.name === props()?.current));
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  choose(i) {
    const it = (props()?.themes ?? [])[i];
    closeOverlay(props()?.overlay);
    if (it) setShared("ai-office.theme", it.name);
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    const list = p.themes ?? [];
    const skipped = p.skipped ?? [];
    return v_flex().id("theme-menu").track_focus(this.handle).w_full().min_h(0).p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => {
        if (!list.length) return;
        if (e.key === "down") this.at = (this.at + 1) % list.length;
        else if (e.key === "up") this.at = (this.at + list.length - 1) % list.length;
        else if (e.key === "enter") this.choose(this.at);
        else if (e.key === "escape") closeOverlay(p.overlay);
        else return;
        cx.notify();
      })
      .children(list.map((it, i) => h_flex().id(`theme-${i}`).flex_none().min_h(31).px(8).py(5).gap(9).rounded(7).items_center()
        .text_color(t.foreground).cursor_pointer()
        .when(i === this.at, (el) => el.bg(t.selected))
        .hover((s) => s.bg(t.hover))
        .on_click(() => this.choose(i))
        .child(div().w(14).flex_none().child(it.name === p.current
          ? svg("mods/workspace-chrome/check.svg").size(14).text_color(t.foreground) : ""))
        .child(v_flex().flex_1().min_w(0)
          .child(div().child(it.label))
          .when(Boolean(it.description), (el) => el.child(div().mt(1).text_size(11).line_height("15px").text_color(t.dim)
            .child(it.description))))))
      .when(skipped.length > 0, (el) => el
        .child(div().flex_none().mx(7).my(4).h(1).bg(t.border))
        .children(skipped.map((x) => v_flex().flex_none().px(8).py(3).gap(1)
          .child(div().text_size(11.5).text_color(t.dim).child(`使えない: ${x.name}`))
          .child(div().text_size(10.5).text_color(t.dim).child(x.why)))));
  }
}
