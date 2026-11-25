// ai-office-toggle: タブバーの右隣に置く「Office」ボタン。押すとオフィスの列を出し入れする（layout.toggle）。
// Files / Changes のボタンは同梱の tabs mod に直接書かれていて増やせないので、tabs は複製せず、
// 隣に別のブロックとして置く。見た目は tabs のボタンに合わせ、帯の背景と下の線も同じに描いて継ぎ目を消す。
// props: { block }（出し入れするレイアウトのブロックの id。省略時は "office"）。
// 出し入れはレイアウトのクリックとして覚えられるので、再起動しても残る。
import { View, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, layout, props, shared, run } from "herdr";

// 画面の文（言語ごと。ai-office の text.js と同じ決まりで、表にない言語・文は英語）
const TEXT = {
  en: { noBlock: (id) => `This layout has no "${id}" block` },
  ja: { noBlock: (id) => `このレイアウトに「${id}」のブロックがありません` },
};

// 今の言語の表: オフィスの上の帯の言語のボタンで選んだもの（shared の ai-office.lang）。OS に合わせるなら、オフィスが調べた
// OS の言語（ai-office.os-lang）
function words() {
  const choice = shared("ai-office.lang");
  return { ...TEXT.en, ...TEXT[choice && choice !== "auto" ? choice : shared("ai-office.os-lang")] };
}

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class OfficeToggle extends View {
  render() {
    const t = theme();
    const id = props()?.block ?? "office";
    const office = find(layout(), id);
    const on = Boolean(office) && !office.hidden;
    const stop = (_e, cx) => cx.stop_propagation(); // 帯は窓のドラッグ用。ボタンを押しても窓を動かさない
    return h_flex().size_full().pr(10).items_center().justify_end().bg(t.chrome).border_b(1).border_color(t.border)
      .child(h_flex().id("office-toggle").h(26).px(8).gap(5).flex_none().items_center().rounded(6)
        .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover((s) => s.bg(t.hover)).on_mouse_down("left", stop)
        .when(!office, (el) => el.tooltip(words().noBlock(id)))
        .on_click(() => office && run("layout.toggle", { id }))
        .child(svg("mods/ai-office-toggle/office.svg").size(14))
        .child("Office"));
  }
}
