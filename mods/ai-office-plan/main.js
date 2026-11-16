// ai-office-plan: 部屋の壁のプランのホワイトボードをクリックすると出る、プラン（Claude Code のプランモードの .md）の中身。
// props: { room: 部屋の名前, plans: [{ path, who }] }。部屋にプランが何人分もあれば、上に人ごとのタブ。
// プランモードの間はプランが書き換わるので、開いている間は 2 秒ごとに読み直す（変わったときだけ描き直す）。
// フックはプランを書く直前に office.plan を付けるので、開いたときにまだファイルがないこともある。Esc か「閉じる」で閉じる。
import { View, div } from "gpui-kit";
import { v_flex, h_flex, TextView } from "gpui-base";
import { theme, props, home, readTextFile, closeOverlay } from "herdr";

const RELOAD_MS = 2000;

// 引用（> の行）は左の縦線が目立って読みにくいので、> を外してふつうの段落で出す（コードブロックの中はそのまま）
function unquote(text) {
  let fence = null; // 開いているコードブロックの印（``` か ~~~）
  return text.split("\n").map((line) => {
    const m = /^\s*(`{3,}|~{3,})/.exec(line);
    if (m && (!fence || m[1].startsWith(fence))) {
      fence = fence ? null : m[1];
      return line;
    }
    return fence ? line : line.replace(/^(\s{0,3}>\s?)+/, "");
  }).join("\n");
}

export default class PlanView extends View {
  init(_props, cx) {
    this.plans = props()?.plans ?? [];
    this.index = 0;
    this.text = null; // 選んでいるプランの中身（null: 読めない・まだない）
    this.loaded = false; // 一度でも読みにいったか
    this.load(cx);
    cx.timer.every(RELOAD_MS, (cx) => this.load(cx));
  }

  load(cx) {
    const plan = this.plans[this.index];
    if (!plan) return;
    const index = this.index;
    cx.spawn(async (cx) => {
      let text = null;
      try {
        text = await readTextFile(plan.path);
      } catch {}
      if (index !== this.index || (this.loaded && text === this.text)) return; // 読む間にタブを変えた・変わっていない
      this.text = text;
      this.loaded = true;
      cx.notify();
    });
  }

  select(i, cx) {
    if (i === this.index) return;
    this.index = i;
    this.text = null;
    this.loaded = false;
    this.load(cx);
    cx.notify();
  }

  render() {
    const t = theme();
    const plan = this.plans[this.index];
    const where = (plan?.path ?? "").replace(home(), "~");
    const content = !plan
      ? div().text_size(12.5).text_color(t.dim).child("表示するプランがありません")
      : !this.loaded
        ? div().text_size(12.5).text_color(t.dim).child("読んでいます…")
        : this.text === null
          ? div().text_size(12.5).text_color(t.dim).child("プランはまだ書かれていません（書かれたら出ます）")
          : TextView.markdown(`plan-body-${this.index}`, unquote(this.text)).scrollable(true).selectable(true).size_full();
    return v_flex().size_full().min_h(0).text_color(t.foreground)
      .child(h_flex().flex_none().px(16).pt(14).pb(10).gap(10).items_center().border_b(1).border_color(t.border)
        .child(div().w(10).h(18).flex_none().rounded(2).bg("#c8774a")) // ホワイトボードの見出しの色
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().text_size(15).font_semibold().truncate()
            .child([`プラン: ${plan?.who ?? ""}`, props()?.room].filter(Boolean).join("　")))
          .child(div().text_size(11.5).text_color(t.dim).truncate().child(where)))
        .child(div().id("plan-close").flex_none().px(10).h(26).flex().items_center().rounded(6).text_size(12)
          .text_color(t.muted).cursor_pointer().hover((st) => st.bg(t.hover).text_color(t.foreground))
          .on_click(() => props()?.overlay && closeOverlay(props().overlay))
          .child("閉じる")))
      .when(this.plans.length > 1, (el) => el.child(h_flex().flex_none().px(12).py(6).gap(4).border_b(1).border_color(t.border)
        .children(this.plans.map((p, i) => div().id(`plan-tab-${i}`).px(10).h(24).flex().items_center().rounded(6)
          .text_size(12).cursor_pointer()
          .when(i === this.index, (tab) => tab.bg(t.selected).text_color(t.foreground))
          .when(i !== this.index, (tab) => tab.text_color(t.muted).hover((st) => st.bg(t.hover)))
          .on_click((_e, cx) => this.select(i, cx))
          .child(p.who)))))
      .child(div().flex_1().min_h(0).px(16).py(10).child(content));
  }
}
