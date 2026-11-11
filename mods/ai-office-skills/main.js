// ai-office-skills: オフィスの本棚をクリックすると出る、使える skill の一覧（1 冊 = 1 つの skill）。
// props: { title, count, remote, groups: [{ label, color, skills: [{ id, name, description }] }] }
// 出どころごとに、本と同じ色の見出しを付けて並べる。説明は 1 行に切り、マウスを乗せると全部出る。
// props なしで開いたとき（herdr-app do mod.open --name ai-office-skills）は、オフィスが shared に置いた一覧から
// 今のスペースの本棚を出す（オフィスが一度も開いていなければ空）。
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, props, shared, spaces } from "herdr";

// shared("ai-office.skills") から、今のスペースの本棚（出どころの順、同じ出どころは名前の順）
function fromShared() {
  const data = shared("ai-office.skills");
  const space = spaces().find((s) => s.active);
  if (!data || !space) return { title: space?.name ?? "", count: 0, groups: [] };
  const list = space.machine ? [] : [...(data.global ?? []), ...(data.byFolder?.[data.folders?.[space.id]] ?? [])];
  const groups = Object.entries(data.sources ?? {})
    .map(([source, { label, color }]) => ({
      label, color, skills: list.filter((s) => s.source === source).sort((a, b) => a.id.localeCompare(b.id)),
    }))
    .filter((g) => g.skills.length);
  return { title: space.name, count: list.length, remote: Boolean(space.machine), groups };
}

export default class Skills extends View {
  render() {
    const t = theme();
    const p = props()?.groups ? props() : fromShared();
    const groups = p.groups ?? [];
    const note = (text) => div().px(10).py(6).text_size(11.5).text_color(t.dim).child(text);
    const row = (s, i, g) => v_flex().id(`skill-${g}-${i}`).px(10).py(4).gap(1).rounded(6).hover((st) => st.bg(t.hover))
      .when(Boolean(s.description), (el) => el.tooltip(s.description))
      .child(div().text_size(12.5).font_semibold().text_color(t.foreground).truncate().child(s.id))
      .when(Boolean(s.description), (el) => el.child(div().text_size(11.5).text_color(t.muted).truncate().child(s.description)));
    // ポップアップは中身の高さになるので、一覧は flex_1 にせず（0 に縮む）、高さの上限を決めてスクロールさせる
    return v_flex().w_full().text_color(t.foreground)
      .child(div().px(10).pt(8).pb(6).text_size(12).text_color(t.dim)
        .child(p.title ? `「${p.title}」の本棚: skill ${p.count ?? 0} 冊` : `本棚: skill ${p.count ?? 0} 冊`))
      .child(v_flex().id("skills-list").max_h(440).px(4).pb(4).overflow_y_scrollbar()
        .when(Boolean(p.remote), (el) => el.child(note("別のマシンのスペースは、そのマシンの skill をまだ読んでいません")))
        .children(groups.map((g, gi) => v_flex().pt(6)
          .child(h_flex().px(10).pb(2).gap(6).items_center().text_size(11).text_color(t.dim)
            .child(div().w(8).h(12).rounded(1).bg(g.color))
            .child(`${g.label}（${g.skills.length}）`))
          .children(g.skills.map((s, i) => row(s, i, gi)))))
        .child(note("Claude Code に組み込みの skill（/code-review など）はファイルがないので、本棚にはありません")));
  }
}
