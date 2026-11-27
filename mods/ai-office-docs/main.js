// ai-office-docs: 部屋の壁のホワイトボードをクリックすると出る、部屋の人が書いたもの（プランと、AI が書いた .md）の中身を
// マークダウンで。props: { room: 部屋の名前, machine: 部屋のマシン（この Mac は null）, docs: [{ path, kind, who }] }
// （kind: plan / doc。順はプラン、人ごとの .md）。ファイルは部屋のマシンから読む（ほかのマシンの部屋の道は、そのマシンのもの）。
// 何本もあれば左に一覧（書いた人ごと）。開いている間は 2 秒ごとに読み直す（変わったときだけ描き直す）。
// フックは書く直前にラベルを付けるので、開いたときにまだファイルがないこともある。Esc か「閉じる」で閉じる。
// キー: ↑↓ で少しずつ、Space・PageDown と Shift+Space・PageUp で 1 画面ずつ、Home・End で端までスクロール。
// ← → で前と次の書いたもの、1〜9 でその番号のもの。
// マークダウンの表示部品（TextView）はスクロールの位置をコードから動かせないので、スクロールは自前: 見える枠の中で
// 本文を top だけ上にずらし、ホイールとキーで top を動かす。右の細いつまみも自前で描く。
import { View, div } from "gpui-kit";
import { v_flex, h_flex, TextView } from "gpui-base";
import { theme, props, shared, home, readTextFile, closeOverlay } from "herdr";

const RELOAD_MS = 2000;
const LINE = 40; // ↑↓ で動かす量（px）
const SIDE_W = 210; // 左の一覧の幅（何本もあるとき）
const COLOR = { plan: "#c8774a", doc: "#4a7fd0" }; // 見出しと一覧の印の色（ホワイトボードの見出しの橙・青）

// 画面の文（言語ごと。ai-office の text.js と同じ決まりで、表にない言語・文は英語）。sep は見出しの並びの区切り
const TEXT = {
  en: {
    plan: "Plan",
    planOf: (who) => `Plan: ${who}`,
    close: "Close",
    nothing: "Nothing to show",
    loading: "Loading…",
    notYet: "Not written yet (it shows up once it is)",
    hintMany: "← → previous and next · ↑↓ and Space scroll",
    hintOne: "↑↓ and Space scroll",
    sep: " · ",
  },
  ja: {
    plan: "プラン",
    planOf: (who) => `プラン: ${who}`,
    close: "閉じる",
    nothing: "表示するものがありません",
    loading: "読んでいます…",
    notYet: "まだ書かれていません（書かれたら出ます）",
    hintMany: "← → で前と次・↑↓ と Space でスクロール",
    hintOne: "↑↓ と Space でスクロール",
    sep: "　",
  },
};

// 今の言語の表: オフィスの上の帯の言語のボタンで選んだもの（shared の ai-office.lang）。OS に合わせるなら、オフィスが調べた
// OS の言語（ai-office.os-lang）
function words() {
  const choice = shared("ai-office.lang");
  return { ...TEXT.en, ...TEXT[choice && choice !== "auto" ? choice : shared("ai-office.os-lang")] };
}

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

const base = (path) => path.split("/").pop();
// 一覧と見出しの名前: プランは「プラン」、ほかはファイルの名前
const nameOf = (d, T) => (d.kind === "plan" ? T.plan : base(d.path));

export default class DocsView extends View {
  init(_props, cx) {
    this.docs = props()?.docs ?? [];
    this.machine = props()?.machine ?? null; // ファイルを読むマシン（null: この Mac）
    this.index = 0;
    this.text = null; // 選んでいるものの中身（null: 読めない・まだない）
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
    const doc = this.docs[this.index];
    if (!doc) return;
    const index = this.index;
    cx.spawn(async (cx) => {
      let text = null;
      try {
        text = await readTextFile(doc.path, { on: this.machine });
      } catch {}
      if (index !== this.index || (this.loaded && text === this.text)) return; // 読む間に替えた・変わっていない
      this.text = text;
      this.loaded = true;
      cx.notify();
    });
  }

  select(i, cx) {
    if (i === this.index || !this.docs[i]) return;
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

  // 見える枠か本文の高さが変わった（窓の大きさ・読み直し・替えた）: ずらす量を収め直す
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
    const n = this.docs.length;
    if (k === "escape") props()?.overlay && closeOverlay(props().overlay);
    else if (by !== undefined) this.scrollTo(this.top + by, cx);
    else if (k === "home") this.scrollTo(0, cx);
    else if (k === "end") this.scrollTo(this.bodyH, cx);
    else if ((k === "left" || k === "right") && n > 1) this.select((this.index + (k === "right" ? 1 : -1) + n) % n, cx);
    else if (/^[1-9]$/.test(k)) this.select(Number(k) - 1, cx);
    else return;
    cx.stop_propagation();
  }

