// ai-office: スペースを部屋に、エージェントをキャラクターにして、ドット絵のオフィスで見せる。
// 中身の計算は scene.js（herdr を知らない）。ここは herdr のデータを集めて渡し、返ってきた絵を並べる。
// 絵は 4 倍に拡大済みの PNG で、絵の 1 ピクセルを SCALE（2）論理 px で描く（にじまない大きさ）。
import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import * as fs from "fs/promises";
import {
  spaces, agents, terminals, panes, theme, window, run, openOverlay, pickFolder, home, appHome, readTextFile, layout, props, setShared,
  shared, nextCommand,
} from "herdr";
import {
  SCALE, TICK_ACTIVE, TICK_INACTIVE, TICK_RUN, HALL_W, PART_W, LEFT_PASS, Office, roomsOf, layoutFloor, drawables,
  floorDrawables, running, roomAt, dropTarget, useTheme, geometry, seatName, readTheme, addTheme, themeList, pngSize, plateText,
  clockHands, agentModel, parseCodexConfig, parseSkillFile, sortSkills, SKILL_SOURCES,
  PLACES, WEATHER_MS, TRIAL_WEATHER, defaultPlace, offsetAt, offsetLabel, placeAt, placeClock, weatherOf, parseWeather,
  windowView, windowTip, parseSkyCommand,
} from "./scene.js";

const IMG = "mods/ai-office/img";
const px = (v) => v * SCALE;
const MARGIN = 6; // フロアのまわりの余白
const DRAG_START = 4; // 部屋を押したまま、これだけ（絵の px）動かしたらドラッグの始まり（それまではクリック）
const META_MS = 10000; // model と effort を読み直す間隔
const HIDDEN_MS = 1000; // 隠れている間は、この間隔で見えるようになったかだけ見る
const SKILLS_MS = 60000; // 使える skill を読み直す間隔（めったに変わらない）
// 窓の外の天気: 選んだ場所の今の天気（Open-Meteo。キーは要らず、送るのはその場所の緯度経度だけ）
const weatherUrl = (place) => `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}`
  + "&current=weather_code,temperature_2m&timezone=auto";
const WEATHER_CHECK_MS = 60000; // 天気が古くなったかを見る間隔（取り直すのは WEATHER_MS ごと）
const WEATHER_RETRY_MS = 5 * 60000; // 取れなかったとき、次に試すまで
const WEATHER_STALE_MS = 3 * 3600000; // これより古い天気は使わない（晴れ扱い。何時間も閉じていたあと）

/**
 * herdr のデータを集める: スペースごとの部屋と、エージェントごとの状態・model・effort。
 * meta: Claude のセッション ID → { model, effort }（loadMeta が読む）、codexDefaults: ~/.codex/config.toml の既定。
 */
function gather(meta, codexDefaults) {
  const ag = agents();
  const sp = spaces();
  const terms = new Map(terminals().map((t) => [t.address, t]));
  const tabs = new Map(sp.flatMap((s) => (s.tabs ?? []).map((tab) => [tab.id, tab])));
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
      // hc send で話しかけた（フックが送った人に書く: 相手・時刻・文）と、話しかけられた（受け取った人に書く: 送った人・時刻・文）
      talk: t?.labels?.["office.talk"] || null,
      talkAt: t?.labels?.["office.talk_at"] || null,
      talkText: t?.labels?.["office.talk_text"] || null,
      heard: t?.labels?.["office.heard"] || null,
      heardAt: t?.labels?.["office.heard_at"] || null,
      heardText: t?.labels?.["office.heard_text"] || null,
      plan: t?.labels?.["office.plan"] || null, // フックが付ける（プランモードで書いたプランのファイル。セッションの終わりまで）
      docs: (t?.labels?.["office.docs"] || "").split("\n").filter(Boolean), // フックが付ける（書いた .md。新しい順）
      tname: t?.name ?? null, // hc の名前（hc run --name）。hc send の相手はアドレスか、この名前
      tab: a.tab_name,
      // 机の名札: タブバーと同じ名前（名前のないタブは、エージェントの今のタイトル）
      seatName: seatName({ tabName: a.tab_name, named: tabs.get(a.tab)?.named, program: a.program, title: a.title, address: a.address }),
      name: a.program?.name ?? a.app ?? "agent",
      where: `${a.space_name} / ${a.tab_name}`,
    }];
  }));
  const ps = panes();
  // その人が書いたもの（ホワイトボード）: プランと、書いた .md
  const docs = new Map([...info].map(([address, a]) => [address,
    [...(a.plan ? [{ path: a.plan, kind: "plan" }] : []), ...a.docs.map((path) => ({ path, kind: "doc" }))]]));
  return { rooms: roomsOf(sp.map((s) => ({ ...s, folder: placeOf(s, ps) })), ag, docs), info };
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

