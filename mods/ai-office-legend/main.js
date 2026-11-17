// ai-office-legend: オフィスの右上の「凡例」をクリックすると出る、キャラの見分け方。上から縦に、AI と model（髪の色と
// 小物）、effort（鉢巻きの色。max は作業中に炎も）。絵はオフィスと同じ PNG を、オフィスと同じ大きさ（絵の 1 ピクセル =
// 2 論理 px）で、頭から上着まで（小物が見える所まで）出す。
import { View, div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme } from "herdr";

const IMG = "mods/ai-office/img";
const S = 2; // 絵の 1 ピクセルの大きさ（オフィスの SCALE と同じ）
const SHOW_H = 18; // キャラの絵（18 x 24）の、上から見せる行
const BOX_W = 28; // 絵の枠の幅（炎の幅。キャラは真ん中）
// ポップアップの高さ。中身の高さに合わせるポップアップは、はみ出した分が切れてスクロールしないので、高さを決めて
// 中をスクロールさせる（ai-office-skills と同じ）。全部で約 500 あるので、窓が低くても出るよう少し低くする
const HEIGHT = 420;

// [絵の名前（img/char/<名前>-stand.png）, 名前, 見分け方]
const LOOKS = [
  ["claude-opus", "opus", "こげ茶の髪・眼鏡・ネクタイ"],
  ["claude-sonnet", "sonnet", "茶色の髪（model が分からないときも）"],
  ["claude-haiku", "haiku", "金髪・若葉"],
  ["claude-fable", "fable", "薄紫の髪・星のピン"],
  ["codex", "Codex", "黒髪・ヘッドホン・青緑の上着"],
  ["other", "ほかの AI", "紫の上着"],
];
// [鉢巻きの色（img/band/<色>-stand.png。なしは null）, effort, 見分け方, 炎]
const BANDS = [
  [null, "low", "鉢巻きなし"],
  ["blue", "medium", "青の鉢巻き"],
  ["white", "high", "白の鉢巻き"],
  ["red", "xhigh", "赤の鉢巻き"],
  ["red", "max", "赤の鉢巻き、作業中は両側に炎", true],
];

function icon(look, band, flame) {
  const left = ((BOX_W - 18) / 2) * S;
  const layer = (img) => image(`${IMG}/${img}.png`).absolute().left(left).top(0).w(18 * S).h(24 * S);
  return div().relative().flex_none().w(BOX_W * S).h(SHOW_H * S).overflow_hidden()
    .when(Boolean(flame), (el) => el.child(image(`${IMG}/fx-flame-0.png`).absolute().left(0).top(3 * S).w(28 * S).h(10 * S)))
    .child(layer(`char/${look}-stand`))
    .when(Boolean(band), (el) => el.child(layer(`band/${band}-stand`)));
}

export default class Legend extends View {
  render() {
    const t = theme();
    const head = (text) => div().flex_none().px(12).pt(10).pb(4).text_size(11.5).text_color(t.dim).child(text);
    const row = (look, band, flame, name, how) => h_flex().flex_none().px(10).py(2).gap(10).items_center()
      .child(icon(look, band, flame))
      .child(v_flex().min_w(0)
        .child(div().text_size(12.5).font_semibold().text_color(t.foreground).child(name))
        .child(div().text_size(11).text_color(t.muted).child(how)));
    return v_flex().w_full().h(HEIGHT).text_color(t.foreground)
      .child(v_flex().id("legend-list").flex_1().min_h(0).pb(8).overflow_y_scrollbar()
        .child(head("AI と model（髪の色と小物。Claude Code は橙の上着）"))
        .children(LOOKS.map(([look, name, how]) => row(look, null, false, name, how)))
        .child(head("effort（鉢巻き。絵は sonnet）"))
        .children(BANDS.map(([band, name, how, flame]) => row("claude-sonnet", band, flame, name, how))));
  }
}
