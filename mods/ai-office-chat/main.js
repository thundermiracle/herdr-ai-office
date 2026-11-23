// ai-office-chat: オフィスの右のターミナルを隠しているときに、キャラをクリックすると出る、そのエージェントとの会話
// （ターミナルを出しているときは、キャラのクリックはターミナルの切り替え。main.js の act）。
// やりとりは Claude Code の会話の記録（フックが付けるラベル office.transcript の JSONL）の末尾から読む: あなたの発言と、
// AI の文章の返事（マークダウン）。ツールは回数と最後の 1 つだけ、考えている途中は出さない（transcript.js）。
// 記録が読めないとき（Codex などフックのないエージェントと、Claude Code でもまだフックが一度も動いていないうち）は、
// ターミナルの画面の最後を出す。
// 下の欄に書いて送ると、そのターミナルに貼り付けて Enter（hc send。ターミナルで書きかけがあると、それが終わるまで待つ）。
// AI が作業中でも送れる（Claude Code は作業の途中で受け取る）。送った文は、記録に出るまで「送信済み」として出す。
// 送らないとき: エージェントが終わっている（ターミナルがシェルに戻っていて、文がコマンドとして打たれてしまう）、
// 質問や許可の確認で止まっている（オフィスの「?」かターミナルで答える）。
// 開いている間は 1 秒ごとに見て、エージェントが変わったとき（agents() の seq）と、作業中は 4 秒ごとに読み直す。記録は、
// 開いたときは末尾の 20MB から、そのあとは前に読んだところの少し前から（重なりは id で除く）。
// スクロールは自前（ai-office-docs と同じ）: マークダウンの表示部品はあとから高さが伸びるので、見える枠と中身の高さを測り、
// いちばん下にいる間（開いたとき・送ったとき・いちばん下までスクロールしたとき）は、中身が伸びるたびにいちばん下に合わせる。
// ホイールで上へ戻ると追いかけるのをやめ、右下に「↓ 最新へ」を出す。
// Esc か「閉じる」で閉じる。「ターミナルを開く」でそのターミナルへ。
// props: { terminal, name, machine }。props なしで開いたとき（herdr-app do mod.open --name ai-office-chat）は、最初のエージェント。
import { View, div } from "gpui-kit";
import { v_flex, h_flex, TextView, TextareaState, Textarea } from "gpui-base";
import { theme, props, agents, terminals, layout, exec, hc, run, closeOverlay, checking } from "herdr";
import { READ_SH, readEntries, mergeEntries, chatBubbles, delivered } from "./transcript.js";

const TICK_MS = 1000; // 状態を見る間隔
const WORKING_READ_MS = 4000; // 作業中に記録を読み直す間隔（状態が変わらなくても、ツールの合間に文章が増える）
const WINDOW = 20000000; // 開いたときに読む記録の末尾（バイト。100MB を超える記録でも 1 秒ほど）
const OVERLAP = 262144; // 読み直すとき、前に読んだところより少し前から（書きかけだった行も読み直す）
const SEND_TIMEOUT_MS = 90000; // 送るのを待つ時間（hc send はターミナルの書きかけを 60 秒まで待つ）
const SCREEN_LINES = 30; // 記録が読めないときに出す画面の行数
const STATUS = { working: "作業中", idle: "待機中", done: "完了", blocked: "質問か確認で止まっています" };

// 誰と話すか
function target() {
  const p = props() ?? {};
  if (p.terminal) return { terminal: p.terminal, name: p.name ?? p.terminal, machine: p.machine ?? null };
  const a = agents()[0];
  return a ? { terminal: a.address, name: `${a.program?.name ?? a.app ?? "agent"} · ${a.space_name} / ${a.tab_name}`, machine: null } : null;
}

// オフィスのレイアウト（ai-office）でターミナルのブロック（agent）を隠していたら出す（隠したままだと、開いても見えない）
function showTerminal() {
  const find = (n) => (n?.id === "agent" ? n : (n?.children ?? []).map(find).find(Boolean) ?? null);
  if (find(layout())?.hidden) run("layout.show", { id: "agent" });
}

// 送る。PATH に hc がなければ Herdr の hc で（そのときは待つ時間を決められない）
async function hcSend(terminal, text) {
  try {
    return await exec("hc", ["send", terminal, text, "--json"], { timeout: SEND_TIMEOUT_MS });
  } catch {
    return hc(["send", terminal, text, "--json"]);
  }
}

