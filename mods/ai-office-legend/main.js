// ai-office-legend: オフィスの右上の「凡例」をクリックすると出る、キャラの見分け方。上から縦に、AI と model（髪の色と
// 小物）、effort（鉢巻きの色。max は作業中に炎も）。絵はオフィスと同じ PNG を、オフィスと同じ大きさ（絵の 1 ピクセル =
// 2 論理 px）で、頭から上着まで（小物が見える所まで）出す。
import { View, div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, shared } from "herdr";

const IMG = "mods/ai-office/img";
const S = 2; // 絵の 1 ピクセルの大きさ（オフィスの SCALE と同じ）
const SHOW_H = 18; // キャラの絵（18 x 24）の、上から見せる行
const BOX_W = 28; // 絵の枠の幅（炎の幅。キャラは真ん中）
// ポップアップの高さ。中身の高さに合わせるポップアップは、はみ出した分が切れてスクロールしないので、高さを決めて
// 中をスクロールさせる（ai-office-skills と同じ）。全部で約 500 あるので、窓が低くても出るよう少し低くする
const HEIGHT = 420;

// [絵の名前（img/char/<名前>-stand.png）, 名前（null は表の otherAi）]。見分け方は表の look の、絵の名前のもの
const LOOKS = [
  ["claude-opus", "opus"],
  ["claude-sonnet", "sonnet"],
  ["claude-haiku", "haiku"],
  ["claude-fable", "fable"],
  ["codex", "Codex"],
  ["other", null],
];
// [鉢巻きの色（img/band/<色>-stand.png。なしは null）, effort, 炎]。見分け方は表の band の、effort のもの
const BANDS = [
  [null, "low"],
  ["blue", "medium"],
  ["white", "high"],
  ["red", "xhigh"],
  ["red", "max", true],
];

// 画面の文（言語ごと。ai-office の text.js と同じ決まりで、表にない言語・文は英語）
const TEXT = {
  en: {
    looksHead: "AI and model (hair color and accessories; Claude Code wears an orange jacket)",
    bandsHead: "Effort (the headband; drawn on sonnet)",
    otherAi: "Other AI",
    look: {
      "claude-opus": "Dark brown hair, glasses, a tie",
      "claude-sonnet": "Brown hair (also when the model isn't known)",
      "claude-haiku": "Blond hair, a green leaf",
      "claude-fable": "Lilac hair, a star pin",
      codex: "Black hair, headphones, a teal jacket",
      other: "A purple jacket",
    },
    band: {
      low: "No headband",
      medium: "A blue headband",
      high: "A white headband",
      xhigh: "A red headband",
      max: "A red headband, with flames on both sides while working",
    },
  },
  ja: {
    looksHead: "AI と model（髪の色と小物。Claude Code は橙の上着）",
    bandsHead: "effort（鉢巻き。絵は sonnet）",
    otherAi: "ほかの AI",
    look: {
      "claude-opus": "こげ茶の髪・眼鏡・ネクタイ",
      "claude-sonnet": "茶色の髪（model が分からないときも）",
      "claude-haiku": "金髪・若葉",
      "claude-fable": "薄紫の髪・星のピン",
      codex: "黒髪・ヘッドホン・青緑の上着",
      other: "紫の上着",
    },
    band: {
      low: "鉢巻きなし",
      medium: "青の鉢巻き",
      high: "白の鉢巻き",
      xhigh: "赤の鉢巻き",
      max: "赤の鉢巻き、作業中は両側に炎",
    },
  },
};

// 今の言語の表: オフィスの上の帯の言語のボタンで選んだもの（shared の ai-office.lang）。OS に合わせるなら、オフィスが調べた
// OS の言語（ai-office.os-lang）
function words() {
  const choice = shared("ai-office.lang");
  return { ...TEXT.en, ...TEXT[choice && choice !== "auto" ? choice : shared("ai-office.os-lang")] };
}


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
    const T = words();
    const head = (text) => div().flex_none().px(12).pt(10).pb(4).text_size(11.5).text_color(t.dim).child(text);
    const row = (look, band, flame, name, how) => h_flex().flex_none().px(10).py(2).gap(10).items_center()
      .child(icon(look, band, flame))
      .child(v_flex().min_w(0)
        .child(div().text_size(12.5).font_semibold().text_color(t.foreground).child(name))
        .child(div().text_size(11).text_color(t.muted).child(how)));
    return v_flex().w_full().h(HEIGHT).text_color(t.foreground)
      .child(v_flex().id("legend-list").flex_1().min_h(0).pb(8).overflow_y_scrollbar()
        .child(head(T.looksHead))
        .children(LOOKS.map(([look, name]) => row(look, null, false, name ?? T.otherAi, T.look[look])))
        .child(head(T.bandsHead))
        .children(BANDS.map(([band, name, flame]) => row("claude-sonnet", band, flame, name, T.band[name]))));
  }
}
