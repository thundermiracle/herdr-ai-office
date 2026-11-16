// ai-office-plan: 部屋の壁のプランのホワイトボードをクリックすると出る、プラン（Claude Code のプランモードの .md）の中身。
// props: { room: 部屋の名前, plans: [{ path, who }] }。部屋にプランが何人分もあれば、上に人ごとのタブ。
// プランモードの間はプランが書き換わるので、開いている間は 2 秒ごとに読み直す（変わったときだけ描き直す）。
// フックはプランを書く直前に office.plan を付けるので、開いたときにまだファイルがないこともある。Esc か「閉じる」で閉じる。
// キー: ↑↓ で少しずつ、Space・PageDown と Shift+Space・PageUp で 1 画面ずつ、Home・End で端までスクロール。
// ← → か 1〜9 で人ごとのタブを替える。
// マークダウンの表示部品（TextView）はスクロールの位置をコードから動かせないので、スクロールは自前: 見える枠の中で
// 本文を top だけ上にずらし、ホイールとキーで top を動かす。右の細いつまみも自前で描く。
import { View, div } from "gpui-kit";
import { v_flex, h_flex, TextView } from "gpui-base";
import { theme, props, home, readTextFile, closeOverlay } from "herdr";

const RELOAD_MS = 2000;
const LINE = 40; // ↑↓ で動かす量（px）

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
    this.top = 0; // 本文をどれだけ上にずらしているか（px）
    this.viewH = 0; // 見える枠の高さ
    this.bodyH = 0; // 本文の高さ
    this.handle = cx.focus_handle();
    this.handle.focus();
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
    if (i === this.index || !this.plans[i]) return;
    this.index = i;
    this.text = null;
    this.loaded = false;
    this.top = 0;
    this.load(cx);
    cx.notify();
  }

  // 本文をずらす量を、0 から（本文の高さ − 見える枠の高さ）までに収めて変える。変わったときだけ描き直す
  scrollTo(y, cx) {
    const top = Math.max(0, Math.min(y, this.bodyH - this.viewH));
    if (top === this.top) return;
    this.top = top;
    cx.notify();
  }

  // 見える枠か本文の高さが変わった（窓の大きさ・読み直し・タブ）: ずらす量を収め直す
  measure(view, body, cx) {
    if (view === this.viewH && body === this.bodyH) return;
    this.viewH = view;
    this.bodyH = body;
    this.top = Math.max(0, Math.min(this.top, body - view));
    cx.notify();
  }

  key(e, cx) {
    const k = e.keystroke;
    const page = Math.max(LINE, this.viewH - LINE);
    const by = { up: -LINE, down: LINE, pageup: -page, "shift-space": -page, pagedown: page, space: page }[k];
    if (k === "escape") props()?.overlay && closeOverlay(props().overlay);
    else if (by !== undefined) this.scrollTo(this.top + by, cx);
    else if (k === "home") this.scrollTo(0, cx);
    else if (k === "end") this.scrollTo(this.bodyH, cx);
    else if ((k === "left" || k === "right") && this.plans.length > 1) {
      this.select((this.index + (k === "right" ? 1 : -1) + this.plans.length) % this.plans.length, cx);
    } else if (/^[1-9]$/.test(k)) this.select(Number(k) - 1, cx);
    else return;
    cx.stop_propagation();
  }

  render() {
    const t = theme();
    const plan = this.plans[this.index];
    const where = (plan?.path ?? "").replace(home(), "~");
    const message = !plan ? "表示するプランがありません"
      : !this.loaded ? "読んでいます…"
        : this.text === null ? "プランはまだ書かれていません（書かれたら出ます）" : null;
    const max = Math.max(0, this.bodyH - this.viewH);
    const thumbH = max ? Math.max(24, (this.viewH * this.viewH) / this.bodyH) : 0;
    const hint = this.plans.length > 1 ? "← → で人を替える・↑↓ と Space でスクロール" : "↑↓ と Space でスクロール";
    return v_flex().id("plan").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .size_full().min_h(0).text_color(t.foreground)
      .child(h_flex().flex_none().px(16).pt(14).pb(10).gap(10).items_center().border_b(1).border_color(t.border)
        .child(div().w(10).h(18).flex_none().rounded(2).bg("#c8774a")) // ホワイトボードの見出しの色
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().text_size(15).font_semibold().truncate()
            .child([`プラン: ${plan?.who ?? ""}`, props()?.room].filter(Boolean).join("　")))
          .child(div().text_size(11.5).text_color(t.dim).truncate().child(where)))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(hint))
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
          .child(`${i + 1}. ${p.who}`)))))
      .child(div().id("plan-view").flex_1().min_h(0).relative().overflow_hidden()
        .on_size_change((size, cx) => this.measure(size.height, this.bodyH, cx))
        .on_scroll_wheel((e, cx) => this.scrollTo(this.top - e.delta.y, cx))
        .when(Boolean(message), (el) => el.child(div().px(16).py(10).text_size(12.5).text_color(t.dim).child(message)))
        .when(!message, (el) => el
          .child(div().absolute().left(0).right(0).top(-this.top).px(16).py(10)
            .on_size_change((size, cx) => this.measure(this.viewH, size.height, cx))
            .child(TextView.markdown(`plan-body-${this.index}`, unquote(this.text)).selectable(true)))
          .when(max > 0, (el) => el.child(div().absolute().right(3).w(4).h(thumbH).rounded(2).bg(t.dim).opacity(0.6)
            .top((this.top / max) * (this.viewH - thumbH))))));
  }
}
