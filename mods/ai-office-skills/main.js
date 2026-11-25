// ai-office-skills: オフィスの本棚をクリックすると出る、使える skill の一覧（1 冊 = 1 つの skill）。
// props: { count, groups: [{ source, color, skills: [{ id, name, source, description, path }] }] }（source は出どころ。
// 見出しの名前は、ここの表から今の言語で）
// 出どころごとに、本と同じ色の見出しを付けて並べる。skill をクリックすると、その中身（ai-office-skill）を開く。
// props なしで開いたとき（herdr-app do mod.open --name ai-office-skills）は、オフィスが shared に置いた一覧から
// 資料室の本棚（どこでも使える skill と、各スペースのプロジェクトの skill）を出す（オフィスが一度も開いていなければ空）。
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, props, shared, setShared, openOverlay } from "herdr";

// これより多いと、ポップアップの高さを決めて一覧をスクロールさせる（中身の高さに合わせるポップアップでは、
// 一覧に高さの上限だけ付けてもスクロールせず、はみ出した分が切れる）
const SCROLL_FROM = 6;
const HEIGHT = 500;

// 画面の文（言語ごと。ai-office の text.js と同じ決まりで、表にない言語・文は英語）。source は skill の出どころの名前
const TEXT = {
  en: {
    shelf: (n) => `Library shelf: ${n} ${n === 1 ? "skill" : "skills"} (click one to read it)`,
    group: (name, n) => `${name} (${n})`,
    builtIn: "Skills built into Claude Code (/code-review and so on) have no files, so they aren't on the shelf",
    source: { user: "Your skills", project: "This project", synced: "Synced from claude.ai", plugin: "Plugins", codex: "Codex" },
  },
  ja: {
    shelf: (n) => `資料室の本棚: skill ${n} 冊（クリックで中身）`,
    group: (name, n) => `${name}（${n}）`,
    builtIn: "Claude Code に組み込みの skill（/code-review など）はファイルがないので、本棚にはありません",
    source: { user: "自分の skill", project: "このプロジェクト", synced: "claude.ai から同期", plugin: "プラグイン", codex: "Codex" },
  },
};

// 今の言語の表: オフィスの上の帯の言語のボタンで選んだもの（shared の ai-office.lang）。OS に合わせるなら、オフィスが調べた
// OS の言語（ai-office.os-lang）
function words() {
  const choice = shared("ai-office.lang");
  return { ...TEXT.en, ...TEXT[choice && choice !== "auto" ? choice : shared("ai-office.os-lang")] };
}

// shared("ai-office.skills") から、資料室の本棚（出どころの順、同じ出どころは名前の順。同じものは 1 冊）
function fromShared() {
  const data = shared("ai-office.skills");
  if (!data) return { count: 0, groups: [] };
  const seen = new Set();
  const list = [...(data.global ?? []), ...Object.values(data.byFolder ?? {}).flat()].filter((s) => {
    const key = `${s.source}:${s.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const groups = Object.entries(data.sources ?? {})
    .map(([source, { color }]) => ({
      source, color, skills: list.filter((s) => s.source === source).sort((a, b) => a.id.localeCompare(b.id)),
    }))
    .filter((g) => g.skills.length);
  return { count: list.length, groups };
}

// skill の中身を開く（一覧は開いたまま。中身を Esc で閉じると一覧に戻る）。出どころの名前は、中身のダイアログが今の言語で出す
function open(skill, group) {
  const spec = { ...skill, color: group.color };
  setShared("ai-office.lastSkill", spec); // mod.open --name ai-office-skill で開き直せるように
  openOverlay({ mod: "ai-office-skill", kind: "dialog", width: 760, height: 0.8, props: spec });
}

export default class Skills extends View {
  render() {
    const t = theme();
    const T = words();
    const p = props()?.groups ? props() : fromShared();
    const groups = p.groups ?? [];
    const tall = (p.count ?? 0) > SCROLL_FROM;
    const note = (text) => div().px(10).py(6).text_size(11.5).text_color(t.dim).child(text);
    const row = (s, i, g, gi) => v_flex().id(`skill-${gi}-${i}`).px(10).py(4).gap(1).rounded(6).cursor_pointer()
      .hover((st) => st.bg(t.hover))
      .on_click(() => open(s, g))
      .child(div().text_size(12.5).font_semibold().text_color(t.foreground).truncate().child(s.id))
      .when(Boolean(s.description), (el) => el.child(div().text_size(11.5).text_color(t.muted).truncate().child(s.description)));
    return v_flex().w_full().when(tall, (el) => el.h(HEIGHT)).text_color(t.foreground)
      .child(div().px(10).pt(8).pb(6).flex_none().text_size(12).text_color(t.dim)
        .child(T.shelf(p.count ?? 0)))
      .child(v_flex().id("skills-list").when(tall, (el) => el.flex_1().min_h(0)).px(4).pb(4).overflow_y_scrollbar()
        .children(groups.map((g, gi) => v_flex().pt(6)
          .child(h_flex().px(10).pb(2).gap(6).items_center().text_size(11).text_color(t.dim)
            .child(div().w(8).h(12).rounded(1).bg(g.color))
            .child(T.group(T.source[g.source] ?? g.source, g.skills.length)))
          .children(g.skills.map((s, i) => row(s, i, g, gi)))))
        .child(note(T.builtIn)));
  }
}
