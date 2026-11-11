// ai-office: スペースを部屋に、エージェントをキャラクターにして、ドット絵のオフィスで見せる。
// 中身の計算は scene.js（herdr を知らない）。ここは herdr のデータを集めて渡し、返ってきた絵を並べる。
// 絵は 4 倍に拡大済みの PNG で、絵の 1 ピクセルを SCALE（2）論理 px で描く（にじまない大きさ）。
import { View, div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, agents, terminals, theme, window, run, openOverlay, pickFolder } from "herdr";
import { SCALE, WALL_H, TICK_ACTIVE, TICK_INACTIVE, Office, roomsOf, layoutRooms, drawables } from "./scene.js";

const IMG = "mods/ai-office/img";
const px = (v) => v * SCALE;
const FLOOR_W = 512; // floor.png / wall.png の幅（art px）
const WIDE = 260; // これ以上の幅の部屋にはホワイトボードも掛ける

/** herdr のデータを集める: スペースごとの部屋と、エージェントごとの状態。 */
function gather() {
  const ag = agents();
  const terms = new Map(terminals().map((t) => [t.address, t]));
  const info = new Map(ag.map((a) => {
    const t = terms.get(a.address);
    return [a.address, {
      status: a.status,
      app: a.app ?? a.program?.key,
      kind: t?.report?.kind ?? t?.status?.kind ?? null, // blocked のとき: permission / question
      act: t?.labels?.["office.act"] || null, // フックが付ける（本棚へ行くか）
      name: a.program?.name ?? a.app ?? "agent",
      where: `${a.space_name} / ${a.tab_name}`,
    }];
  }));
  return { rooms: roomsOf(spaces(), ag), info };
}

export default class AiOffice extends View {
  init(_props, cx) {
    this.office = new Office();
    this.width = 900; // on_size_change が来るまでの仮の幅（論理 px）
    this.last = Date.now();
    this.sig = "";
    this.schedule(cx);
  }

  // コマ送り: 1 本のタイマーで全員の位置とコマを進める。ネイティブの loop / transition は
  // 約 30fps で窓全体を描き直す（1 つで CPU 約 20%）ので使わない。窓が後ろにあるときはゆっくり。
  schedule(cx) {
    cx.timer.after(window()?.active ? TICK_ACTIVE : TICK_INACTIVE, (cx) => {
      const now = Date.now();
      const dt = Math.min(now - this.last, 1000); // スリープ明けに瞬間移動しないよう
      this.last = now;
      const { rooms, info } = gather();
      this.office.sync(rooms, info);
      this.office.tick(dt);
      // 描く絵（名前と位置）が前のコマと同じなら描き直さない
      const sig = rooms.map((r) => drawables(r, this.office).map((d) => `${d.img}@${d.x},${d.y}`).join(";")).join("|");
      if (sig !== this.sig) {
        this.sig = sig;
        cx.notify();
      }
      this.schedule(cx);
    });
  }

  sprite(d) {
    return image(`${IMG}/${d.img}.png`).absolute().left(px(d.x)).top(px(d.y)).w(px(d.w)).h(px(d.h));
  }

