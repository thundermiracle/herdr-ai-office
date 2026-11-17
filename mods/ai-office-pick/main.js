// ai-office-pick: オフィスの「テーマ」や壁時計をクリックすると出る、選ぶもののドロップダウン。今選んでいるものの左にチェック。
// 選ぶと shared の key に置く（どのオフィスのコピーもそれに替わる）。名札のメニュー（Herdr の menu）と同じ見た目とキー
// （↑↓ で選び、Enter、Esc で閉じる）。多ければ高さ（height）の中でスクロールし、開いたときと ↑↓ で選んだ行を見せる。
// notes は下に薄く出す（選べない。使えなかったテーマと理由など）。
// props: { key: shared の名前, items: [{ name, label, description }], current: 選んでいる name, notes: [{ title, text }], height }
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { props, closeOverlay, setShared, theme } from "herdr";

export default class Pick extends View {
  init(_props, cx) {
    const list = props()?.items ?? [];
    this.at = Math.max(0, list.findIndex((x) => x.name === props()?.current));
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.scroll = ScrollHandle.new();
    this.scroll.scroll_to_item(this.at); // 選んでいるものが下のほうでも見えるように
  }

  choose(i) {
    const p = props() ?? {};
    const it = (p.items ?? [])[i];
    closeOverlay(p.overlay);
    if (it && p.key) setShared(p.key, it.name);
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    const list = p.items ?? [];
    const notes = p.notes ?? [];
    return v_flex().id("pick").track_focus(this.handle).w_full().when(Boolean(p.height), (el) => el.h(p.height)).min_h(0)
      .p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => {
        if (!list.length) return;
        if (e.key === "down") this.at = (this.at + 1) % list.length;
        else if (e.key === "up") this.at = (this.at + list.length - 1) % list.length;
        else if (e.key === "enter") this.choose(this.at);
        else if (e.key === "escape") closeOverlay(p.overlay);
        else return;
        this.scroll.scroll_to_item(this.at);
        cx.notify();
      })
      .child(v_flex().id("pick-list").flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.scroll)
        .children(list.map((it, i) => h_flex().id(`pick-${i}`).flex_none().min_h(31).px(8).py(5).gap(9).rounded(7).items_center()
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
        .when(notes.length > 0, (el) => el
          .child(div().flex_none().mx(7).my(4).h(1).bg(t.border))
          .children(notes.map((x) => v_flex().flex_none().px(8).py(3).gap(1)
            .child(div().text_size(11.5).text_color(t.dim).child(x.title))
            .child(div().text_size(10.5).text_color(t.dim).child(x.text))))));
  }
}
