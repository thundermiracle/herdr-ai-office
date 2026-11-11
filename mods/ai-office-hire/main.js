// ai-office-hire: オフィスの空いた席をクリックすると出るポップアップ。その部屋（スペース）に
// エージェントを雇う（新しいタブで起動する）。props: { space, machine }。
// props なしで開いたとき（herdr-app do mod.open --name ai-office-hire）は、今のスペースに雇う。
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, spaces, props, knownAgents, run, closeOverlay } from "herdr";

export default class Hire extends View {
  init(_props, cx) {
    const p = props() ?? {};
    const space = spaces().find((s) => s.id === p.space) ?? spaces().find((s) => s.active);
    this.space = space?.id ?? null;
    this.spaceName = space?.name ?? "";
    this.machine = p.machine ?? space?.machine ?? null;
    this.agents = null; // knownAgents() の答え（null: まだ）
    this.failed = false;
    cx.spawn(async (cx) => {
      try {
        this.agents = await knownAgents({ on: this.machine });
      } catch {
        this.failed = true;
      }
      cx.notify();
    });
  }

  hire(agent) {
    const overlay = props()?.overlay;
    if (overlay) closeOverlay(overlay);
    run("tab.new", { space: this.space, name: agent.name, argv: agent.run });
  }

  render() {
    const t = theme();
    const icon = (a) => (a.tint ? svg(a.icon).size(14).text_color(t.foreground) : image(a.icon).size(14));
    const ready = (this.agents ?? []).filter((a) => a.installed);
    const note = (text) => div().px(8).py(6).text_size(12).text_color(t.dim).child(text);
    return v_flex().w_full().p(6).gap(2).text_size(13).text_color(t.foreground)
      .child(div().px(8).pt(2).pb(4).text_size(11.5).text_color(t.dim)
        .child(this.spaceName ? `「${this.spaceName}」に雇う` : "雇う"))
      .when(this.failed, (el) => el.child(note("エージェントを調べられませんでした")))
      .when(!this.failed && this.agents === null, (el) => el.child(note("調べています…")))
      .when(!this.failed && this.agents !== null && !ready.length, (el) => el.child(note("入っているエージェントがありません")))
      .children(ready.map((a, i) => h_flex().id(`hire-${i}`).h(28).px(8).gap(8).items_center().rounded(6)
        .cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click(() => this.hire(a))
        .child(icon(a))
        .child(div().flex_1().truncate().child(a.name))));
  }
}