  // クリックできる絵。窓（mod.open）で開いたときに押した所から窓が動きださないよう、押下は止める
  button(id, d, onClick, tip) {
    return div().id(id).absolute().left(px(d.x)).top(px(d.y)).w(px(d.w)).h(px(d.h)).cursor_pointer()
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => onClick(cx))
      .when(Boolean(tip), (el) => el.tooltip(tip))
      .child(image(`${IMG}/${d.img}.png`).size_full());
  }

  // scene.js の click: { type: "focus", terminal } / { type: "hire", space, machine }
  act(click) {
    if (click.type === "focus") run("agent.focus", { terminal: click.terminal });
    if (click.type === "hire") {
      openOverlay({ mod: "ai-office-hire", kind: "popup", width: 240, height: 320, props: { space: click.space, machine: click.machine } });
    }
  }

  item(room, d) {
    return d.click ? this.button(`${room.id}-${d.id}`, d, () => this.act(d.click), d.tip) : this.sprite(d);
  }

  // 壁の名札（スペースの名前）。ホワイトボードは部屋が広いときだけ置くので、名札はそこまで伸ばせる
  plate(room) {
    const text = room.machine ? `${room.machine}: ${room.name}` : room.name;
    const right = room.w >= WIDE ? room.w - 116 : room.w - 76;
    return div().id(`plate-${room.id}`).absolute().left(px(44)).top(px(5)).h(px(12)).max_w(px(right - 44))
      .cursor_pointer().on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click(() => run("space.select", { id: room.id }))
      .px(8).flex().items_center().rounded(3).border(2).border_color("#5b3a2c").bg(room.active ? "#c58a55" : "#a8774c")
      .text_size(12).font_semibold().text_color("#fff4dc").whitespace_nowrap().text_ellipsis().overflow_hidden()
      .child(text);
  }

  room(room, t) {
    const back = [];
    for (let x = 0; x < room.w; x += FLOOR_W) {
      back.push(image(`${IMG}/floor.png`).absolute().left(px(x)).top(px(WALL_H)).w(px(FLOOR_W)).h(px(160)));
      back.push(image(`${IMG}/wall.png`).absolute().left(px(x)).top(0).w(px(FLOOR_W)).h(px(36)));
    }
    return div().id(`room-${room.id}`).absolute().left(px(room.ox)).top(px(room.oy)).w(px(room.w)).h(px(room.h))
      .overflow_hidden().rounded(4).border(2).border_color(room.active ? t.accent : "#1d1f26")
      .children(back)
      .when(room.w >= WIDE, (el) => el.child(this.sprite({ img: "whiteboard", x: room.w - 112, y: 7, w: 30, h: 18 })))
      .child(this.sprite({ img: "window", x: room.w - 72, y: 6, w: 28, h: 16 }))
      .child(this.sprite({ img: "clock", x: room.w - 32, y: 9, w: 11, h: 11 }))
      .child(this.plate(room))
      .children(drawables(room, this.office).map((d) => this.item(room, d)));
  }

  // 「新しい部屋」: フォルダを選んで、そこにスペースを作る（pickFolder はこの Mac だけ）
  newRoom(lot) {
    return div().id("new-room").absolute().left(px(lot.ox)).top(px(lot.oy)).w(px(lot.w)).h(px(lot.h))
      .rounded(4).border(2).border_color("#ffffff22").bg("#ffffff0d")
      .cursor_pointer().hover((s) => s.bg("#ffffff1a"))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => cx.spawn(async () => {
        const folder = await pickFolder({ prompt: "この部屋にする" });
        if (folder) run("space.new", { folder });
      }))
      .tooltip("新しい部屋（スペース）を作る")
      .child(this.sprite({ img: "door", x: (lot.w - 16) / 2, y: 40, w: 16, h: 20 }))
      .child(div().absolute().left(0).top(px(66)).w(px(lot.w)).flex().justify_center()
        .text_size(11).text_color("#ffffffaa").child("+ 部屋"));
  }

  render() {
    const t = theme();
    const { rooms, info } = gather();
    this.office.sync(rooms, info);
    const office = layoutRooms(rooms, this.width / SCALE);
    const counts = { working: 0, blocked: 0, done: 0, idle: 0 };
    for (const a of info.values()) counts[a.status] = (counts[a.status] ?? 0) + 1;
    return v_flex().id("root").size_full().bg(t.canvas).text_color(t.foreground)
      .on_size_change((size, cx) => {
        if (Math.abs(size.width - this.width) >= 1) {
          this.width = size.width;
          cx.notify();
        }
      })
      .child(h_flex().h(32).flex_none().px(14).gap(14).items_center().text_size(12).text_color(t.muted)
        .child(div().font_semibold().text_color(t.foreground).child("AI Office"))
        .child(div().child(`作業中 ${counts.working} · 待ち ${counts.blocked} · 完了 ${counts.done} · 待機 ${counts.idle}`)))
      .child(div().id("scroll").flex_1().min_h(0).overflow_y_scroll()
        .child(div().relative().w(px(office.w)).h(px(office.h))
          .children(office.rooms.map((r) => (r.newRoom ? this.newRoom(r) : this.room(r, t))))));
  }
}
