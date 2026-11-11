// ai-office-skill: 本棚の一覧で skill をクリックすると出る、その skill の中身（SKILL.md。プラグインのコマンドはその .md）。
// props: { id, name, description, path, group, color }。先頭の --- の部分（name や description）は省き、本文をマークダウンで出す。
// props なしで開いたとき（herdr-app do mod.open --name ai-office-skill）は、最後に開いた skill、
// なければ本棚の最初の skill を出す。Esc か「閉じる」で閉じる。
import { View, div } from "gpui-kit";
import { v_flex, h_flex, TextView } from "gpui-base";
import { theme, props, shared, home, readTextFile, closeOverlay } from "herdr";

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
  const source = data?.sources?.[first?.source];
  return first ? { ...first, group: source?.label, color: source?.color } : {};
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
    const s = this.skill;
    const where = (s.path ?? "").replace(home(), "~");
    const content = this.failed
      ? div().text_size(12.5).text_color(t.dim).child(s.path ? "ファイルを読めませんでした" : "表示する skill がありません")
      : this.text === null
        ? div().text_size(12.5).text_color(t.dim).child("読んでいます…")
        : TextView.markdown("skill-body", body(this.text)).scrollable(true).selectable(true).size_full();
    return v_flex().size_full().min_h(0).text_color(t.foreground)
      .child(h_flex().flex_none().px(16).pt(14).pb(10).gap(10).items_center().border_b(1).border_color(t.border)
        .child(div().w(10).h(18).flex_none().rounded(2).bg(s.color ?? t.dim))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().text_size(15).font_semibold().truncate().child(s.id ?? s.name ?? "skill"))
          .child(div().text_size(11.5).text_color(t.dim).truncate().child([s.group, where].filter(Boolean).join("　"))))
        .child(div().id("skill-close").flex_none().px(10).h(26).flex().items_center().rounded(6).text_size(12)
          .text_color(t.muted).cursor_pointer().hover((st) => st.bg(t.hover).text_color(t.foreground))
          .on_click(() => props()?.overlay && closeOverlay(props().overlay))
          .child("閉じる")))
      .when(Boolean(s.description), (el) => el.child(div().flex_none().px(16).py(8).text_size(12.5).text_color(t.muted)
        .border_b(1).border_color(t.border).child(s.description)))
      .child(div().flex_1().min_h(0).px(16).py(10).child(content));
  }
}