export default class Chat extends View {
  init(_props, cx) {
    this.who = target();
    this.path = null; // 読んでいる記録（ラベル office.transcript）
    this.entries = []; // 記録から読んだもの（readEntries を重ねたもの）
    this.size = -1; // 記録をどこまで読んだか（バイト。-1 はまだ読んでいない）
    this.screen = null; // 記録が読めないときの、画面の最後
    this.pending = []; // 送ったが、まだ記録に出ていない文 { text, at }
    this.message = ""; // 送るときの知らせ（送っています・送れなかった理由）
    this.problem = ""; // 読めなかった理由
    this.sending = false;
    this.loading = false;
    this.seq = undefined;
    this.readAt = 0;
    this.shown = ""; // 前に描いた状態の行（変わったときだけ描き直す）
    this.input = TextareaState.new({ placeholder: "メッセージ" });
    this.input.set_auto_grow(2, 8);
    this.input.on("submit", (e, cx) => this.submit(e, cx));
    this.top = 0; // やりとりをどれだけ上にずらしているか（px）
    this.viewH = 0; // 見える枠の高さ
    this.bodyH = 0; // やりとりの高さ
    this.follow = true; // いちばん下を見せ続けるか
    this.handle = cx.focus_handle();
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    if (checking() || !this.who) return;
    this.tick(cx);
    cx.timer.every(TICK_MS, (cx) => this.tick(cx));
  }

  agent() {
    return agents().find((a) => a.address === this.who.terminal) ?? null;
  }

  // 今していること（作業中のとき）: エージェントの報告に一行があればそれ、なければ記録の最後のツール（Claude Code の
  // terminals() には一行がないが、記録のツールの説明が同じもの）
  doing() {
    const t = terminals().find((x) => x.address === this.who.terminal);
    const said = t?.report?.msg ?? t?.status?.msg;
    if (said) return said;
    const bubbles = this.path ? chatBubbles(this.entries) : [];
    const last = bubbles[bubbles.length - 1];
    return last?.role === "assistant" ? last.lastTool ?? "" : "";
  }

  // 状態を見て、変わっていたら読み直す。記録の場所が変わったら（/clear で新しいセッション）、初めから読む
  tick(cx) {
    const t = terminals().find((x) => x.address === this.who.terminal);
    const path = t?.labels?.["office.transcript"] || null;
    if (path !== this.path) {
      this.path = path;
      this.entries = [];
      this.size = -1;
    }
    const a = this.agent();
    const seq = a?.seq ?? null;
    if (seq !== this.seq || this.size < 0 || (a?.status === "working" && Date.now() - this.readAt >= WORKING_READ_MS)) {
      this.seq = seq;
      this.load(cx);
    }
    const shown = `${a?.status}|${this.doing()}`;
    if (shown !== this.shown) {
      this.shown = shown;
      cx.notify();
    }
  }

  load(cx) {
    if (this.loading) return;
    this.loading = true;
    this.readAt = Date.now();
    const { terminal, machine } = this.who;
    const path = this.path;
    cx.spawn(async (cx) => {
      try {
        if (path) {
          const from = this.size < 0 ? -1 : Math.max(0, this.size - OVERLAP);
          const r = await exec("sh", ["-c", READ_SH, "sh", path, String(from), String(WINDOW)], { on: machine, timeout: 20000 });
          if (path !== this.path) return; // 読んでいる間にセッションが替わった
          if (r.code === 3) throw new Error("会話の記録が見つかりません");
          const nl = r.stdout.indexOf("\n");
          const size = Number(nl < 0 ? r.stdout : r.stdout.slice(0, nl));
          if (!r.stdout.trim() || !Number.isFinite(size)) throw new Error(r.stderr.trim() || "会話の記録を読めませんでした");
          if (size < this.size) { // 記録が短くなった（作り直された）: 次は初めから読む
            this.entries = [];
            this.size = -1;
            return;
          }
          this.entries = mergeEntries(this.entries, readEntries(nl < 0 ? "" : r.stdout.slice(nl + 1)));
          this.size = size;
          this.screen = null;
          this.pending = this.pending.filter((p) => !delivered(p, this.entries));
        } else {
          const r = await hc(["read", terminal]);
          if (r.code !== 0) throw new Error(r.stderr.trim() || "画面を読めませんでした");
          const screen = r.stdout.split("\n").filter((l) => l.trim()).slice(-SCREEN_LINES).join("\n");
          this.pending = []; // 記録がないので、届いたかは確かめられない（打ったものは画面に出る）
          this.screen = screen;
        }
        this.problem = "";
      } catch (e) {
        this.problem = String(e.message ?? e);
      } finally {
        this.loading = false;
        cx.notify();
      }
    });
  }

