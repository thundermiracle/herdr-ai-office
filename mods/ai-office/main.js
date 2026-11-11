// ai-office: スペースを部屋に、エージェントをキャラクターにして、ドット絵のオフィスで見せる。
// 中身の計算は scene.js（herdr を知らない）。ここは herdr のデータを集めて渡し、返ってきた絵を並べる。
// 絵は 4 倍に拡大済みの PNG で、絵の 1 ピクセルを SCALE（2）論理 px で描く（にじまない大きさ）。
import { View, div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import * as fs from "fs/promises";
import {
  spaces, agents, terminals, panes, theme, window, run, openOverlay, pickFolder, home, readTextFile, layout, props, setShared,
} from "herdr";
import {
  SCALE, TICK_ACTIVE, TICK_INACTIVE, TICK_RUN, HALL_W, PART_W, PART_END, Office, roomsOf, layoutFloor, drawables,
  floorDrawables, running,
  clockHands, agentModel, parseCodexConfig, parseSkillFile, sortSkills, SKILL_SOURCES,
} from "./scene.js";

const IMG = "mods/ai-office/img";
const px = (v) => v * SCALE;
const FLOOR_W = 512; // floor.png / wall.png の幅（art px）
const FLOOR_H = 160; // floor.png の高さ
const HALL_TEX = { w: 48, h: 560 }; // hall.png（廊下の床）の大きさ
const MARGIN = 6; // フロアのまわりの余白
const WIDE = 260; // これ以上の幅の部屋にはホワイトボードも掛ける
const META_MS = 10000; // model と effort を読み直す間隔
const HIDDEN_MS = 1000; // 隠れている間は、この間隔で見えるようになったかだけ見る
const SKILLS_MS = 60000; // 使える skill を読み直す間隔（めったに変わらない）
const LEGEND = "見た目: 眼鏡とネクタイ = opus、なし = sonnet、若葉 = haiku、星のピン = fable、ヘッドホン = Codex"
  + "　鉢巻き: なし = low、青 = medium、白 = high、赤 = xhigh、赤と炎 = max";

/**
 * herdr のデータを集める: スペースごとの部屋と、エージェントごとの状態・model・effort。
 * meta: Claude のセッション ID → { model, effort }（loadMeta が読む）、codexDefaults: ~/.codex/config.toml の既定。
 */
function gather(meta, codexDefaults) {
  const ag = agents();
  const terms = new Map(terminals().map((t) => [t.address, t]));
  const info = new Map(ag.map((a) => {
    const t = terms.get(a.address);
    const app = a.app ?? a.program?.key;
    const sid = t?.labels?.["resume.id"]; // agent-resume が付ける Claude のセッション ID
    const { model, effort } = agentModel({ app, argv: t?.foreground?.argv, cached: sid ? meta.get(sid) : null, codexDefaults });
    return [a.address, {
      status: a.status,
      app,
      model,
      effort,
      kind: t?.report?.kind ?? t?.status?.kind ?? null, // blocked のとき: permission / question
      act: t?.labels?.["office.act"] || null, // フックが付ける（本棚へ行くか）
      skill: t?.labels?.["office.skill"] || null, // フックが付ける（このターンで使った skill）
      skillAt: t?.labels?.["office.skill_at"] || null, // skill を使うたびにフックが書く時刻（出来事として資料室へ行く）
      name: a.program?.name ?? a.app ?? "agent",
      where: `${a.space_name} / ${a.tab_name}`,
    }];
  }));
  const ps = panes();
  return { rooms: roomsOf(spaces().map((s) => ({ ...s, folder: placeOf(s, ps) })), ag), info };
}

// レイアウトの根から id のブロックまでの道（見つからなければ null）
function pathTo(node, id) {
  if (!node) return null;
  if (node.id === id) return [node];
  for (const child of node?.children ?? []) {
    const rest = pathTo(child, id);
    if (rest) return [node, ...rest];
  }
  return null;
}

// スペースが今いるフォルダ: 最初のターミナルの今のフォルダ、なければ作ったときのフォルダ（spaces-dots と同じ）。
// そのフォルダの .claude/skills が「このプロジェクト」の skill
function placeOf(space, ps) {
  const tabs = new Set((space.tabs ?? []).map((t) => t.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || space.folder || "";
}

// ---- 使える skill（本棚の本） ----

// フォルダの子フォルダの名前（ないときは []）
async function subdirs(dir) {
  try {
    return (await fs.readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

// フォルダの中の名前（ないときは []）
async function names(dir) {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

// <dir>/<名前>/SKILL.md の skill。prefix は Skill ツールで呼ぶときの名前空間（codex: など）
async function skillDirs(dir, source, prefix = "") {
  const out = [];
  for (const name of await subdirs(dir)) {
    if (name.startsWith(".") || name === "synced") continue;
    const text = await readOrNull(`${dir}/${name}/SKILL.md`);
    if (text === null) continue;
    const meta = parseSkillFile(text, name);
    out.push({ id: prefix + meta.name, name: meta.name, source, description: meta.description, path: `${dir}/${name}/SKILL.md` });
  }
  return out;
}

// この Mac の、どのスペースでも使える skill: 自分の skill（~/.claude/skills）、claude.ai から同期された skill
// （synced/*/manifest.json。Skill ツールでは anthropic-skills:<名前>）、プラグインの skill とコマンド（<プラグイン>:<名前>）、
// Codex の skill（~/.codex/skills）。Claude Code に組み込みの skill はファイルがないので入らない
async function globalSkills(base) {
  const list = await skillDirs(`${base}/.claude/skills`, "user");
  for (const bucket of await subdirs(`${base}/.claude/skills/synced`)) {
    try {
      const manifest = JSON.parse((await readOrNull(`${base}/.claude/skills/synced/${bucket}/manifest.json`)) ?? "{}");
      for (const s of manifest.skills ?? []) {
        list.push({ id: `anthropic-skills:${s.name}`, name: s.name, source: "synced", description: s.description ?? "",
          path: `${base}/.claude/skills/synced/${bucket}/${s.name}/SKILL.md` });
      }
    } catch {}
  }
  try {
    const installed = JSON.parse((await readOrNull(`${base}/.claude/plugins/installed_plugins.json`)) ?? "{}");
    for (const entries of Object.values(installed.plugins ?? {})) {
      for (const e of Array.isArray(entries) ? entries : [entries]) {
        const root = e?.installPath;
        if (!root) continue;
        const plugin = JSON.parse((await readOrNull(`${root}/.claude-plugin/plugin.json`)) ?? "{}").name ?? "plugin";
        list.push(...(await skillDirs(`${root}/skills`, "plugin", `${plugin}:`)));
        for (const file of (await names(`${root}/commands`)).filter((f) => f.endsWith(".md"))) {
          const name = file.slice(0, -3);
          const meta = parseSkillFile(await readOrNull(`${root}/commands/${file}`), name);
          list.push({ id: `${plugin}:${name}`, name, source: "plugin", description: meta.description, path: `${root}/commands/${file}` });
        }
      }
    }
  } catch {}
  list.push(...(await skillDirs(`${base}/.codex/skills`, "codex")));
  return list;
}

// ファイルを読む。ないとき・読めないときは null
async function readOrNull(path) {
  try {
    return await readTextFile(path);
  } catch {
    return null;
  }
}

export default class AiOffice extends View {
  init(_props, cx) {
    this.office = new Office();
    this.width = 900; // on_size_change が来るまでの仮の幅（論理 px）
    this.last = Date.now();
    this.sig = "";
    this.meta = new Map();
    this.codexDefaults = {};
    this.loadMeta(cx);
    cx.timer.every(META_MS, (cx) => this.loadMeta(cx));
    this.skills = { global: [], byFolder: new Map() };
    this.skillsKey = "";
    this.loadSkills(cx);
    cx.timer.every(SKILLS_MS, (cx) => this.loadSkills(cx));
    this.schedule(cx);
  }

  // 自分のブロック（props の block）が隠れているか: そのものか親が hidden、または stack の選ばれていない子。
  // 隠れていても mod は生きていてタイマーも動くので、隠れている間はコマ送りも描き直しもしない（Office ボタンで閉じたとき）。
  // 窓（mod.open）で開いたときや block がないときは、見えている扱い
  hidden() {
    const id = props()?.block;
    const path = id ? pathTo(layout(), id) : null;
    if (!path) return false;
    return path.some((node, i) => node.hidden || (node.type === "stack" && path[i + 1] && node.active !== path[i + 1].id));
  }

  // 使える skill: どのスペースでも使えるものと、スペースのフォルダの .claude/skills（このプロジェクトの skill）
  loadSkills(cx) {
    if (this.hidden()) return;
    cx.spawn(async (cx) => {
      const base = home();
      const global = await globalSkills(base);
      const byFolder = new Map();
      const folders = {}; // スペース → 今いるフォルダ（一覧のポップアップ用）
      const ps = panes();
      for (const s of spaces()) {
        const folder = placeOf(s, ps);
        folders[s.id] = folder;
        // ホームの .claude/skills は「自分の skill」なので、プロジェクトとしては数えない
        if (s.machine || !folder || folder === base || byFolder.has(folder)) continue;
        byFolder.set(folder, await skillDirs(`${folder}/.claude/skills`, "project"));
      }
      const key = JSON.stringify([global.map((x) => x.id), [...byFolder].map(([f, l]) => [f, l.map((x) => x.id)]), folders]);
      if (key !== this.skillsKey) {
        this.skillsKey = key;
        this.skills = { global, byFolder };
        // 一覧のポップアップを、本棚のクリックでなく mod.open で開いたとき用（今のスペースの本棚を出す）
        setShared("ai-office.skills", { sources: SKILL_SOURCES, global, byFolder: Object.fromEntries(byFolder), folders });
        cx.notify();
      }
    });
  }

  // 資料室の本棚の skill: どこでも使えるものと、各スペース（この Mac）のプロジェクトの skill。同じものは 1 冊
  shelfSkills() {
    const seen = new Set();
    return sortSkills([...this.skills.global, ...[...this.skills.byFolder.values()].flat()].filter((s) => {
      const key = `${s.source}:${s.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }));
  }

  // 今のフロア: 部屋の並び（フロア全体の位置 ox, oy 付き）。キャラもこの並びに合わせる
  floorNow() {
    const { rooms, info } = gather(this.meta, this.codexDefaults);
    const floor = layoutFloor(rooms, this.width / SCALE - 2 * MARGIN);
    const placed = floor.rooms.filter((r) => !r.newRoom);
    this.office.sync(placed, info);
    return { floor, placed, info };
  }

  // 描くもの（フロア全体の座標）: 資料室の本棚と、各部屋のもの。奥から手前の順に並べるので、
  // ほかの部屋の手前の通路や廊下を歩く人も、正しく前後する
  items(placed) {
    const skills = this.shelfSkills();
    return [
      ...floorDrawables(this.office, skills),
      ...placed.flatMap((r) => drawables(r, this.office, skills)
        .map((d) => ({ ...d, id: `${r.id}-${d.id}`, x: d.x + r.ox, y: d.y + r.oy, z: d.z + r.oy }))),
    ].sort((a, b) => a.z - b.z);
  }

  // model と effort: Claude は effort-recorder（statusLine）がセッションごとに書くキャッシュ
  // （~/.cache/claude-model/<id>、~/.cache/claude-effort/<id>）、Codex は ~/.codex/config.toml の既定。
  // コマ送りのたびには読まない。変わったときだけ描き直す
  loadMeta(cx) {
    if (this.hidden()) return;
    cx.spawn(async (cx) => {
      const base = home();
      const sids = new Set(terminals().map((t) => t.labels?.["resume.id"]).filter((id) => /^[0-9a-f-]{36}$/i.test(id ?? "")));
      let changed = false;
      for (const sid of sids) {
        const model = (await readOrNull(`${base}/.cache/claude-model/${sid}`))?.trim() || null;
        const effort = (await readOrNull(`${base}/.cache/claude-effort/${sid}`))?.trim() || null;
        const old = this.meta.get(sid);
        if (old?.model !== model || old?.effort !== effort) {
          this.meta.set(sid, { model, effort });
          changed = true;
        }
      }
      const codex = parseCodexConfig(await readOrNull(`${base}/.codex/config.toml`));
      if (codex.model !== this.codexDefaults.model || codex.effort !== this.codexDefaults.effort) {
        this.codexDefaults = codex;
        changed = true;
      }
      if (changed) cx.notify();
    });
  }

  // コマ送り: 1 本のタイマーで全員の位置とコマを進める。ネイティブの loop / transition は
  // 約 30fps で窓全体を描き直す（1 つで CPU 約 20%）ので使わない。窓が後ろにあるときはゆっくり。
  schedule(cx) {
    const hidden = this.hidden();
    const active = window()?.active;
    const ms = hidden ? HIDDEN_MS : !active ? TICK_INACTIVE : running(this.office) ? TICK_RUN : TICK_ACTIVE;
    cx.timer.after(ms, (cx) => {
      if (this.hidden()) {
        this.schedule(cx); // 隠れている間は何もしない（見えたときの経過時間は dt の上限で切る）
        return;
      }
      const now = Date.now();
      const dt = Math.min(now - this.last, 1000); // スリープ明けに瞬間移動しないよう
      this.last = now;
      const { placed } = this.floorNow();
      this.office.tick(dt);
      // 描く絵（名前と位置）が前のコマと同じなら描き直さない
      const { h, m } = clockHands(new Date()); // 時計の針が動いたときも描き直す
      const sig = `${h}:${m}|` + this.items(placed)
        .map((d) => `${d.img ?? d.text}+${d.over}+${d.books?.length ?? ""}@${d.x},${d.y}`).join(";");
      if (sig !== this.sig) {
        this.sig = sig;
        cx.notify();
      }
      this.schedule(cx);
    });
  }

  sprite(d) {
    if (d.over) return this.box(d).child(image(`${IMG}/${d.img}.png`).size_full()).child(this.overlay(d));
    return image(`${IMG}/${d.img}.png`).absolute().left(px(d.x)).top(px(d.y)).w(px(d.w)).h(px(d.h));
  }

  box(d) {
    return div().absolute().left(px(d.x)).top(px(d.y)).w(px(d.w)).h(px(d.h));
  }

  overlay(d) {
    return image(`${IMG}/${d.over}.png`).absolute().left(0).top(0).size_full();
  }

  // クリックできる絵。窓（mod.open）で開いたときに押した所から窓が動きださないよう、押下は止める
  button(id, d, onClick, tip) {
    return div().id(id).absolute().left(px(d.x)).top(px(d.y)).w(px(d.w)).h(px(d.h)).cursor_pointer()
      .when(Boolean(d.glow), (el) => el.rounded(6).hover((s) => s.bg("#ffffff59"))) // 絵はほぼ透明なので後ろを明るくする
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => onClick(cx))
      .when(Boolean(tip), (el) => el.tooltip(tip))
      .child(image(`${IMG}/${d.img}.png`).size_full())
      .when(Boolean(d.over), (el) => el.child(this.overlay(d)))
      .when(Boolean(d.books), (el) => el.children(d.books.map((b) => this.book(b))));
  }

  // scene.js の click: { type: "focus", terminal } / { type: "hire", space, machine } / { type: "skills" }
  act(click) {
    if (click.type === "focus") run("agent.focus", { terminal: click.terminal });
    if (click.type === "skills") {
      const skills = this.shelfSkills();
      const groups = Object.entries(SKILL_SOURCES)
        .map(([source, { label, color }]) => ({ label, color, skills: skills.filter((x) => x.source === source) }))
        .filter((g) => g.skills.length);
      openOverlay({ mod: "ai-office-skills", kind: "popup", width: 400, height: 520,
        props: { title: "資料室", count: skills.length, groups } });
    }
    if (click.type === "hire") {
      openOverlay({ mod: "ai-office-hire", kind: "popup", width: 240, height: 320, props: { space: click.space, machine: click.machine } });
    }
  }

  item(d) {
    if (d.text !== undefined) return this.tag(d);
    return d.click ? this.button(d.id, d, () => this.act(d.click), d.tip) : this.sprite(d);
  }

  // 本棚の本 1 冊（左の 1 列は本の色、右の 1 列は影。上から 2 ドット目に帯）
  book(b) {
    return div().absolute().left(px(b.x)).top(px(b.y)).w(px(b.w)).h(px(b.h)).bg(b.color)
      .child(div().absolute().left(px(1)).top(0).w(px(b.w - 1)).h_full().bg("#00000040"))
      .child(div().absolute().left(0).top(px(2)).w_full().h(px(1)).bg("#fffaf0"));
  }

  // 札（使っている skill の名前）。文字の幅が分からないので、広い枠の真ん中に置く
  tag(d) {
    return h_flex().absolute().left(px(d.x - 50)).top(px(d.y)).w(px(100)).h(px(9)).justify_center()
      .child(h_flex().h_full().pl(3).pr(5).gap(4).items_center().rounded(3).border(1).border_color("#3b2a2a").bg("#fffaf0")
        .child(div().w(px(2)).h(px(6)).bg(d.color ?? "#9aa4b4"))
        .child(div().text_size(10).text_color("#3b2a2a").whitespace_nowrap().child(d.text)));
  }

  // 壁時計（今の時刻。文字盤に時針と分針を重ねる）
  clock(x, y) {
    const { h, m } = clockHands(new Date());
    return ["clock-face", `clock-m-${m}`, `clock-h-${h}`].map((img) => this.sprite({ img, x, y, w: 13, h: 13 }));
  }

  // 壁の名札（スペースの名前）。左の仕切りの右から、窓（広い部屋ではホワイトボード）の手前まで伸ばせる
  plate(room) {
    const text = room.machine ? `${room.machine}: ${room.name}` : room.name;
    const right = room.w >= WIDE ? room.w - 116 : room.w - 76;
    return div().id(`plate-${room.id}`).absolute().left(px(room.ox + 10)).top(px(room.oy + 5)).h(px(12)).max_w(px(right - 14))
      .cursor_pointer().on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click(() => run("space.select", { id: room.id }))
      .px(8).flex().items_center().rounded(3).border(2).border_color("#5b3a2c").bg(room.active ? "#c58a55" : "#a8774c")
      .text_size(12).font_semibold().text_color("#fff4dc").whitespace_nowrap().text_ellipsis().overflow_hidden()
      .child(text);
  }

  // 奥の壁（wall.png を横に並べ、幅で切る）
  wall(x, y, w) {
    const tiles = [];
    for (let dx = 0; dx < w; dx += FLOOR_W) tiles.push(image(`${IMG}/wall.png`).absolute().left(px(dx)).top(0).w(px(FLOOR_W)).h(px(36)));
    return div().absolute().left(px(x)).top(px(y)).w(px(w)).h(px(36)).overflow_hidden().children(tiles);
  }

  // 部屋の左の仕切り（奥から PART_END まで。上から見た壁の天端と、手前の端の面）
  partition(x, y) {
    return div().absolute().left(px(x)).top(px(y)).w(px(PART_W)).h(px(PART_END)).bg("#e3cfa6")
      .child(div().absolute().left(0).top(0).w(px(1)).h_full().bg("#8a6040"))
      .child(div().absolute().right(0).top(0).w(px(1)).h_full().bg("#8a6040"))
      .child(div().absolute().left(0).bottom(0).w_full().h(px(6)).bg("#b07a4c"))
      .child(div().absolute().left(0).bottom(0).w_full().h(px(1)).bg("#5b3a2c"));
  }

  // 部屋の後ろのもの: 奥の壁、左の仕切り、壁の飾り（ホワイトボード・窓・時計）と名札
  roomBack(room) {
    const { ox, oy, w } = room;
    return [
      this.wall(ox, oy, w),
      this.partition(ox, oy),
      ...(room.newRoom ? [] : [
        ...(w >= WIDE ? [this.sprite({ img: "whiteboard", x: ox + w - 112, y: oy + 7, w: 30, h: 18 })] : []),
        this.sprite({ img: "window", x: ox + w - 72, y: oy + 6, w: 28, h: 16 }),
        ...this.clock(ox + w - 33, oy + 8),
        this.plate(room),
      ]),
    ];
  }

  // 空き部屋: クリックでフォルダを選んで、そこにスペース（部屋）を作る（pickFolder はこの Mac だけ）
  newRoom(lot) {
    return div().id("new-room").absolute().left(px(lot.ox + PART_W)).top(px(lot.oy + 36)).w(px(lot.w - PART_W)).h(px(lot.h - 36))
      .bg("#00000038").cursor_pointer().hover((s) => s.bg("#00000020"))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => cx.spawn(async () => {
        const folder = await pickFolder({ prompt: "この部屋にする" });
        if (folder) run("space.new", { folder });
      }))
      .tooltip("空き部屋: クリックで新しい部屋（スペース）を作る")
      .child(this.sprite({ img: "door", x: (lot.w - PART_W - 16) / 2, y: 22, w: 16, h: 20 }))
      .child(div().absolute().left(0).top(px(48)).w_full().flex().justify_center()
        .text_size(11).text_color("#fff4dcdd").child("+ 部屋"));
  }

  // 1 枚のフロア: 部屋の床と廊下の床、資料室の奥の壁、各部屋の後ろのもの、描くもの、選んでいる部屋の枠、外枠
  building(floor, items, t) {
    const floorTiles = [];
    for (let y = 0; y < floor.h; y += FLOOR_H) {
      for (let x = HALL_W; x < floor.w; x += FLOOR_W) {
        floorTiles.push(image(`${IMG}/floor.png`).absolute().left(px(x)).top(px(y)).w(px(FLOOR_W)).h(px(FLOOR_H)));
      }
    }
    const hallTiles = [];
    for (let y = 0; y < floor.h; y += HALL_TEX.h) {
      hallTiles.push(image(`${IMG}/hall.png`).absolute().left(0).top(px(y)).w(px(HALL_TEX.w)).h(px(HALL_TEX.h)));
    }
    const active = floor.rooms.find((r) => r.active);
    return div().relative().w(px(floor.w)).h(px(floor.h)).overflow_hidden().rounded(4)
      .children(floorTiles)
      .child(div().absolute().left(0).top(0).w(px(HALL_W)).h(px(floor.h)).overflow_hidden().children(hallTiles))
      .child(this.wall(0, 0, HALL_W))
      .children(floor.rooms.flatMap((r) => this.roomBack(r)))
      .children(floor.rooms.filter((r) => r.newRoom).map((r) => this.newRoom(r)))
      .children(items.map((d) => this.item(d)))
      .when(Boolean(active), (el) => el.child(div().absolute().left(px(active.ox)).top(px(active.oy))
        .w(px(active.w)).h(px(active.h)).border(2).border_color(t.accent)))
      .child(div().absolute().left(0).top(0).size_full().rounded(4).border(2).border_color("#1d1f26"));
  }

  render() {
    const t = theme();
    const { floor, placed, info } = this.floorNow();
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
        .child(div().child(`作業中 ${counts.working} · 待ち ${counts.blocked} · 完了 ${counts.done} · 待機 ${counts.idle}`))
        .child(div().id("legend").ml_auto().px(6).rounded(4).text_color(t.dim).hover((s) => s.text_color(t.foreground))
          .tooltip(LEGEND).child("凡例")))
      .child(div().id("scroll").flex_1().min_h(0).overflow_scroll() // 細い列（Office ボタン）では横にも
        .child(div().p(px(MARGIN)).child(this.building(floor, this.items(placed), t))));
  }
}
