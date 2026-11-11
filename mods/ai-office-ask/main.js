// ai-office-ask: オフィスで質問しているエージェントの「?」をクリックすると出る、質問と選択肢。
// 選ぶと、その答えをターミナルにキーで送る（hc keys。今の選択から上下に動かして Enter）。
// 送る直前に画面を読み直し、質問が変わっていたり、もう答え待ちでなければ送らない。
// 書いて答える選択肢（Type something. など）は、選んだあとターミナルを開く。複数選ぶ質問と、読めない画面はターミナルで答える。
// props: { terminal, name }。props なしで開いたとき（herdr-app do mod.open --name ai-office-ask）は、
// 質問しているエージェントのうち最初の人。
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, props, agents, terminals, hc, run, closeOverlay } from "herdr";
import { parseQuestion, keysFor, typesAnswer, sameQuestion } from "./parse.js";

const kindOf = (t) => t?.report?.kind ?? t?.status?.kind ?? null;

// 誰の質問を出すか
function target() {
  const p = props() ?? {};
  if (p.terminal) return { terminal: p.terminal, name: p.name ?? p.terminal };
  const asking = new Set(terminals().filter((t) => kindOf(t) === "question").map((t) => t.address));
  const a = agents().find((x) => x.status === "blocked" && asking.has(x.address));
  return a ? { terminal: a.address, name: `${a.program?.name ?? a.app ?? "agent"} · ${a.space_name} / ${a.tab_name}` } : null;
}

async function screenOf(terminal) {
  const r = await hc(["read", terminal]);
  if (r.code !== 0) throw new Error(r.stderr || "画面を読めませんでした");
  return r.stdout;
}

export default class Ask extends View {
  init(_props, cx) {
    this.who = target();
    this.q = null; // 読んだ質問（parseQuestion）
    this.screen = ""; // 読めなかったときに見せる、画面の最後
    this.message = "";
    this.busy = false;
    this.load(cx);
  }

  load(cx) {
    if (!this.who) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        const text = await screenOf(this.who.terminal);
        this.q = parseQuestion(text);
        this.screen = text.split("\n").filter((l) => l.trim()).slice(-12).join("\n");
      } catch (e) {
        this.message = String(e.message ?? e);
      }
      this.busy = false;
      cx.notify();
    });
  }

  close() {
    const overlay = props()?.overlay;
    if (overlay) closeOverlay(overlay);
  }

  focus() {
    run("agent.focus", { terminal: this.who.terminal });
    this.close();
  }

  choose(option, cx) {
    if (this.busy) return;
    this.busy = true;
    this.message = "送っています…";
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const still = agents().find((a) => a.address === this.who.terminal)?.status === "blocked";
        const now = parseQuestion(await screenOf(this.who.terminal));
        if (!still || !sameQuestion(now, this.q)) {
          this.q = now;
          this.message = still ? "質問が変わっていたので、読み直しました" : "もう答え待ちではありません";
          this.busy = false;
          cx.notify();
          return;
        }
        const r = await hc(["keys", this.who.terminal, ...keysFor(now, option.n)]);
        if (r.code !== 0) throw new Error(r.stderr || "キーを送れませんでした");
        if (typesAnswer(option)) this.focus(); // 続きはターミナルで書く
        else this.close();
      } catch (e) {
        this.message = String(e.message ?? e);
        this.busy = false;
        cx.notify();
      }
    });
  }

  render() {
    const t = theme();
    const note = (text, color = t.dim) => div().px(12).py(4).text_size(11.5).text_color(color).child(text);
    const button = (id, text, onClick) => div().id(id).px(10).h(26).flex().items_center().rounded(6).text_size(12)
      .text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(onClick).child(text);
    if (!this.who) return v_flex().w_full().p(6).child(note("質問しているエージェントはいません"));
    const q = this.q;
    const answerable = q && !q.multi && q.options.length > 0;
    const option = (o) => v_flex().id(`option-${o.n}`).mx(6).px(10).py(6).gap(2).rounded(6)
      .when(answerable && !this.busy, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.choose(o, cx)))
      .when(o.n === q.cursor, (el) => el.bg(t.selected))
      .child(div().text_size(13).font_semibold().text_color(t.foreground).child(`${o.n}. ${o.label}`))
      .when(Boolean(o.description), (el) => el.child(div().text_size(11.5).text_color(t.muted).child(o.description)));
    return v_flex().w_full().pb(6).text_color(t.foreground)
      .child(div().px(12).pt(10).pb(2).text_size(11.5).text_color(t.dim).truncate().child(`${this.who.name} の質問`))
      .when(this.busy && !q, (el) => el.child(note("画面を読んでいます…")))
      .when(Boolean(q?.question), (el) => el.child(div().px(12).py(6).text_size(14).font_semibold().child(q.question)))
      .when(Boolean(q), (el) => el.children(q.options.map(option)))
      .when(Boolean(q?.multi), (el) => el.child(note("複数を選ぶ質問は、ターミナルで答えてください")))
      .when(!this.busy && !q, (el) => el
        .child(note("選択肢を読み取れませんでした。画面の最後:"))
        .child(div().mx(12).p(8).rounded(6).bg(t.surface).text_size(11).font_family("JetBrains Mono").text_color(t.muted)
          .child(this.screen || "（空）")))
      .when(Boolean(this.message), (el) => el.child(note(this.message, t.blocked)))
      .child(h_flex().px(6).pt(6).gap(4).justify_end()
        .child(button("ask-reload", "読み直す", (_e, cx) => { this.message = ""; this.load(cx); }))
        .child(button("ask-terminal", "ターミナルで答える", () => this.focus())));
  }
}