  // 見える枠（view）とやりとり（body）の高さが変わった: いちばん下を見せ続けているなら、いちばん下に合わせる
  measure(view, body, cx) {
    if (view === this.viewH && body === this.bodyH) return;
    this.viewH = view;
    this.bodyH = body;
    const max = Math.max(0, body - view);
    this.top = this.follow ? max : Math.min(this.top, max);
    cx.notify();
  }

  // ホイール: いちばん下まで来たら、また追いかける
  scrollTo(y, cx) {
    const max = Math.max(0, this.bodyH - this.viewH);
    const top = Math.max(0, Math.min(y, max));
    this.follow = top >= max - 4;
    if (top === this.top) return;
    this.top = top;
    cx.notify();
  }

  toBottom(cx) {
    this.follow = true;
    this.top = Math.max(0, this.bodyH - this.viewH);
    cx.notify();
  }

  // 入力欄の Enter: Shift+Enter は改行（まだ入っていなければ入れる）、ほかは送る（Enter で入った改行は送らない）
  submit(e, cx) {
    const value = this.input.value();
    const at = this.input.selected_range().start;
    if (e?.shift) {
      if (value[at - 1] !== "\n") this.input.replace("\n");
      return;
    }
    this.send(value[at - 1] === "\n" ? value.slice(0, at - 1) + value.slice(at) : value, cx);
  }

  send(value, cx) {
    const text = value.replace(/\s+$/, "");
    if (!text.trim() || this.sending) return;
    const a = this.agent();
    if (!a) {
      this.message = "エージェントが終わっています（送ると、シェルにコマンドとして打たれてしまうので送りません）";
    } else if (a.status === "blocked") {
      this.message = "質問か確認で止まっています。オフィスの「?」かターミナルで答えてください";
    } else {
      this.sending = true;
      this.message = "送っています（ターミナルで書きかけがあると、それが終わるまで待ちます）";
      cx.spawn(async (cx) => {
        try {
          const r = await hcSend(this.who.terminal, text);
          if (r.code !== 0) throw new Error(r.stderr.trim() || r.stdout.trim() || "送れませんでした");
          this.pending.push({ text, at: Date.now() });
          this.input.set_value("");
          this.message = "";
          this.readAt = 0; // 作業中なら次の見回りで読み直す
          this.toBottom(cx);
        } catch (e) {
          this.message = String(e.message ?? e);
        } finally {
          this.sending = false;
          cx.notify();
        }
      });
    }
    cx.notify();
  }

  close() {
    const overlay = props()?.overlay;
    if (overlay) closeOverlay(overlay);
  }

  focusTerminal() {
    showTerminal();
    run("agent.focus", { terminal: this.who.terminal });
    this.close();
  }

  key(e, cx) {
    if (e.keystroke !== "escape") return;
    this.close();
    cx.stop_propagation();
  }

