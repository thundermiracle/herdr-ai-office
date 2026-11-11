// ai-office-spike: PoC の描画方針を決めるための確認用 mod。決まったら ~/.config/herdr-app/mods から消す。
// MODE で確かめることを選ぶ:
//   all    1. アニメ GIF / WebP が image() でループするか（コマごとに色と数字が変わる）
//          2. ドット絵のにじみ: 同じ 16px の市松模様を 1・2・4 倍の画像で、同じ大きさに描く
//          3. 静止画 2 枚と opacity の loop でコマを切り替える代わりの方法、top の loop で上下に揺らす
//          4. transition("left") の移動と、移動中に兄弟の順番を入れ替えても動きが続くか
//          5. FPS（gpui-fps の HUD。show_fps_monitor() は herdr-app の窓では使えないので mod の中に置く）
//   static 動くものなし（CPU の基準）
//   tick4  250ms ごとのタイマーで静止画 2 枚を切り替える（cx.notify で窓全体を描き直す）
//   tick8  125ms ごと
//   loop1  opacity の loop 1 つ（-10..11 で切り替え）
//   move   transition の移動 1 つ（4 秒ごとに 3 秒かけて往復）
// herdr-app do mod.open --name ai-office-spike で開き、もう一度同じコマンドで閉じる。
import { View, div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, window, settings } from "herdr";
import { fps_monitor } from "gpui-fps";

const MODE = "all";
const IMG = "mods/ai-office-spike/img";

const label = (t, text) => div().text_size(11).text_color(t.muted).child(text);
const cell = (t, name, el) => v_flex().gap(4).items_center().child(el).child(label(t, name));
const sprite = (file) => image(`${IMG}/${file}`).absolute().left(0).top(0).size(32);
const flip = () => sprite("frame-b.png").loop("opacity", { from: -10, to: 11, period: 800, easing: "linear" });

export default class Spike extends View {
  init(_props, cx) {
    this.renders = 0;
    this.started = Date.now();
    this.x = 0; // 動かす箱の目標（0 か 300）
    this.swapped = false; // 2 つの箱の、children の中での順番
    this.anim = true; // アニメ画像を出しているか
    this.frame = 0; // tick で切り替える静止画
    if (MODE === "all" || MODE === "move") {
      // 4 秒ごとに目標を切り替える（移動は 3 秒かける）。同時に兄弟の順番も入れ替える
      cx.timer.every(4000, (cx) => {
        this.x = this.x ? 0 : 300;
        this.swapped = !this.swapped;
        cx.notify();
      });
    }
    if (MODE === "all") {
      // 20 秒ごとにアニメ画像を出したり消したりする
      cx.timer.every(20000, (cx) => {
        this.anim = !this.anim;
        cx.notify();
      });
    }
    if (MODE === "tick4" || MODE === "tick8") {
      cx.timer.every(MODE === "tick4" ? 250 : 125, (cx) => {
        this.frame ^= 1;
        cx.notify();
      });
    }
  }

  render() {
    const t = theme();
    this.renders++;
    const sec = ((Date.now() - this.started) / 1000).toFixed(1);
    const root = v_flex().id("root").relative().size_full().p(16).gap(16).bg(t.background).text_color(t.foreground).text_size(12)
      .child(div().text_color(t.dim).child(
        `${MODE} · renders ${this.renders} · ${sec}s · active ${window()?.active} · zoom ${settings()?.zoom} · x→${this.x}`));
    const box = (id, text, color, left, top) =>
      div().id(id).absolute().left(left).top(top).size(32).rounded(4).bg(color)
        .flex().items_center().justify_center().text_color("#ffffff").child(text)
        .transition("left", { duration: 3000, easing: "linear" });
    const track = (children) => div().id("track").relative().w(340).h(72).rounded(6).bg(t.surface).children(children);

    if (MODE === "static") return root.child(cell(t, "static", image(`${IMG}/check-4x.png`).size(32)));
    if (MODE === "tick4" || MODE === "tick8") {
      return root.child(cell(t, MODE, div().id("tick").relative().size(32).child(sprite(this.frame ? "frame-b.png" : "frame-a.png"))));
    }
    if (MODE === "loop1") return root.child(cell(t, "loop1", div().id("flip").relative().size(32).child(sprite("frame-a.png")).child(flip())));
    if (MODE === "move") return root.child(track([box("box-a", "A", "#3c64dc", this.x, 0)]));

    const a = box("box-a", "A", "#3c64dc", this.x, 0);
    const b = box("box-b", "B", "#e67828", 300 - this.x, 40);
    const stack = (id, top) => div().id(id).relative().size(32).child(sprite("frame-a.png")).child(top);
    return root
      .child(h_flex().gap(24).items_end()
        .when(this.anim, (el) => el
          .child(cell(t, "GIF", image(`${IMG}/anim.gif`).size(32)))
          .child(cell(t, "WebP", image(`${IMG}/anim.webp`).size(32))))
        .when(!this.anim, (el) => el.child(label(t, "（アニメ画像は非表示中）")))
        .child(cell(t, "1x→32", image(`${IMG}/check-1x.png`).size(32)))
        .child(cell(t, "2x→32", image(`${IMG}/check-2x.png`).size(32)))
        .child(cell(t, "4x→32", image(`${IMG}/check-4x.png`).size(32)))
        .child(cell(t, "1x→128", image(`${IMG}/check-1x.png`).size(128))))
      .child(h_flex().gap(24).items_end()
        .child(cell(t, "opacity 0..1", stack("fade",
          sprite("frame-b.png").loop("opacity", { from: 0, to: 1, period: 800, easing: "linear" }))))
        .child(cell(t, "opacity -10..11", stack("flip", flip())))
        .child(cell(t, "top loop", div().id("bob").relative().size(32)
          .child(sprite("frame-a.png").loop("top", { from: 0, to: -4, period: 500 })))))
      .child(label(t, `transition left 3s（4 秒ごとに往復、children の順番も入れ替え: ${this.swapped ? "B,A" : "A,B"}）`))
      .child(track(this.swapped ? [b, a] : [a, b]))
      .child(fps_monitor());
  }
}
