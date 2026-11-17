// ai-office-tab: オフィスの机の PC をクリックすると出る、そのエージェントのタブのメニュー（名前を変える・閉じる）。
// 名札のメニュー（Herdr の menu）と同じ見た目とキー（↑↓ で選び、Enter、Esc で閉じる）。Herdr のタブのメニューにある
// New tab は出さない（エージェントを足すのは、空いた席の「＋」から）。props: { tab: タブの id }
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, theme, keys } from "herdr";

// [出す名前, コマンド, アイコン（workspace-chrome の svg。Herdr の menu と同じ）]
const ITEMS = [
  ["Rename", "tab.rename", "square-pen"],
  ["Close", "tab.close", "x"],
];

// コマンドに付いているキー（右に出す。Herdr の menu と同じ）
function shortcut(name) {
  const k = keys().find((b) => b.section === "global" && b.action === name);
  return k ? k.keys : "";
}

export default class TabMenu extends View {
  init(_props, cx) {
    this.at = 0;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  choose(i) {
    closeOverlay(props()?.overlay);
    run(ITEMS[i][1], { id: props()?.tab });
  }

  render() {
    const t = theme();
    return v_flex().id("tab-menu").track_focus(this.handle).w_full().min_h(0).p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % ITEMS.length;
        else if (e.key === "up") this.at = (this.at + ITEMS.length - 1) % ITEMS.length;
        else if (e.key === "enter") this.choose(this.at);
        else if (e.key === "escape") closeOverlay(props()?.overlay);
        else return;
        cx.notify();
      })
      .children(ITEMS.map(([label, command, icon], i) => v_flex()
        .when(command === "tab.close", (el) => el.child(div().mx(7).my(4).h(1).bg(t.border)))
        .child(h_flex().id(`mi-${i}`).h(31).px(8).gap(9).rounded(7).items_center().justify_between().text_color(t.foreground)
          .cursor_pointer()
          .when(i === this.at, (el) => el.bg(t.selected))
          .hover((s) => s.bg(t.hover))
          .on_click(() => this.choose(i))
          .child(svg(`mods/workspace-chrome/${icon}.svg`).size(14).flex_none().text_color(t.muted))
          .child(div().flex_1().child(label))
          .child(div().text_size(11).text_color(t.dim).child(shortcut(command))))));
  }
}