  render() {
    const t = theme();
    const note = (text, color = t.dim) => div().px(12).py(2).text_size(11.5).text_color(color).child(text);
    const button = (id, text, onClick, primary = false) => div().id(id).flex_none().px(12).h(28).flex().items_center().rounded(7)
      .text_size(12).cursor_pointer().on_click(onClick).child(text)
      .when(primary, (el) => el.bg(t.solid).text_color(t.solid_foreground).hover((s) => s.opacity(0.88)))
      .when(!primary, (el) => el.text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)));
    const root = () => v_flex().id("chat").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .size_full().min_h(0).text_color(t.foreground);
    if (!this.who) return root().p(12).child(note("話せるエージェントがいません"));
    const a = this.agent();
    const doing = this.doing();
    const working = a?.status === "working";
    const state = !a ? "終わっています" : `${STATUS[a.status] ?? a.status ?? ""}${working && doing ? `: ${doing}` : ""}`;
    const max = Math.max(0, this.bodyH - this.viewH);
    const thumbH = max ? Math.max(24, (this.viewH * this.viewH) / this.bodyH) : 0;

    // 吹き出し: あなたは右、AI は左（マークダウン）。送信済みの文は薄く、作業中は下に今していること
    const mine = (id, text, sent = false) => h_flex().id(id).justify_end().pl(56).pr(12)
      .child(v_flex().items_end().gap(2)
        .child(div().px(10).py(6).rounded(10).bg(t.selected).text_size(13).when(sent, (el) => el.opacity(0.6)).child(text))
        .when(sent, (el) => el.child(div().text_size(10.5).text_color(t.dim).child("送信済み（届くのを待っています）"))));
    const theirs = (b) => v_flex().id(`ai-${b.id}`).pl(12).pr(56).gap(2)
      .child(div().text_size(10.5).text_color(t.dim)
        .child(["AI", b.tools ? `ツール ${b.tools} 回${b.lastTool ? `（最後: ${b.lastTool}）` : ""}` : ""].filter(Boolean).join("　")))
      .when(Boolean(b.text), (el) => el.child(div().px(10).py(6).rounded(10).bg(t.surface)
        .when(b.error, (d) => d.text_color(t.blocked))
        .child(TextView.markdown(`chat-md-${b.id}`, b.text).selectable(true))));
    const rows = [];
    if (this.path) {
      for (const b of chatBubbles(this.entries)) rows.push(b.role === "user" ? mine(`me-${b.id}`, b.text) : theirs(b));
    } else if (this.screen !== null) {
      rows.push(v_flex().id("screen").gap(4)
        .child(note("会話の記録が読めないので、ターミナルの画面の最後を出しています（Claude Code は、一度話しかけると記録が読めます）"))
        .child(div().mx(12).p(8).rounded(6).bg(t.surface).text_size(11).font_family("JetBrains Mono").text_color(t.muted)
          .child(this.screen || "（空）")));
    }
    this.pending.forEach((p, i) => rows.push(mine(`sent-${i}`, p.text, true)));
    if (working) rows.push(div().id("working").child(note(`作業中${doing ? `: ${doing}` : "…"}`)));

    return root()
      .child(h_flex().flex_none().px(16).pt(14).pb(10).gap(8).items_center().border_b(1).border_color(t.border)
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().text_size(15).font_semibold().truncate().child("会話"))
          .child(div().text_size(11.5).text_color(t.dim).truncate().child(`${this.who.name}　${state}`)))
        .child(button("chat-terminal", "ターミナルを開く", () => this.focusTerminal()))
        .child(button("chat-close", "閉じる", () => this.close())))
      .child(div().id("chat-view").flex_1().min_w(0).min_h(0).relative().overflow_hidden()
        .on_size_change((size, cx) => this.measure(size.height, this.bodyH, cx))
        .on_scroll_wheel((e, cx) => this.scrollTo(this.top - e.delta.y, cx))
        .child(v_flex().absolute().left(0).right(0).top(-this.top).py(10).gap(10)
          .on_size_change((size, cx) => this.measure(this.viewH, size.height, cx))
          .when(rows.length === 0, (el) => el.child(note(this.loading || this.size < 0 ? "読んでいます…" : "まだやりとりがありません")))
          .children(rows))
        .when(max > 0, (el) => el.child(div().absolute().right(3).w(4).h(thumbH).rounded(2).bg(t.dim).opacity(0.6)
          .top((this.top / max) * (this.viewH - thumbH))))
        .when(!this.follow && max > 0, (el) => el.child(div().absolute().right(16).bottom(10)
          .child(button("chat-latest", "↓ 最新へ", (_e, cx) => this.toBottom(cx), true)))))
      .child(v_flex().flex_none().px(12).pt(8).pb(10).gap(6).border_t(1).border_color(t.border)
        .when(Boolean(this.problem), (el) => el.child(note(this.problem, t.blocked)))
        .when(Boolean(this.message), (el) => el.child(note(this.message, t.blocked)))
        .child(h_flex().gap(8).items_end()
          .child(div().flex_1().min_w(0).child(Textarea.new(this.input).w_full().px(10).py(6).rounded(9).border_1()
            .border_color(t.input).bg(t.background).text_size(13).text_color(t.foreground)))
          .child(button("chat-send", this.sending ? "送っています…" : "送る", (_e, cx) => this.send(this.input.value(), cx), true)))
        .child(note("Enter で送る・Shift+Enter で改行・Esc で閉じる")));
  }
}