// テーマ: 同梱の mods/ai-office/themes/<名前>/ と、人が足す ~/.config/herdr-app/ai-office-themes/<名前>/（scripts/sync.sh で
// 消えない所）の theme.json と PNG を読み、確かめて（scene.js の readTheme）、使えるものを登録する。同じ名前なら人のものが勝つ。
// 使えないテーマは飛ばし、返す（[{ name, why }]。「テーマ」のツールチップに出す）。絵の大きさは PNG の頭から読む
async function loadThemes() {
  const skipped = [];
  for (const base of ["mods/ai-office/themes", "ai-office-themes"]) {
    const dir = `${appHome()}/${base}`;
    for (const name of await subdirs(dir)) {
      const text = await readOrNull(`${dir}/${name}/theme.json`);
      if (text === null) continue;
      let json;
      try {
        json = JSON.parse(text);
      } catch (e) {
        skipped.push({ name: `${base}/${name}`, why: `theme.json を読めない（${e?.message ?? e}）` });
        continue;
      }
      const sizes = {};
      for (const file of Object.values(json?.images ?? {})) {
        try {
          const size = pngSize(await fs.readFile(`${dir}/${name}/${file}`));
          if (size) sizes[file] = size;
        } catch {}
      }
      const { theme, problems } = readTheme(name, json, sizes, `${base}/${name}`);
      if (problems.length) skipped.push({ name: `${base}/${name}`, why: problems.join(" / ") });
      else addTheme(theme);
    }
  }
  for (const { name, why } of skipped) console.log(`ai-office: テーマ ${name} を使わない: ${why}`);
  return skipped;
}

// 壁時計と窓の外の場所（壁時計のクリックで選ぶ。shared の ai-office.place に、どのコピーで選んでも）。まだ選んでいなければ、
// Mac の今の時差にいちばん近い場所（日本なら東京）
function currentPlace() {
  return PLACES.find((p) => p.id === shared("ai-office.place")) ?? defaultPlace(-new Date().getTimezoneOffset(), Date.now());
}

// 最後に取ったその場所の天気（どのコピーが取ったものでも。shared は Herdr を閉じても残る）。別の場所の天気や、古すぎれば null。
// 場所を選べるようにする前の天気（place がない）は東京のもの
function liveWeather(now, place) {
  const w = shared("ai-office.weather");
  return w && typeof w.cover === "string" && (w.place ?? "tokyo") === place.id && now - w.fetchedAt < WEATHER_STALE_MS ? w : null;
}

export default class AiOffice extends View {
  init(_props, cx) {
    this.theme = null; // 使っているテーマ（テーマを読み終えるまでは null で、フロアを描かない）
    this.skippedThemes = []; // 使えなかったテーマと理由（「テーマ」のドロップダウンの下に出す）
    cx.spawn(async (cx) => {
      this.skippedThemes = await loadThemes();
      cx.notify();
    });
    this.office = new Office();
    this.drag = null; // 部屋をドラッグしている間: { from: スペースの id, over: dropTarget の答えか null }
    this.overRoom = false; // マウスが部屋の奥の壁の上にあるか（つかめる手のカーソル）
    this.hover = null; // マウスが乗っているもの（キャラ・PC・名札）の持ち主のエージェント。同じ持ち主のものを一緒に光らせる
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
    this.weatherTried = 0;
    this.weatherFor = null; // 最後に天気を取りにいった場所（場所が変わったら、待たずに取る）
    this.placeId = currentPlace().id;
    this.loadWeather(cx);
    cx.timer.every(WEATHER_CHECK_MS, (cx) => this.loadWeather(cx));
    // 窓を試す（herdr-app do ai-office.sky-rain、sky-1930、sky-night、sky-auto）。この窓を開いている間だけ
    this.trial = { weather: null, time: null };
    cx.spawn(async (cx) => {
      for (;;) {
        const change = parseSkyCommand(await nextCommand(), Date.now(), currentPlace());
        if (!change) continue;
        Object.assign(this.trial, change);
        cx.notify();
      }
    });
    this.schedule(cx);
  }

  // 選んだ場所の今の天気を、古くなったら（別の場所の天気なら、すぐ）取り直す。みんなが見る shared に置くので、ほかのコピーも
  // 次に開いたときも使う（描き直しは shared が変わったときに Herdr がする）。隠れている間は取らない。取れなければ前の値のまま
  loadWeather(cx) {
    const now = Date.now();
    const place = currentPlace();
    const last = shared("ai-office.weather");
    const fresh = last && (last.place ?? "tokyo") === place.id && now - last.fetchedAt < WEATHER_MS;
    if (this.hidden() || fresh || (this.weatherFor === place.id && now - this.weatherTried < WEATHER_RETRY_MS)) return;
    this.weatherTried = now;
    this.weatherFor = place.id;
    cx.spawn(async () => {
      try {
        const res = await fetch(weatherUrl(place));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const weather = parseWeather(await res.json(), Date.now());
        if (!weather) throw new Error("応答に今の天気がない");
        setShared("ai-office.weather", { ...weather, place: place.id });
      } catch (e) {
        console.log(`ai-office: ${place.name}の天気を取れなかった: ${e?.message ?? e}`);
      }
    });
  }

