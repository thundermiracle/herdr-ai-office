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
  SCALE, WALL_H, TICK_ACTIVE, TICK_INACTIVE, Office, roomsOf, layoutRooms, drawables, clockHands,
  agentModel, parseCodexConfig, parseSkillFile, sortSkills, SKILL_SOURCES,
} from "./scene.js";

const IMG = "mods/ai-office/img";
const px = (v) => v * SCALE;
const FLOOR_W = 512; // floor.png / wall.png の幅（art px）
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
    out.push({ id: prefix + meta.name, name: meta.name, source, description: meta.description });
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
        list.push({ id: `anthropic-skills:${s.name}`, name: s.name, source: "synced", description: s.description ?? "" });
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
          list.push({ id: `${plugin}:${name}`, name, source: "plugin", description: meta.description });
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

  // 部屋の本棚の skill（別のマシンのスペースは、そのマシンの skill を読んでいないので空）
  skillsFor(room) {
    if (room.machine) return [];
    return sortSkills([...this.skills.global, ...(this.skills.byFolder.get(room.folder) ?? [])]);
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
    cx.timer.after(hidden ? HIDDEN_MS : window()?.active ? TICK_ACTIVE : TICK_INACTIVE, (cx) => {
      if (this.hidden()) {
        this.schedule(cx); // 隠れている間は何もしない（見えたときの経過時間は dt の上限で切る）
        return;
      }
      const now = Date.now();
      const dt = Math.min(now - this.last, 1000); // スリープ明けに瞬間移動しないよう
      this.last = now;
      const { rooms, info } = gather(this.meta, this.codexDefaults);
      this.office.sync(rooms, info);
      this.office.tick(dt);
      // 描く絵（名前と位置）が前のコマと同じなら描き直さない
      const { h, m } = clockHands(new Date()); // 時計の針が動いたときも描き直す
      const sig = `${h}:${m}|` + rooms.map((r) => drawables(r, this.office, this.skillsFor(r))
        .map((d) => `${d.img ?? d.text}+${d.over}+${d.books?.length ?? ""}@${d.x},${d.y}`).join(";")).join("|");
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

  // scene.js の click: { type: "focus", terminal } / { type: "hire", space, machine } / { type: "skills", room }
  act(click) {
    if (click.type === "focus") run("agent.focus", { terminal: click.terminal });
    if (click.type === "skills") {
      const room = spaces().find((s) => s.id === click.room);
      const skills = room ? this.skillsFor({ machine: room.machine, folder: placeOf(room, panes()) }) : [];
      const groups = Object.entries(SKILL_SOURCES)
        .map(([source, { label, color }]) => ({ label, color, skills: skills.filter((x) => x.source === source) }))
        .filter((g) => g.skills.length);
      openOverlay({ mod: "ai-office-skills", kind: "popup", width: 400, height: 520,
        props: { title: room?.name ?? "", count: skills.length, remote: Boolean(room?.machine), groups } });
    }
    if (click.type === "hire") {
      openOverlay({ mod: "ai-office-hire", kind: "popup", width: 240, height: 320, props: { space: click.space, machine: click.machine } });
    }
  }

  item(room, d) {
    if (d.text !== undefined) return this.tag(d);
    return d.click ? this.button(`${room.id}-${d.id}`, d, () => this.act(d.click), d.tip) : this.sprite(d);
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
      .children(this.clock(room.w - 33, 8))
      .child(this.plate(room))
      .children(drawables(room, this.office, this.skillsFor(room)).map((d) => this.item(room, d)));
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
    const { rooms, info } = gather(this.meta, this.codexDefaults);
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
        .child(div().child(`作業中 ${counts.working} · 待ち ${counts.blocked} · 完了 ${counts.done} · 待機 ${counts.idle}`))
        .child(div().id("legend").ml_auto().px(6).rounded(4).text_color(t.dim).hover((s) => s.text_color(t.foreground))
          .tooltip(LEGEND).child("凡例")))
      .child(div().id("scroll").flex_1().min_h(0).overflow_scroll() // 細い列（Office ボタン）では横にも
        .child(div().relative().w(px(office.w)).h(px(office.h))
          .children(office.rooms.map((r) => (r.newRoom ? this.newRoom(r) : this.room(r, t))))));
  }
}