  // 左の一覧: 書いた人ごとに見出し、その下にプランと .md（番号は 1〜9 のキー）
  sidebar(t, T) {
    const groups = [];
    this.docs.forEach((d, i) => {
      const last = groups.at(-1);
      if (last && last.who === d.who) last.items.push([d, i]);
      else groups.push({ who: d.who, items: [[d, i]] });
    });
    return v_flex().id("docs-list").w(SIDE_W).flex_none().min_h(0).py(6).border_r(1).border_color(t.border).overflow_y_scrollbar()
      .children(groups.map((g, gi) => v_flex().flex_none().pb(4)
        .child(div().px(12).pt(gi ? 6 : 2).pb(2).text_size(11).text_color(t.dim).truncate().child(g.who))
        .children(g.items.map(([d, i]) => h_flex().id(`doc-${i}`).flex_none().mx(6).px(6).h(26).gap(6).items_center().rounded(6)
          .cursor_pointer().text_size(12.5).text_color(i === this.index ? t.foreground : t.muted)
          .when(i === this.index, (el) => el.bg(t.selected))
          .when(i !== this.index, (el) => el.hover((st) => st.bg(t.hover)))
          .on_click((_e, cx) => this.select(i, cx))
          .tooltip(d.path.replace(home(), "~"))
          .child(div().w(4).h(12).flex_none().rounded(1).bg(COLOR[d.kind] ?? COLOR.doc))
          .child(div().flex_1().min_w(0).truncate().child(nameOf(d, T)))
          .when(i < 9, (el) => el.child(div().flex_none().text_size(10.5).text_color(t.dim).child(String(i + 1))))))));
  }

  render() {
    const t = theme();
    const T = words();
    const doc = this.docs[this.index];
    const where = (doc?.path ?? "").replace(home(), "~");
    const message = !doc ? T.nothing : !this.loaded ? T.loading : this.text === null ? T.notYet : null;
    const max = Math.max(0, this.bodyH - this.viewH);
    const thumbH = max ? Math.max(24, (this.viewH * this.viewH) / this.bodyH) : 0;
    const hint = this.docs.length > 1 ? T.hintMany : T.hintOne;
    const title = !doc ? "" : doc.kind === "plan" ? T.planOf(doc.who) : base(doc.path);
    const body = div().id("docs-view").flex_1().min_w(0).min_h(0).relative().overflow_hidden()
      .on_size_change((size, cx) => this.measure(size.height, this.bodyH, cx))
      .on_scroll_wheel((e, cx) => this.scrollTo(this.top - e.delta.y, cx))
      .when(Boolean(message), (el) => el.child(div().px(16).py(10).text_size(12.5).text_color(t.dim).child(message)))
      .when(!message, (el) => el
        .child(div().absolute().left(0).right(0).top(-this.top).px(16).py(10)
          .on_size_change((size, cx) => this.measure(this.viewH, size.height, cx))
          .child(TextView.markdown(`docs-body-${this.index}`, unquote(this.text)).selectable(true)))
        .when(max > 0, (el) => el.child(div().absolute().right(3).w(4).h(thumbH).rounded(2).bg(t.dim).opacity(0.6)
          .top((this.top / max) * (this.viewH - thumbH)))));
    return v_flex().id("docs").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .size_full().min_h(0).text_color(t.foreground)
      .child(h_flex().flex_none().px(16).pt(14).pb(10).gap(10).items_center().border_b(1).border_color(t.border)
        .child(div().w(10).h(18).flex_none().rounded(2).bg(COLOR[doc?.kind] ?? COLOR.plan)) // ホワイトボードの見出しの色
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().text_size(15).font_semibold().truncate().child([title, props()?.room].filter(Boolean).join(T.sep)))
          .child(div().text_size(11.5).text_color(t.dim).truncate().child([doc && doc.kind !== "plan" ? doc.who : "", where]
            .filter(Boolean).join(T.sep))))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(hint))
        .child(div().id("docs-close").flex_none().px(10).h(26).flex().items_center().rounded(6).text_size(12)
          .text_color(t.muted).cursor_pointer().hover((st) => st.bg(t.hover).text_color(t.foreground))
          .on_click(() => props()?.overlay && closeOverlay(props().overlay))
          .child(T.close)))
      .child(h_flex().flex_1().min_h(0).items_stretch()
        .when(this.docs.length > 1, (el) => el.child(this.sidebar(t, T)))
        .child(body));
  }
}