  // 窓の外: 選んだ場所の今（試し中は、その場所のその時刻と天気）の空
  view() {
    const now = Date.now();
    const place = currentPlace();
    const ms = this.trial.time === null ? now : placeAt(place, now, this.trial.time);
    const weather = this.trial.weather ? weatherOf(TRIAL_WEATHER[this.trial.weather]) : liveWeather(now, place);
    const trial = this.trial.time !== null || this.trial.weather !== null;
    return { ...windowView(ms, weather, this.office.t, place, geometry().WINDOW), tip: windowTip(ms, weather, trial, place) };
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

  // 今のフロア: 部屋の並び（フロア全体の位置 ox, oy 付き）。キャラもこの並びに合わせる。テーマを読み終えるまでは null。
  // テーマ（shared の ai-office.theme。どのコピーで替えても。ないテーマなら modern、それもなければ最初のテーマ）が
  // 変わったら、寸法と絵を差し替えて、キャラを席から置き直す
  floorNow() {
    const names = themeList().map((x) => x.name);
    if (!names.length) return null;
    const asked = shared("ai-office.theme");
    const want = names.includes(asked) ? asked : names.includes("modern") ? "modern" : names[0];
    if (want !== this.theme) {
      this.theme = useTheme(want);
      this.office = new Office();
      this.sig = "";
    }
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
        this.shown = false;
        this.schedule(cx); // 隠れている間は何もしない（見えたときの経過時間は dt の上限で切る）
        return;
      }
      if (!this.shown) {
        this.shown = true;
        this.loadWeather(cx); // 見えたら、古くなった天気をすぐ取り直す（隠れている間は取らないので）
      }
      const now = Date.now();
      const dt = Math.min(now - this.last, 1000); // スリープ明けに瞬間移動しないよう
      this.last = now;
      const state = this.floorNow();
      if (!state) { // テーマを読み終えるまで
        this.schedule(cx);
        return;
      }
      const { placed } = state;
      this.office.tick(dt);
      // 描く絵（名前と位置）が前のコマと同じなら描き直さない。時計の針・窓の外（雨のコマも）・ツールチップの
      // 東京の時刻（1 分ごと）が変わったときも描き直す
      const place = currentPlace();
      if (place.id !== this.placeId) { // 場所が変わった（どのコピーで選んでも）: その場所の天気をすぐ取りにいく
        this.placeId = place.id;
        this.loadWeather(cx);
      }
      const clock = placeClock(place, now);
      const { h, m } = clockHands(clock.min);
      const docs = placed.map((r) => r.docs.map((d) => d.path).join(",")).join("/"); // 壁のホワイトボード（items にない）
      const sig = `${place.id}|${h}:${m}|${this.view().key}|${clock.text}|${docs}|` + this.items(placed)
        .map((d) => `${d.img ?? d.text}+${d.over}+${d.books?.length ?? ""}@${d.x},${d.y}`).join(";");
      if (sig !== this.sig) {
        this.sig = sig;
        cx.notify();
      }
      this.schedule(cx);
    });
  }

  // 描くものの絵: テーマの絵（src）か、img/ の絵（img）
  src(d) {
    return d.src ?? `${IMG}/${d.img}.png`;
  }

  sprite(d) {
    if (d.over) return this.box(d).child(image(this.src(d)).size_full()).child(this.overlay(d));
    return image(this.src(d)).absolute().left(px(d.x)).top(px(d.y)).w(px(d.w)).h(px(d.h));
  }

  box(d) {
    return div().absolute().left(px(d.x)).top(px(d.y)).w(px(d.w)).h(px(d.h));
  }

  overlay(d) {
    return image(`${IMG}/${d.over}.png`).absolute().left(0).top(0).size_full();
  }

  // ボタンの押下: 窓（mod.open）で開いたときに押した所から窓が動きださないよう止める。
  // フロアには届かないので、取り残された部屋のドラッグ（窓の外で離したなど）もここで捨てる
  hold(cx) {
    this.drag = null;
    cx.stop_propagation();
  }

  // クリックできる絵。持ち主（owner）があれば、その持ち主のどれかにマウスが乗っている間は一緒に明るくする
  button(id, d, onClick, tip) {
    return div().id(id).absolute().left(px(d.x)).top(px(d.y)).w(px(d.w)).h(px(d.h)).cursor_pointer()
      .when(Boolean(d.glow), (el) => el.rounded(6).hover((s) => s.bg("#ffffff59"))) // 絵はほぼ透明なので後ろを明るくする
      .when(Boolean(d.owner), (el) => el.on_hover((hovered, cx) => this.hoverOn(d.owner, hovered, cx)))
      .when(Boolean(d.owner) && d.owner === this.hover, (el) => el.rounded(6).bg("#ffffff73"))
      .on_mouse_down("left", (_e, cx) => this.hold(cx))
      .on_click((_e, cx) => onClick(cx))
      .when(Boolean(d.right), (el) => el.on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        this.act(d.right);
      }))
      .when(Boolean(tip), (el) => el.tooltip(tip))
      .child(image(this.src(d)).size_full())
      .when(Boolean(d.over), (el) => el.child(this.overlay(d)))
      .when(Boolean(d.books), (el) => el.children(d.books.map((b) => this.book(b))));
  }

  // scene.js の click: { type: "focus", terminal } / { type: "hire", space, machine } / { type: "skills" }。
  // 壁のホワイトボード: { type: "docs", room, docs: [{ path, kind, who }] }。机の PC: { type: "tab-menu", terminal, focus? }
  act(click) {
    if (click.type === "focus") run("agent.focus", { terminal: click.terminal });
    if (click.type === "tab-menu") this.tabMenu(click);
    if (click.type === "skills") {
      const skills = this.shelfSkills();
      const groups = Object.entries(SKILL_SOURCES)
        .map(([source, { label, color }]) => ({ label, color, skills: skills.filter((x) => x.source === source) }))
        .filter((g) => g.skills.length);
      openOverlay({ mod: "ai-office-skills", kind: "popup", width: 400, height: 520,
        props: { title: "資料室", count: skills.length, groups } });
    }
    if (click.type === "ask") {
      // 選択肢の説明や答えの確認が長いこともあるので、プランと同じ広さのダイアログにして中をスクロールさせる
      openOverlay({ mod: "ai-office-ask", kind: "dialog", width: 0.65, height: 0.8, props: { terminal: click.terminal, name: click.name } });
    }
    if (click.type === "docs") {
      // プランは長い行（コードや表）が多いので、skill の中身より広く、窓の幅に合わせる
      openOverlay({ mod: "ai-office-docs", kind: "dialog", width: 0.65, height: 0.8, props: { room: click.room, docs: click.docs } });
    }
    if (click.type === "hire") {
      openOverlay({ mod: "ai-office-hire", kind: "popup", width: 240, height: 320, props: { space: click.space, machine: click.machine } });
    }
  }

  // 机の PC: そのエージェントのタブのメニュー（ai-office-tab: 名前を変える・閉じる。New tab は出さない）。名札と同じく、
  // 左クリックはその人を表示してから（focus）、右クリックはメニューだけ。閉じる前に確かめるかは Herdr の tab.close に任せる
  tabMenu({ terminal, focus }) {
    const a = agents().find((x) => x.address === terminal);
    if (!a) return;
    if (focus) run("agent.focus", { terminal });
    openOverlay({ mod: "ai-office-tab", kind: "popup", width: 200, height: 90, props: { tab: a.tab } });
  }

  // キャラ・PC・名札にマウスが乗った・離れた: 持ち主を覚えて描き直す（同じ持ち主のものを一緒に光らせる）
  hoverOn(owner, hovered, cx) {
    if (hovered) this.hover = owner;
    else if (this.hover === owner) this.hover = null;
    else return;
    cx.notify();
  }

  // 机の前の板の名札（タブバーと同じ名前。入らなければ「…」で切る）。持ち主にマウスが乗っている間は黄色
  nameplate(d) {
    const lit = d.owner === this.hover;
    return div().id(d.id).absolute().left(px(d.x)).top(px(d.y)).w(px(d.w)).h(px(d.h)).px(3).flex().items_center()
      .rounded(3).border(1).border_color("#5b3a2c").bg(lit ? "#ffe08a" : "#fffaf0").cursor_pointer()
      .on_mouse_down("left", (_e, cx) => this.hold(cx))
      .on_click(() => this.act(d.click))
      .on_hover((hovered, cx) => this.hoverOn(d.owner, hovered, cx))
      .tooltip(d.tip)
      .child(div().w_full().text_size(9).line_height("10px").text_color("#3b2a2a").whitespace_nowrap().text_ellipsis()
        .overflow_hidden().child(d.plate));
  }

  // マウスが乗っている人の頭の上の、名前の札（歩いている途中でも、どの席の人か分かるように。全部の名前を出す）
  hoverMarks(items) {
    const c = items.find((d) => d.char && d.owner === this.hover);
    const name = this.hover && this.office.chars.get(this.hover)?.info?.seatName;
    if (!c || !name) return [];
    return [h_flex().absolute().left(px(c.x + 9 - 90)).top(px(c.y - 11)).w(px(180)).h(px(9)).justify_center()
      .child(h_flex().max_w_full().h_full().px(4).items_center().rounded(3).border(1).border_color("#3b2a2a").bg("#ffe08a")
        .child(div().min_w(0).text_size(10).text_color("#3b2a2a").whitespace_nowrap().text_ellipsis().overflow_hidden()
          .child(name)))];
  }

  item(d) {
    if (d.text !== undefined) return this.tag(d);
    if (d.plate !== undefined) return this.nameplate(d);
    if (d.tile) return this.tiled(d);
    return d.click ? this.button(d.id, d, () => this.act(d.click), d.tip) : this.sprite(d);
  }

  // 幅 tile の絵を、w の幅まで横に並べる（はみ出した分は切る。modern のガラスの壁）
  tiled(d) {
    const tiles = [];
    for (let dx = 0; dx < d.w; dx += d.tile) tiles.push(image(this.src(d)).absolute().left(px(dx)).top(0).w(px(d.tile)).h(px(d.h)));
    return this.box(d).overflow_hidden().children(tiles);
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

  // 壁時計（選んだ場所の今の時刻。文字盤に時針と分針を重ねる）。クリックで場所（タイムゾーン）のドロップダウン。
  // 奥の壁は部屋のドラッグのつかみ所なので、押したときは止める（hold。ドラッグにしない）
  clock(room, x, y) {
    const place = currentPlace();
    const { min, text } = placeClock(place, Date.now());
    const { h, m } = clockHands(min);
    return div().id(`clock-${room.id}`).absolute().left(px(x)).top(px(y)).w(px(13)).h(px(13)).rounded_full().cursor_pointer()
      .hover((st) => st.bg("#ffffff59"))
      .on_mouse_down("left", (_e, cx) => this.hold(cx))
      .on_click(() => this.placeMenu())
      .tooltip(`${place.name} ${text}（${offsetLabel(offsetAt(place, Date.now()))}）: クリックで場所（タイムゾーン）を選ぶ`)
      .children(["clock-face", `clock-m-${m}`, `clock-h-${h}`].map((img) => image(`${IMG}/${img}.png`).absolute().left(0).top(0).size_full()));
  }

  // 壁時計のクリック: 場所のドロップダウン（ai-office-pick）。選ぶと、壁時計の時刻・窓の空・天気がその場所になる
  placeMenu() {
    const now = Date.now();
    const items = PLACES.map((p) => {
      const offset = offsetAt(p, now);
      const summer = p.dst && offset !== p.std ? "（夏時間）" : "";
      return { name: p.id, label: p.name, description: `${offsetLabel(offset)}${summer} · 今 ${placeClock(p, now).text}` };
    });
    openOverlay({ mod: "ai-office-pick", kind: "popup", width: 300, height: 420,
      props: { key: "ai-office.place", items, current: currentPlace().id, height: 420 } });
  }

  // 壁の名札（スペースの名前。長ければ真ん中を「…」にして、だいたい herdr-ai-office ほどの長さまで）。左の仕切りの右から、
  // 窓（書いたものがあればホワイトボード）の手前まで（それより長くなるときは、さらに終わりを「…」で切る）。
  // 左クリックでそのスペースを選び、herdr のスペースのメニュー（名前を変える・閉じる、git ならワークツリー）を出す。
  // 右クリックはメニューだけ。閉じるときは herdr が確かめる（部屋のエージェントも終わる）。
  // 名札の並ぶ壁と同じく、ほかの部屋へドラッグすると部屋の順番が変わる（名札の上で離せばクリック）
  plate(room) {
    const full = room.machine ? `${room.machine}: ${room.name}` : room.name;
    const text = plateText(full); // 長い名前は真ん中を「…」に（全部はツールチップ）
    const right = room.docs.length ? room.w - 116 : room.w - 76;
    const menu = () => openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: room.id } } });
    return div().id(`plate-${room.id}`).absolute().left(px(room.ox + 10)).top(px(room.oy + 5)).h(px(12)).max_w(px(right - 14))
      .cursor_pointer().on_mouse_down("left", (_e, cx) => {
        this.drag = { from: room.id, over: null, start: null, moved: false };
        cx.stop_propagation();
      })
      .on_click(() => {
        run("space.select", { id: room.id });
        menu();
      })
      .on_mouse_down("right", () => menu())
      .tooltip(`${full}\nクリック: このスペースを選んで、メニュー（名前を変える・閉じる）。ドラッグ: 部屋の順番を変える`)
      .px(8).flex().items_center().rounded(3).border(2).border_color("#5b3a2c").bg(room.active ? "#c58a55" : "#a8774c")
      .text_size(12).font_semibold().text_color("#fff4dc").whitespace_nowrap().text_ellipsis().overflow_hidden()
      .child(text);
  }

  // 奥の壁（テーマの images.wall を横に並べ、幅で切る）
  wall(x, y, w) {
    const { WALL_H, IMAGES } = geometry();
    const img = IMAGES.wall;
    const tiles = [];
    for (let dx = 0; dx < w; dx += img.w) tiles.push(image(img.src).absolute().left(px(dx)).top(0).w(px(img.w)).h(px(img.h)));
    return div().absolute().left(px(x)).top(px(y)).w(px(w)).h(px(WALL_H)).overflow_hidden().children(tiles);
  }

  // 部屋の左の仕切り（奥から PART_END まで。上から見た壁の天端と、手前の端の面）。ガラスの部屋では隣の部屋との間の壁。
  // 色はテーマの colors
  partition(x, y) {
    const { PART_END, COLORS: c } = geometry();
    return div().absolute().left(px(x)).top(px(y)).w(px(PART_W)).h(px(PART_END)).bg(c.partition)
      .child(div().absolute().left(0).top(0).w(px(1)).h_full().bg(c.partitionEdge))
      .child(div().absolute().right(0).top(0).w(px(1)).h_full().bg(c.partitionEdge))
      .child(div().absolute().left(0).bottom(0).w_full().h(px(6)).bg(c.partitionFace))
      .child(div().absolute().left(0).bottom(0).w_full().h(px(1)).bg(c.partitionBase));
  }

  // 列のいちばん左の部屋の、左の縦の廊下に面したガラスの壁（テーマの room.hallSide が glass。上から見た天端: 濃い枠に
  // 挟まれた水色と、光の点）。奥の壁の端は柱
  sideGlass(x, y) {
    const { WALL_H, PART_END, COLORS: c } = geometry();
    const h = PART_END - WALL_H;
    const glints = [];
    for (let gy = 4; gy < h - 3; gy += 12) glints.push(div().absolute().left(px(1)).top(px(gy)).w(px(1)).h(px(3)).bg("#ffffff"));
    return [
      div().absolute().left(px(x)).top(px(y)).w(px(PART_W)).h(px(WALL_H)).bg(c.partitionEdge),
      div().absolute().left(px(x)).top(px(y + WALL_H)).w(px(PART_W)).h(px(h)).bg(c.sideGlass)
        .child(div().absolute().left(0).top(0).w(px(1)).h_full().bg(c.sideGlassEdge))
        .child(div().absolute().right(0).top(0).w(px(1)).h_full().bg(c.sideGlassEdge))
        .children(glints),
    ];
  }

  // ガラスの部屋の手前のガラスの壁と扉（空き部屋の。人のいる部屋は scene.js の drawables が人と前後させて描く）
  frontGlass(lot) {
    const { GLASS, IMAGES } = geometry();
    const door = LEFT_PASS - 10;
    return [
      this.tiled({ src: IMAGES.glass.src, tile: IMAGES.glass.w, x: lot.ox + door + 18, y: lot.oy + GLASS.y, w: lot.w - door - 18, h: GLASS.h }),
      this.sprite({ src: IMAGES.door.src, x: lot.ox + door, y: lot.oy + GLASS.y - 2, w: IMAGES.door.w, h: IMAGES.door.h }),
    ];
  }

  // 窓: 外の空（選んだ場所の時刻と天気。scene.js の windowView）を奥から重ね、最後に窓枠（ガラスは透明）。
  // ホバーでその場所の時刻と天気
  sky(x, y, view, id) {
    return div().id(id).absolute().left(px(x)).top(px(y)).w(px(28)).h(px(16)).tooltip(view.tip)
      .children(view.layers.map((img) => image(`${IMG}/${img}.png`).absolute().left(0).top(0).size_full()));
  }

  // 壁のホワイトボード（この部屋の人のプランと書いた .md）。窓の左に掛け、クリックで中身（ai-office-docs）。
  // どれもなければ掛けない
  board(room) {
    const docs = room.docs.map((d) => {
      const a = this.office.chars.get(d.address)?.info ?? {};
      return { path: d.path, kind: d.kind, who: [a.name, a.tab].filter(Boolean).join(" · ") || d.address };
    });
    const plans = docs.filter((d) => d.kind === "plan").length;
    const count = [plans ? `プラン ${plans}` : "", docs.length > plans ? `.md ${docs.length - plans}` : ""].filter(Boolean).join("・");
    const d = { img: "whiteboard-plan", x: room.ox + room.w - 112, y: room.oy + 7 + geometry().DECOR_DY, w: 30, h: 18, glow: true };
    return this.button(`board-${room.id}`, d, () => this.act({ type: "docs", room: room.name, docs }), `ホワイトボード: ${count}（クリックで読む）`);
  }

  // 部屋の後ろのもの: 奥の壁、左の仕切り（modern: 隣とは壁、縦の廊下に面していればガラス）、壁の飾り（ホワイトボード・
  // 窓・時計）と名札
  roomBack(room, view) {
    const { ox, oy, w } = room;
    const { HALL_SIDE, DECOR_DY: dy } = geometry();
    return [
      this.wall(ox, oy, w),
      ...(HALL_SIDE === "glass" && ox === HALL_W ? this.sideGlass(ox, oy) : [this.partition(ox, oy)]),
      ...(room.newRoom ? [] : [
        ...(room.docs.length ? [this.board(room)] : []),
        this.sky(ox + w - 72, oy + 6 + dy, view, `window-${room.id}`),
        this.clock(room, ox + w - 33, oy + 8 + dy),
        this.plate(room),
      ]),
    ];
  }

  // 空き部屋: クリックでフォルダを選んで、そこにスペース（部屋）を作る（pickFolder はこの Mac だけ）。
  // 暗くするのは部屋の中（奥の壁の下から、classic は列の下まで、modern はガラスの壁まで）
  newRoom(lot) {
    const { WALL_H, GLASS } = geometry();
    const h = (GLASS ? GLASS.y : lot.h) - WALL_H;
    const doorY = GLASS ? 8 : 22;
    return [
      div().id("new-room").absolute().left(px(lot.ox + PART_W)).top(px(lot.oy + WALL_H)).w(px(lot.w - PART_W)).h(px(h))
        .bg("#00000038").cursor_pointer().hover((s) => s.bg("#00000020"))
        .on_mouse_down("left", (_e, cx) => this.hold(cx))
        .on_click((_e, cx) => cx.spawn(async () => {
          const folder = await pickFolder({ prompt: "この部屋にする" });
          if (folder) run("space.new", { folder });
        }))
        .tooltip("空き部屋: クリックで新しい部屋（スペース）を作る")
        .child(this.sprite({ img: "door", x: (lot.w - PART_W - 16) / 2, y: doorY, w: 16, h: 20 }))
        .child(div().absolute().left(0).top(px(doorY + 26)).w_full().flex().justify_center()
          .text_size(11).text_color("#fff4dcdd").child("+ 部屋")),
      ...(GLASS ? this.frontGlass(lot) : []),
    ];
  }

  // 右上の「テーマ」: テーマのドロップダウン（ai-office-pick。使っているテーマにチェック、使えなかったテーマと理由も）
  themeMenu(themes) {
    // 高さは、説明が 2 行に折り返しても入るように見込む（多ければ中をスクロール）
    const height = Math.min(420, 12 + themes.length * 62 + (this.skippedThemes.length ? 10 + this.skippedThemes.length * 52 : 0));
    openOverlay({ mod: "ai-office-pick", kind: "popup", width: 320, height, props: {
      key: "ai-office.theme",
      items: themes.map(({ name, label, description }) => ({ name, label, description })),
      current: this.theme,
      notes: this.skippedThemes.map((x) => ({ title: `使えない: ${x.name}`, text: x.why })),
      height,
    } });
  }

  // ---- 部屋をドラッグして順番を変える（herdr のスペースの順番。左のスペースの一覧と同じ space.move） ----
  // 座標はフロアの左上からの論理 px（e.local_position）。部屋の中のボタンを押したときはフロアに届かない

  // フロアの点（論理 px）→ 絵の座標
  floorPoint(p) {
    return { x: p.x / SCALE, y: p.y / SCALE };
  }

  // 部屋の奥の壁（名札の並ぶ帯）の上の点なら、その部屋（つかめるのは壁だけ。床までつかめると、どこを押しても
  // ドラッグに見える）
  wallAt(floor, p) {
    const room = roomAt(floor.rooms, p);
    return room && p.y - room.oy < geometry().WALL_H ? room : null;
  }

  // 押した所が部屋の奥の壁なら、その部屋を持つ。窓（mod.open）で開いたときに窓ごと動かないよう、部屋の上の押下は
  // 床でも止める（窓を動かすのは、上の帯と廊下）。start は押した所（名札から始めたときは、最初に動いた所）
  grab(e, floor, cx) {
    const p = e.local_position ? this.floorPoint(e.local_position) : null;
    const wall = p ? this.wallAt(floor, p) : null;
    this.drag = wall ? { from: wall.id, over: null, start: p, moved: false } : null;
    if (p && roomAt(floor.rooms, p)) cx.stop_propagation();
  }

  // フロアの上でマウスが動いた: 部屋の奥の壁の上なら、つかめる手のカーソル。持っている間は、押した所から少し（DRAG_START）
  // 動いたらドラッグの始まり（上の帯に、どうなるかを出す。押しただけのクリックでは出さない）で、落とす先を探す。
  // 変わったときだけ描き直す
  pointer(e, floor, cx) {
    if (!e.local_position) return;
    const p = this.floorPoint(e.local_position);
    const overRoom = Boolean(this.wallAt(floor, p));
    let changed = overRoom !== this.overRoom;
    this.overRoom = overRoom;
    const drag = this.drag;
    if (drag) {
      if (!drag.start) drag.start = p;
      if (!drag.moved && Math.abs(p.x - drag.start.x) + Math.abs(p.y - drag.start.y) >= DRAG_START) {
        drag.moved = true;
        changed = true;
      }
      const over = drag.moved ? dropTarget(floor.rooms, drag.from, p) : null;
      if (over?.id !== drag.over?.id || over?.side !== drag.over?.side) {
        drag.over = over;
        changed = true;
      }
    }
    if (changed) cx.notify();
  }

  // ドラッグ中に上の帯に出す文: どの部屋を持っていて、離すとどうなるか（ドラッグが始まる前は null）
  dragText(floor) {
    if (!this.drag?.moved) return null;
    const name = (id) => floor.rooms.find((r) => r.id === id)?.name ?? "";
    const { from, over } = this.drag;
    if (!over) return `「${name(from)}」をつかんでいます。ほかの部屋の上で離すと、順番が変わります`;
    return `「${name(from)}」を「${name(over.id)}」の${over.side === "right" ? "後ろ" : "前"}へ（離すと動かす）`;
  }

  // 離した: ほかの部屋の上なら、その部屋の位置へ動かす（位置は今の spaces() で数える）
  drop(cx) {
    const { from, over, moved } = this.drag ?? {};
    this.drag = null;
    if (moved) cx.notify(); // 上の帯の文と印を消す
    if (!over) return;
    const index = spaces().findIndex((s) => s.id === over.id);
    if (index !== -1) run("space.move", { id: from, index: index + 1 });
  }

  // フロアの外へ出た: 落とす先とカーソルを戻す（そこで離しても動かさない。戻れば続きから）
  leave(cx) {
    const changed = this.overRoom || Boolean(this.drag?.over);
    this.overRoom = false;
    if (this.drag) this.drag.over = null;
    if (changed) cx.notify();
  }

  // ドラッグ中の印: ドラッグが始まったらすぐ、持っている部屋を濃い灰色に。落とす先の部屋の上に来たら、そこを薄い灰色に
  // （濃さで見分ける）して、入る側に縦の線
  dragMarks(floor, t) {
    if (!this.drag?.moved) return [];
    const { BOX_H } = geometry(); // 部屋の枠（modern は横の廊下を含めない）
    const shade = (room, color) => div().absolute().left(px(room.ox)).top(px(room.oy)).w(px(room.w)).h(px(BOX_H)).bg(color);
    const over = this.drag.over;
    const source = floor.rooms.find((r) => r.id === this.drag.from);
    const target = over && floor.rooms.find((r) => r.id === over.id);
    return [
      ...(source ? [shade(source, "#00000066")] : []),
      ...(target ? [
        shade(target, "#00000029"),
        div().absolute().left(px(over.side === "right" ? target.ox + target.w - 2 : target.ox)).top(px(target.oy))
          .w(px(2)).h(px(BOX_H)).bg(t.accent),
      ] : []),
    ];
  }

  // 1 枚のフロア: 部屋の床と廊下の床（modern は列ごとの横の廊下も）、資料室の奥の壁、各部屋の後ろのもの、描くもの、
  // 選んでいる部屋の枠、ドラッグ中の印、外枠
  building(floor, items, t, view) {
    const { ROOM_H, BOX_H, IMAGES } = geometry();
    const { floor: wood, hall, corridor } = IMAGES;
    const floorTiles = [];
    for (let y = 0; y < floor.h; y += wood.h) {
      for (let x = HALL_W; x < floor.w; x += wood.w) {
        floorTiles.push(image(wood.src).absolute().left(px(x)).top(px(y)).w(px(wood.w)).h(px(wood.h)));
      }
    }
    if (corridor) { // 列ごとの横の廊下（部屋の枠の下）
      for (let oy = 0; oy < floor.h; oy += ROOM_H) {
        for (let x = HALL_W; x < floor.w; x += corridor.w) {
          floorTiles.push(image(corridor.src).absolute().left(px(x)).top(px(oy + BOX_H)).w(px(corridor.w)).h(px(corridor.h)));
        }
      }
    }
    const hallTiles = [];
    for (let y = 0; y < floor.h; y += hall.h) {
      hallTiles.push(image(hall.src).absolute().left(0).top(px(y)).w(px(hall.w)).h(px(hall.h)));
    }
    const active = floor.rooms.find((r) => r.active);
    return div().id("floor").relative().w(px(floor.w)).h(px(floor.h)).overflow_hidden().rounded(4)
      .when(Boolean(this.drag?.moved), (el) => el.cursor_grabbing())
      .when(!this.drag?.moved && this.overRoom, (el) => el.cursor_grab())
      .on_mouse_down("left", (e, cx) => this.grab(e, floor, cx))
      .on_mouse_move((e, cx) => this.pointer(e, floor, cx))
      .on_mouse_up("left", (_e, cx) => this.drop(cx))
      .on_hover((hovered, cx) => { if (!hovered) this.leave(cx); })
      .children(floorTiles)
      .child(div().absolute().left(0).top(0).w(px(HALL_W)).h(px(floor.h)).overflow_hidden().children(hallTiles))
      .child(this.wall(0, 0, HALL_W))
      .children(floor.rooms.flatMap((r) => this.roomBack(r, view)))
      .children(floor.rooms.filter((r) => r.newRoom).flatMap((r) => this.newRoom(r)))
      .children(items.map((d) => this.item(d)))
      .children(this.hoverMarks(items))
      .when(Boolean(active), (el) => el.child(div().absolute().left(px(active.ox)).top(px(active.oy))
        .w(px(active.w)).h(px(BOX_H)).border(2).border_color(t.accent)))
      .children(this.dragMarks(floor, t))
      .child(div().absolute().left(0).top(0).size_full().rounded(4).border(2).border_color("#1d1f26"));
  }

  render() {
    const t = theme();
    const now = this.floorNow();
    if (!now) return v_flex().id("root").size_full().bg(t.canvas).p(14).text_size(12).text_color(t.dim).child("テーマを読んでいます…");
    const { floor, placed, info } = now;
    const themes = themeList();
    const current = themes.find((x) => x.name === this.theme);
    const counts = { working: 0, blocked: 0, done: 0, idle: 0 };
    for (const a of info.values()) counts[a.status] = (counts[a.status] ?? 0) + 1;
    const dragging = this.dragText(floor);
    return v_flex().id("root").size_full().bg(t.canvas).text_color(t.foreground)
      .on_mouse_up("left", (_e, cx) => { // フロアの外（上の帯など）で離した: 部屋のドラッグをやめる
        if (this.drag?.moved) cx.notify();
        this.leave(cx);
        this.drag = null;
      })
      .on_size_change((size, cx) => {
        if (Math.abs(size.width - this.width) >= 1) {
          this.width = size.width;
          cx.notify();
        }
      })
      .child(h_flex().h(32).flex_none().px(14).gap(14).items_center().text_size(12).text_color(t.muted)
        .child(div().font_semibold().text_color(t.foreground).child("AI Office"))
        .child(dragging
          ? div().min_w(0).truncate().font_semibold().text_color(t.accent).child(dragging) // 部屋をドラッグ中: どうなるか
          : div().child(`作業中 ${counts.working} · 待ち ${counts.blocked} · 完了 ${counts.done} · 待機 ${counts.idle}`))
        .child(h_flex().id("theme").ml_auto().px(6).gap(4).items_center().rounded(4).cursor_pointer().text_color(t.dim)
          .hover((s) => s.text_color(t.foreground))
          .tooltip([current?.description ?? "", "クリックでテーマを選ぶ"].filter(Boolean).join("\n"))
          .on_click(() => this.themeMenu(themes))
          .child(`テーマ: ${current?.label ?? this.theme}`)
          .child(svg("mods/workspace-chrome/chevron-down.svg").size(10)))
        .child(div().id("legend").px(6).rounded(4).cursor_pointer().text_color(t.dim).hover((s) => s.text_color(t.foreground))
          .tooltip("クリックで凡例（キャラの見分け方: AI と model、effort の鉢巻き）")
          .on_click(() => openOverlay({ mod: "ai-office-legend", kind: "popup", width: 300, height: 420 }))
          .child("凡例")))
      .child(div().id("scroll").flex_1().min_h(0).overflow_scroll() // 細い列（Office ボタン）では横にも
        .child(div().p(px(MARGIN)).child(this.building(floor, this.items(placed), t, this.view()))));
  }
}
