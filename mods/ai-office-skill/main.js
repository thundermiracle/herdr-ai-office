// ai-office-skill: 本棚の一覧で skill をクリックすると出る、その skill の中身（SKILL.md。プラグインのコマンドはその .md）。
// props: { id, name, source, description, path, color }（source は出どころ。名前はここの表から今の言語で）。
// 先頭の --- の部分（name や description）は省き、本文をマークダウンで出す。
// props なしで開いたとき（herdr-app do mod.open --name ai-office-skill）は、最後に開いた skill、
// なければ本棚の最初の skill を出す。Esc か「閉じる」で閉じる。
import { View, div } from "gpui-kit";
import { v_flex, h_flex, TextView } from "gpui-base";
import { theme, props, shared, home, readTextFile, closeOverlay } from "herdr";

// 画面の文（言語ごと。ai-office の text.js と同じ決まりで、表にない言語・文は英語）。source は skill の出どころの名前
const TEXT = {
  en: {
    close: "Close",
    loading: "Loading…",
    cantRead: "Couldn't read the file",
    none: "No skill to show",
    sep: " · ",
    source: { user: "Your skills", project: "This project", synced: "Synced from claude.ai", plugin: "Plugins", codex: "Codex" },
  },
  ja: {
    close: "閉じる",
    loading: "読んでいます…",
    cantRead: "ファイルを読めませんでした",
    none: "表示する skill がありません",
    sep: "　",
    source: { user: "自分の skill", project: "このプロジェクト", synced: "claude.ai から同期", plugin: "プラグイン", codex: "Codex" },
  },
};

// 今の言語の表: オフィスの上の帯の言語のボタンで選んだもの（shared の ai-office.lang）。OS に合わせるなら、オフィスが調べた
// OS の言語（ai-office.os-lang）
function words() {
  const choice = shared("ai-office.lang");
  return { ...TEXT.en, ...TEXT[choice && choice !== "auto" ? choice : shared("ai-office.os-lang")] };
}

// 先頭の --- から --- までを除いた本文
function body(text) {
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") return text;
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  return end > 0 ? lines.slice(end + 1).join("\n").trimStart() : text;
}

function skillToShow() {
  const p = props() ?? {};
  if (p.path) return p;
  const last = shared("ai-office.lastSkill");
  if (last?.path) return last;
  const data = shared("ai-office.skills");
  const first = data?.global?.[0];
  return first ? { ...first, color: data?.sources?.[first.source]?.color } : {};
}

export default class SkillView extends View {
  init(_props, cx) {
    this.skill = skillToShow();
    this.text = null; // ファイルの中身（null: まだ）
    this.failed = false;
    cx.spawn(async (cx) => {
      try {
        this.text = this.skill.path ? await readTextFile(this.skill.path) : null;
      } catch {
        this.text = null;
      }
      this.failed = this.text === null;
      cx.notify();
    });
  }

  render() {
    const t = theme();
    const T = words();
    const s = this.skill;
    const where = (s.path ?? "").replace(home(), "~");
    const content = this.failed
      ? div().text_size(12.5).text_color(t.dim).child(s.path ? T.cantRead : T.none)
      : this.text === null
        ? div().text_size(12.5).text_color(t.dim).child(T.loading)
        : TextView.markdown("skill-body", body(this.text)).scrollable(true).selectable(true).size_full();
    return v_flex().size_full().min_h(0).text_color(t.foreground)
      .child(h_flex().flex_none().px(16).pt(14).pb(10).gap(10).items_center().border_b(1).border_color(t.border)
        .child(div().w(10).h(18).flex_none().rounded(2).bg(s.color ?? t.dim))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().text_size(15).font_semibold().truncate().child(s.id ?? s.name ?? "skill"))
          .child(div().text_size(11.5).text_color(t.dim).truncate().child([T.source[s.source] ?? s.group, where].filter(Boolean)
            .join(T.sep))))
        .child(div().id("skill-close").flex_none().px(10).h(26).flex().items_center().rounded(6).text_size(12)
          .text_color(t.muted).cursor_pointer().hover((st) => st.bg(t.hover).text_color(t.foreground))
          .on_click(() => props()?.overlay && closeOverlay(props().overlay))
          .child(T.close)))
      .when(Boolean(s.description), (el) => el.child(div().flex_none().px(16).py(8).text_size(12.5).text_color(t.muted)
        .border_b(1).border_color(t.border).child(s.description)))
      .child(div().flex_1().min_h(0).px(16).py(10).child(content));
  }
}
