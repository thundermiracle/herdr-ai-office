// ai-office: スペースを部屋に、エージェントをキャラクターにして、ドット絵のオフィスで見せる。
// 中身の計算は scene.js（herdr を知らない）。ここは herdr のデータを集めて渡し、返ってきた絵を並べる。
// 絵は 4 倍に拡大済みの PNG で、絵の 1 ピクセルを SCALE（2）論理 px で描く（にじまない大きさ）。窓が広いときは 3・4 論理 px
// （1.5 倍・2 倍。scene.js の fitFloor が決める）で描き、絵はその倍率用の 6 倍・8 倍の PNG（名前に @6x・@8x）を使う。
import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import * as fs from "fs/promises";
import {
  spaces, agents, terminals, panes, theme, window, run, openOverlay, pickFolder, home, appHome, readTextFile, layout, props, setShared,
  shared, nextCommand, knownAgents, keys, exec,
} from "herdr";
import {
  SCALE, TICK_ACTIVE, TICK_INACTIVE, TICK_RUN, HALL_W, PART_W, LEFT_PASS, Office, roomsOf, fitFloor, drawables,
  floorDrawables, running, doorsMoving, roomAt, dropTarget, useTheme, geometry, seatName, readTheme, addTheme, themeList, pngSize, plateText,
  openAgents, withSilent, shownStatus, closeKeyOf, reopenKeyOf, overlayOpen,
  clockHands, agentModel, parseCodexConfig, parseSkillFile, sortSkills, SKILL_SOURCES,
  PLACES, WEATHER_MS, TRIAL_WEATHER, defaultPlace, offsetAt, offsetLabel, placeAt, placeClock, weatherOf, parseWeather,
  windowView, windowTip, parseSkyCommand, LANGS, useLang, tr, placeName, inLang, langOf, languageOf,
} from "./scene.js";

const IMG = "mods/ai-office/img";
// 今の倍率（絵の 1 ピクセルの論理 px）。描く前に floorNow が窓に合わせて決める
let scale = SCALE;
const px = (v) => v * scale;
// フロアの中の文字・余白・角の丸み（SCALE で描くときの論理 px）を、今の倍率に合わせる
const ui = (v) => (v * scale) / SCALE;
// 大きく描くときの絵: その倍率でぼやけない PNG（同じ名前に @6x・@8x）。ないもの（人が足したテーマなど）は 4 倍の PNG を
// 伸ばす（少しぼやける）。あるファイルは起動したときに読む（loadHires）
const HIRES = { 3: "@6x", 4: "@8x" };
const hires = new Set();
const pic = (path) => {
  const big = HIRES[scale] ? path.replace(/\.png$/, `${HIRES[scale]}.png`) : path;
  return hires.has(big) ? big : path;
};
const MARGIN = 6; // フロアのまわりの余白
const DRAG_START = 4; // 部屋を押したまま、これだけ（絵の px）動かしたらドラッグの始まり（それまではクリック）
const META_MS = 10000; // model と effort を読み直す間隔
const HIDDEN_MS = 1000; // 隠れている間は、この間隔で見えるようになったかだけ見る
const SKILLS_MS = 60000; // 使える skill を読み直す間隔（めったに変わらない）
const DOCS_CHECK_MS = 3000; // ホワイトボードに載せる .md が今読めるかを調べ直す間隔
// 右下の通知のスイッチ（上の帯の「通知」）: shared に置き、"off" なら ai-office-toast が通知を出さない（ない・"on" なら出す）。
// 効くのは、レイアウトのいちばん外側の "toast" が ai-office-toast のレイアウト（ai-office など）だけ
const TOASTS = "ai-office.toasts";
const TOAST_MOD = "ai-office-toast";
// 窓の外の天気: 選んだ場所の今の天気（Open-Meteo。キーは要らず、送るのはその場所の緯度経度だけ）
const weatherUrl = (place) => `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}`
  + "&current=weather_code,temperature_2m&timezone=auto";
const WEATHER_CHECK_MS = 60000; // 天気が古くなったかを見る間隔（取り直すのは WEATHER_MS ごと）
const WEATHER_RETRY_MS = 5 * 60000; // 取れなかったとき、次に試すまで
const WEATHER_STALE_MS = 3 * 3600000; // これより古い天気は使わない（晴れ扱い。何時間も閉じていたあと）
// 画面の言語（text.js の表）: 上の帯の言語のボタンで選んだもの（shared。"auto" か、ないなら OS に合わせる）と、起動したときに
// 調べる OS の言語（shared。ほかの ai-office の mod も、この 2 つで同じ言語を選ぶ）
const LANG = "ai-office.lang";
const OS_LANG = "ai-office.os-lang";
// OS の言語を調べる: macOS は「言語と地域」のいちばん上（defaults）、ほかは LC_ALL・LC_MESSAGES・LANG
const OS_LANG_SCRIPT = 'defaults read -g AppleLanguages 2>/dev/null || printf "%s" "${LC_ALL:-${LC_MESSAGES:-$LANG}}"';

/**
 * herdr のデータを集める: スペースごとの部屋と、エージェントごとの状態・model・effort。
 * meta: Claude のセッション ID → { model, effort }（loadMeta が読む）、codexDefaults: ~/.codex/config.toml の既定、
 * present: ホワイトボードに載せる .md のうち今読めるもの（checkDocs が調べる。読めないものは載せない）、
 * agentKeys: エージェントのプログラムの key（loadAgentKeys が読む。まだ状態を報告していない人を見分ける）。
 */
function gather(meta, codexDefaults, present, agentKeys) {
  const seen = shared(SEEN) ?? {}; // 見た完了（アドレス → ターン。markSeen が書く）
  const sp = spaces();
  const ps = panes();
  // 報告している人と、まだ状態を報告していない人（雇った直後や、起動の前の確認で止まっている人。withSilent）
  const ag = withSilent(agents(), ps, sp, agentKeys);
  const terms = new Map(terminals().map((t) => [t.address, t]));
  const tabs = new Map(sp.flatMap((s) => (s.tabs ?? []).map((tab) => [tab.id, tab])));
  const info = new Map(ag.map((a) => {
    const t = terms.get(a.address);
    const app = a.app ?? a.program?.key;
    const sid = t?.labels?.["resume.id"]; // agent-resume が付ける Claude のセッション ID
    const { model, effort } = agentModel({ app, argv: t?.foreground?.argv, cached: sid ? meta.get(sid) : null, codexDefaults });
    return [a.address, {
      status: shownStatus(a.status, t?.turn, seen[a.address]), // 見た完了は待機として出す
      silent: Boolean(a.silent), // まだ状態を報告していない（status は null。しばらくして手を挙げる）
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
  // その人が書いたもの（ホワイトボード）: プランと、書いた .md
  const docs = new Map([...info].map(([address, a]) => [address,
    [...(a.plan ? [{ path: a.plan, kind: "plan" }] : []), ...a.docs.map((path) => ({ path, kind: "doc" }))]]));
  return { rooms: roomsOf(sp.map((s) => ({ ...s, folder: placeOf(s, ps) })), ag, docs, present), info, open: openAgents(sp, ag) };
}

// レイアウトの根から id のブロックまでの道（見つからなければ null）
// ai-office レイアウトの、選んだエージェントのターミナルのブロック（layouts/ai-office.json）。上の帯のスイッチで出し入れする
const TERMINAL_BLOCK = "agent";
// 重ねて出したターミナルで見た完了（shared。アドレス → 見たターン）。そのターンの完了は ✓ を出さない（scene.js の shownStatus）
const SEEN = "ai-office.seen";
// 最後にオフィスで開いた人（shared。アドレス）。ai-office.open-last（keys.json で ⌘⇧.）で、その人をもう一度開く。どのコピーでも、
// 再起動しても同じ人
const LAST = "ai-office.last";
// コマ送りで出た例外（shared。いちばん新しいもの）。オフィスが止まったときに読む（AiOffice の failed）
const ERROR = "ai-office.error";

// 完了の人のターミナルを重ねて出す（terminal.peek）ときに、そのターンを見たと覚える。Herdr がのぞいただけで「見た」と
// 数えるかは分からないので、オフィスでも覚える。今はないターミナルの分は捨てる
function markSeen(address) {
  if (agents().find((a) => a.address === address)?.status !== "done") return;
  const turn = terminals().find((x) => x.address === address)?.turn;
  if (turn == null) return;
  const live = new Set(terminals().map((x) => x.address));
  const seen = Object.fromEntries(Object.entries(shared(SEEN) ?? {}).filter(([k]) => live.has(k)));
  setShared(SEEN, { ...seen, [address]: turn });
}

function pathTo(node, id) {
  if (!node) return null;
  if (node.id === id) return [node];
  for (const child of node?.children ?? []) {
    const rest = pathTo(child, id);
    if (rest) return [node, ...rest];
  }
  return null;
}

// スペースが今いるフォルダ: 最初のターミナルの今のフォルダ、なければ作ったときのフォルダ（Herdr の menu と同じ）。
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
        skipped.push({ name: `${base}/${name}`, why: tr("themeUnreadable", e?.message ?? e) });
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

// 大きく描くときの絵（@6x・@8x の PNG）のうち、あるもの（pic が使う）: img/ とその下のフォルダ、テーマのフォルダから
async function loadHires() {
  const dirs = [IMG, ...(await subdirs(`${appHome()}/${IMG}`)).map((d) => `${IMG}/${d}`)];
  for (const base of ["mods/ai-office/themes", "ai-office-themes"]) {
    dirs.push(...(await subdirs(`${appHome()}/${base}`)).map((d) => `${base}/${d}`));
  }
  for (const dir of dirs) {
    for (const name of await names(`${appHome()}/${dir}`)) {
      if (/@\d+x\.png$/.test(name)) hires.add(`${dir}/${name}`);
    }
  }
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

// 画面の言語を今のものにする（text.js の useLang。描く前と、文を作る前に）。上の帯の言語のボタンで選んだもの、OS に合わせるなら
// 調べた OS の言語
function langNow() {
  return useLang(langOf(shared(LANG), shared(OS_LANG)));
}

// OS の言語（"ja" など。languageOf）。調べられなければ null
async function osLanguage() {
  const r = await exec("sh", ["-c", OS_LANG_SCRIPT], { timeout: 5000 }).catch(() => null);
  return r?.code === 0 ? languageOf(r.stdout) : null;
}

export default class AiOffice extends View {
  init(_props, cx) {
    langNow(); // テーマを確かめた文（使えなかった理由）も、この言語で
    // OS の言語を調べて、変わっていれば shared に置く（Herdr を閉じても残るので、次からは初めからその言語で描く）。
    // 描き直しは shared が変わったときに Herdr がする
    cx.spawn(async () => {
      const os = await osLanguage();
      if (os && os !== shared(OS_LANG)) setShared(OS_LANG, os);
    });
    this.theme = null; // 使っているテーマ（テーマを読み終えるまでは null で、フロアを描かない）
    this.skippedThemes = []; // 使えなかったテーマと理由（「テーマ」のドロップダウンの下に出す）
    cx.spawn(async (cx) => {
      this.skippedThemes = await loadThemes();
      await loadHires();
      cx.notify();
    });
    this.office = new Office();
    this.drag = null; // 部屋をドラッグしている間: { from: スペースの id, over: dropTarget の答えか null }
    this.overRoom = false; // マウスが部屋の奥の壁の上にあるか（つかめる手のカーソル）
    this.hover = null; // マウスが乗っているもの（キャラ・PC・名札）の持ち主のエージェント。同じ持ち主のものを一緒に光らせる
    this.open = new Set(); // 今開いているタブのエージェント（いつも、マウスを乗せたときと同じように明るくする）
    this.present = new Set(); // ホワイトボードに載せる .md のうち、今読めるもの（読めないものは載せない。checkDocs）
    this.presentKey = "";
    this.checkDocs(cx);
    cx.timer.every(DOCS_CHECK_MS, (cx) => this.checkDocs(cx));
    this.width = 900; // フロアに使える幅と高さ（論理 px。on_size_change が来るまでは仮のもので、今の大きさで描く）
    this.height = 0;
    this.zoom = SCALE; // 今の倍率（floorNow。押した所を絵の座標にするとき）
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
    this.agentKeys = new Set(); // エージェントのプログラムの key（loadAgentKeys。読めるまでは空で、誰も足さない）
    this.loadAgentKeys(cx);
    cx.timer.every(SKILLS_MS, (cx) => { // 読めなかったときだけ試し直す（失敗は覚えられない）
      if (!this.agentKeys.size) this.loadAgentKeys(cx);
    });
    this.weatherTried = 0;
    this.weatherFor = null; // 最後に天気を取りにいった場所（場所が変わったら、待たずに取る）
    this.placeId = currentPlace().id;
    this.loadWeather(cx);
    cx.timer.every(WEATHER_CHECK_MS, (cx) => this.loadWeather(cx));
    // herdr-app do ai-office.<コマンド>（オフィスが見えている間だけ届く）: 窓を試す（sky-rain、sky-1930、sky-night、sky-auto）と、
    // 右下の通知のスイッチ（toasts-on で出す、toasts-off で出さない。上の帯の「通知」と同じ）。open-last は、最後にオフィスで
    // 開いた人をもう一度開く（キャラのクリックと同じ。keys.json で ⌘⇧. に割り当てる。その人がもういなければ何もしない）
    this.trial = { weather: null, time: null };
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "open-last") {
          // 何かを重ねて出している間（重ねたターミナル・ダイアログ・ポップアップ）は何もしない。重ねたターミナルの上で押すと、
          // 同じ人を重ねて出し直して画面がちらついた。聞けなければ（herdr-app がない）今までどおり開く
          const status = await exec("herdr-app", ["status"], { timeout: 5000 }).catch(() => null);
          if (status?.code === 0 && overlayOpen(status.stdout)) continue;
          const last = shared(LAST);
          if (terminals().some((x) => x.address === last)) this.act({ type: "chat", terminal: last }, cx);
          continue;
        }
        const toasts = /^toasts-(on|off)$/.exec(command ?? "");
        if (toasts) {
          setShared(TOASTS, toasts[1]); // 描き直しは shared が変わったときに Herdr がする
          continue;
        }
        const change = parseSkyCommand(command, Date.now(), currentPlace());
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
        console.log(`ai-office: ${place.id} の天気を取れなかった: ${e?.message ?? e}`);
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

  // ホワイトボードに載せる .md（エージェントのラベルのプランと書いた .md）が、今読めるかを調べる。ダイアログと同じ readTextFile で
  // 読むので、表示できるものだけが載る（fs/promises は、mod に許された場所の外の /tmp などを調べられない）。消したものと、まだ
  // 書かれていないもの（Write・Edit は、フックが書く直前にラベルを付ける）は載せない。変わったときだけ描き直す
  checkDocs(cx) {
    if (this.hidden()) return;
    const paths = new Set();
    for (const t of terminals()) {
      const labels = t.labels ?? {};
      if (labels["office.plan"]) paths.add(labels["office.plan"]);
      for (const path of (labels["office.docs"] || "").split("\n")) if (path) paths.add(path);
    }
    cx.spawn(async (cx) => {
      const present = new Set();
      for (const path of paths) {
        try {
          if ((await readTextFile(path)) !== null) present.add(path);
        } catch {} // 読めない（大きすぎる・フォルダなど）: ダイアログでも表示できない
      }
      const key = [...present].sort().join("\n");
      if (key !== this.presentKey) {
        this.presentKey = key;
        this.present = present;
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
    const { rooms, info, open } = gather(this.meta, this.codexDefaults, this.present, this.agentKeys);
    this.open = open;
    // 窓に合わせた大きさと並び（広ければ 1.5 倍・2 倍）
    const floor = fitFloor(rooms, this.width / SCALE - 2 * MARGIN, this.height / SCALE - 2 * MARGIN);
    this.zoom = scale = floor.zoom;
    const placed = floor.rooms.filter((r) => !r.newRoom);
    this.office.sync(placed, info);
    return { floor, placed, info };
  }

  // 描くもの（フロア全体の座標）: 資料室の本棚と、各部屋のもの。奥から手前の順に並べるので、
  // ほかの部屋の手前の通路や廊下を歩く人も、正しく前後する
  items(placed) {
    const skills = this.shelfSkills();
    const bindings = keys(); // ツールチップに出す、重ねたターミナルを閉じるキーと、最後に開いた人をもう一度開くキー（keys.json）
    const shortcuts = { close: closeKeyOf(bindings), reopen: reopenKeyOf(bindings) };
    return [
      ...floorDrawables(this.office, skills),
      ...placed.flatMap((r) => drawables(r, this.office, skills, shortcuts)
        .map((d) => ({ ...d, id: `${r.id}-${d.id}`, x: d.x + r.ox, y: d.y + r.oy, z: d.z + r.oy }))),
    ].sort((a, b) => a.z - b.z);
  }

  // エージェントのプログラムの key: 雇うポップアップと同じ knownAgents()（programs.json の run のあるもの）。まだ状態を
  // 報告していない人のペインは program.agent が false なので、program.key がこの中にあるかで見分ける（withSilent）。
  // 表はめったに変わらないので、読めたら読み直さない
  loadAgentKeys(cx) {
    cx.spawn(async (cx) => {
      try {
        const keys = new Set((await knownAgents()).map((a) => a.key));
        if (keys.size) {
          this.agentKeys = keys;
          cx.notify();
        }
      } catch {
        // 読めなかった: init の timer が SKILLS_MS ごとに試し直す
      }
    });
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
  // 1 コマで例外が出ても、次のコマは必ず予約する（前は次を予約する前に例外が出ると、オフィス全体が止まったままになった）。
  // 出た例外は failed が shared に残す
  schedule(cx) {
    let ms = TICK_ACTIVE;
    try {
      const fast = running(this.office) || doorsMoving(this.office); // 小走りか、自動ドアの開け閉め
      ms = this.hidden() ? HIDDEN_MS : !window()?.active ? TICK_INACTIVE : fast ? TICK_RUN : TICK_ACTIVE;
    } catch (e) {
      this.failed("schedule", e);
    }
    cx.timer.after(ms, (cx) => {
      try {
        this.frame(cx);
      } catch (e) {
        this.failed("frame", e);
      }
      this.schedule(cx);
    });
  }

  // 1 コマ。隠れている間は何もしない（見えたときの経過時間は dt の上限で切る）
  frame(cx) {
    if (this.hidden()) {
      this.shown = false;
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
    if (!state) return; // テーマを読み終えるまで
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
    const docs = placed.map((r) => r.docs.map((d) => d.path).join(",")).join("/") // 壁のホワイトボード（items にない）
      + `|${[...this.open].join(",")}`; // 開いているタブの人（明るくする。items の位置には出ない）
    const sig = `${place.id}|${h}:${m}|${this.view().key}|${clock.text}|${docs}|` + this.items(placed)
      .map((d) => `${d.img ?? d.text}+${d.over}+${d.books?.length ?? ""}@${d.x},${d.y}`).join(";");
    if (sig !== this.sig) {
      this.sig = sig;
      cx.notify();
    }
  }

  // コマ送りで出た例外を shared の ai-office.error に残す（オフィスが止まったときに、何が起きたかを後で読めるように）。
  // shared を書くと全部の mod が描き直すので、同じ例外は初めてのときと、続いていれば 1 分ごとにだけ書く（count が数）。
  // ここで例外を出すと次のコマを予約できないので、何があっても投げない
  failed(where, e) {
    try {
      const message = String(e?.message ?? e);
      const now = Date.now();
      if (this.error?.where === where && this.error.message === message) this.error.count++;
      else this.error = { where, message, count: 1, first: now, saved: 0 };
      if (now - this.error.saved < 60000) return;
      this.error.saved = now;
      setShared(ERROR, {
        where, message, count: this.error.count,
        first: new Date(this.error.first).toISOString(), at: new Date(now).toISOString(),
        stack: String(e?.stack ?? "").split("\n").slice(0, 8).join("\n"),
        // そのときの様子: 倍率（2 がふつう。オフィスが広いと 3・4）、フロアに使える大きさ、右のターミナルを隠しているか
        zoom: scale, width: Math.round(this.width), height: Math.round(this.height),
        terminalHidden: Boolean(pathTo(layout(), TERMINAL_BLOCK)?.at(-1)?.hidden),
        tick: this.office?.t ?? null, people: this.office?.chars?.size ?? null,
      });
    } catch {
      // 残せなくても、コマ送りは続ける
    }
  }

  // 描くものの絵: テーマの絵（src）か、img/ の絵（img）。今の倍率のもの
  src(d) {
    return pic(d.src ?? `${IMG}/${d.img}.png`);
  }

  sprite(d) {
    if (d.over) return this.box(d).child(image(this.src(d)).size_full()).child(this.overlay(d));
    return image(this.src(d)).absolute().left(px(d.x)).top(px(d.y)).w(px(d.w)).h(px(d.h));
  }

  box(d) {
    return div().absolute().left(px(d.x)).top(px(d.y)).w(px(d.w)).h(px(d.h));
  }

  overlay(d) {
    return image(pic(`${IMG}/${d.over}.png`)).absolute().left(0).top(0).size_full();
  }

  // ボタンの押下: 窓（mod.open）で開いたときに押した所から窓が動きださないよう止める。
  // フロアには届かないので、取り残された部屋のドラッグ（窓の外で離したなど）もここで捨てる
  hold(cx) {
    this.drag = null;
    cx.stop_propagation();
  }

  // クリックできる絵。持ち主（owner）があれば、その持ち主のどれかにマウスが乗っている間と、その人のタブを開いている間は明るくする
  button(id, d, onClick, tip) {
    return div().id(id).absolute().left(px(d.x)).top(px(d.y)).w(px(d.w)).h(px(d.h)).cursor_pointer()
      .when(Boolean(d.glow), (el) => el.rounded(ui(6)).hover((s) => s.bg("#ffffff59"))) // 絵はほぼ透明なので後ろを明るくする
      .when(Boolean(d.owner), (el) => el.on_hover((hovered, cx) => this.hoverOn(d.owner, hovered, cx)))
      .when(this.lit(d.owner), (el) => el.rounded(ui(6)).bg("#ffffff73"))
      .on_mouse_down("left", (_e, cx) => this.hold(cx))
      .on_click((_e, cx) => onClick(cx))
      .when(Boolean(d.right), (el) => el.on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        this.act(d.right, cx);
      }))
      .when(Boolean(tip), (el) => el.tooltip(tip))
      .child(image(this.src(d)).size_full())
      .when(Boolean(d.over), (el) => el.child(this.overlay(d)))
      .when(Boolean(d.books), (el) => el.children(d.books.map((b) => this.book(b))));
  }

  // scene.js の click: { type: "chat", terminal, name, machine } / { type: "ask", terminal, name } / { type: "hire", space, machine } /
  // { type: "skills" }。
  // 壁のホワイトボード: { type: "docs", room, docs: [{ path, kind, who }] }。机の PC の右クリック: { type: "tab-menu", terminal }
  act(click, cx) {
    // 上に重ねるもの（ターミナル・ダイアログ・ポップアップ）を出すクリックでは、マウスが乗っている印（明るさと頭の上の名前）を
    // 消す。消さないと、閉じたあともクリックした人が選んだままに見えた（乗せ直せばまた付く）。右のターミナルに切り替える
    // だけのとき（chat）は、オフィスが見えたままなので残す
    const terminalShown = !pathTo(layout(), TERMINAL_BLOCK)?.at(-1)?.hidden;
    if ((click.type !== "chat" || !terminalShown) && this.hover) {
      this.hover = null;
      cx.notify();
    }
    if (click.type === "tab-menu") this.tabMenu(click);
    if (click.type === "skills") {
      // 出どころの名前は、一覧（ai-office-skills）が今の言語で出す
      const skills = this.shelfSkills();
      const groups = Object.entries(SKILL_SOURCES)
        .map(([source, { color }]) => ({ source, color, skills: skills.filter((x) => x.source === source) }))
        .filter((g) => g.skills.length);
      openOverlay({ mod: "ai-office-skills", kind: "popup", width: 400, height: 520, props: { count: skills.length, groups } });
    }
    if (click.type === "ask") {
      // 選択肢の説明や答えの確認が長いこともあるので、プランと同じ広さのダイアログにして中をスクロールさせる
      openOverlay({ mod: "ai-office-ask", kind: "dialog", width: 0.65, height: 0.8, props: { terminal: click.terminal, name: click.name } });
    }
    if (click.type === "chat") {
      // キャラのクリック: 右のターミナルを出しているなら、そのターミナルに切り替えるだけ（話すのはターミナルで）。隠している
      // なら、そのターミナルをオフィスの上に重ねて出す（Herdr の terminal.peek。本物のターミナルなので Claude Code をそのまま
      // 使える。上の帯に「go to」と ✕）。Esc はエージェントに届くので、閉じるのは ✕ か、keys.json で overlay.close に割り当てた
      // キー（⌘.）。ターミナルのブロックがないレイアウト（Office ボタンで列を出すものなど）は、メインの欄にターミナルが見えているので
      // 切り替え
      if (shared(LAST) !== click.terminal) setShared(LAST, click.terminal);
      if (terminalShown) run("agent.focus", { terminal: click.terminal });
      else {
        markSeen(click.terminal);
        run("terminal.peek", { terminal: click.terminal });
      }
    }
    if (click.type === "docs") {
      // プランは長い行（コードや表）が多いので、skill の中身より広く、窓の幅に合わせる
      openOverlay({ mod: "ai-office-docs", kind: "dialog", width: 0.65, height: 0.8, props: { room: click.room, docs: click.docs } });
    }
    if (click.type === "hire") {
      openOverlay({ mod: "ai-office-hire", kind: "popup", width: 240, height: 320, props: { space: click.space, machine: click.machine } });
    }
  }

  // 机の PC の右クリック: そのエージェントのタブのメニュー（ai-office-tab: 名前を変える・閉じる。New tab は出さない）。
  // 左クリックは名札と同じく、その人を表示するだけ（focus）。閉じる前に確かめるかは Herdr の tab.close に任せる
  tabMenu({ terminal }) {
    // まだ状態を報告していない人（withSilent）は agents() にいないので、ペインからタブを探す
    const tab = agents().find((x) => x.address === terminal)?.tab ?? panes().find((p) => p.terminal === terminal)?.tab;
    if (!tab) return;
    openOverlay({ mod: "ai-office-tab", kind: "popup", width: 200, height: 90, props: { tab } });
  }

  // キャラ・PC・名札にマウスが乗った・離れた: 持ち主を覚えて描き直す（同じ持ち主のものを一緒に光らせる）
  // 明るくする持ち主か: マウスが乗っている人と、今開いているタブの人
  lit(owner) {
    return Boolean(owner) && (owner === this.hover || this.open.has(owner));
  }

  hoverOn(owner, hovered, cx) {
    if (hovered) this.hover = owner;
    else if (this.hover === owner) this.hover = null;
    else return;
    cx.notify();
  }

  // 机の前の板の名札（タブバーと同じ名前。入らなければ「…」で切る）。持ち主にマウスが乗っている間と、その人のタブを開いている間は黄色
  nameplate(d) {
    const lit = this.lit(d.owner);
    return div().id(d.id).absolute().left(px(d.x)).top(px(d.y)).w(px(d.w)).h(px(d.h)).px(ui(3)).flex().items_center()
      .rounded(ui(3)).border(1).border_color("#5b3a2c").bg(lit ? "#ffe08a" : "#fffaf0").cursor_pointer()
      .on_mouse_down("left", (_e, cx) => this.hold(cx))
      .on_click((_e, cx) => this.act(d.click, cx))
      .on_hover((hovered, cx) => this.hoverOn(d.owner, hovered, cx))
      .tooltip(d.tip)
      .child(div().w_full().text_size(ui(9)).line_height(`${ui(10)}px`).text_color("#3b2a2a").whitespace_nowrap().text_ellipsis()
        .overflow_hidden().child(d.plate));
  }

  // マウスが乗っている人の頭の上の、名前の札（歩いている途中でも、どの席の人か分かるように。全部の名前を出す）
  hoverMarks(items) {
    const c = items.find((d) => d.char && d.owner === this.hover);
    const name = this.hover && this.office.chars.get(this.hover)?.info?.seatName;
    if (!c || !name) return [];
    return [h_flex().absolute().left(px(c.x + 9 - 90)).top(px(c.y - 11)).w(px(180)).h(px(9)).justify_center()
      .child(h_flex().max_w_full().h_full().px(ui(4)).items_center().rounded(ui(3)).border(1).border_color("#3b2a2a").bg("#ffe08a")
        .child(div().min_w(0).text_size(ui(10)).text_color("#3b2a2a").whitespace_nowrap().text_ellipsis().overflow_hidden()
          .child(name)))];
  }

  item(d) {
    if (d.text !== undefined) return this.tag(d);
    if (d.plate !== undefined) return this.nameplate(d);
    if (d.tile) return this.tiled(d);
    return d.click ? this.button(d.id, d, (cx) => this.act(d.click, cx), d.tip) : this.sprite(d);
  }

  // 幅 tile の絵を、w の幅まで横に並べる（はみ出した分は切る。ガラスや障子の壁）
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
      .child(h_flex().h_full().pl(ui(3)).pr(ui(5)).gap(ui(4)).items_center().rounded(ui(3)).border(1).border_color("#3b2a2a").bg("#fffaf0")
        .child(div().w(px(2)).h(px(6)).bg(d.color ?? "#9aa4b4"))
        .child(div().text_size(ui(10)).text_color("#3b2a2a").whitespace_nowrap().child(d.text)));
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
      .tooltip(tr("clockTip", placeName(place), text, offsetLabel(offsetAt(place, Date.now()))))
      .children(["clock-face", `clock-m-${m}`, `clock-h-${h}`].map((img) => image(pic(`${IMG}/${img}.png`)).absolute().left(0).top(0).size_full()));
  }

  // 壁時計のクリック: 場所のドロップダウン（ai-office-pick）。選ぶと、壁時計の時刻・窓の空・天気がその場所になる
  placeMenu() {
    const now = Date.now();
    const items = PLACES.map((p) => {
      const offset = offsetAt(p, now);
      const summer = Boolean(p.dst) && offset !== p.std;
      return { name: p.id, label: placeName(p), description: tr("placeNow", offsetLabel(offset), summer, placeClock(p, now).text) };
    });
    openOverlay({ mod: "ai-office-pick", kind: "popup", width: 300, height: 420,
      props: { key: "ai-office.place", items, current: currentPlace().id, height: 420 } });
  }

  // 壁の名札（スペースの名前。長ければ真ん中を「…」にして、だいたい herdr-ai-office ほどの長さまで）。左の仕切りの右から、
  // 窓（書いたものがあればホワイトボード）の手前まで（それより長くなるときは、さらに終わりを「…」で切る）。
  // 左クリックでそのスペースを選び、その部屋のメニュー（ai-office-tab: 名前を変える・閉じる、git ならワークツリーを開く・外す。
  // ワークツリーを作るのはエージェントなので、Herdr のスペースのメニューにある New worktree は出さない）を出す。
  // 右クリックはメニューだけ。閉じるときは herdr が確かめる（部屋のエージェントも終わる）。
  // 名札の並ぶ壁と同じく、ほかの部屋へドラッグすると部屋の順番が変わる（名札の上で離せばクリック）
  plate(room) {
    const full = room.machine ? `${room.machine}: ${room.name}` : room.name;
    const text = plateText(full); // 長い名前は真ん中を「…」に（全部はツールチップ）
    const right = room.docs.length ? room.w - 116 : room.w - 76;
    const menu = () => openOverlay({ mod: "ai-office-tab", kind: "popup", width: 200, height: 260, props: { space: room.id } });
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
      .tooltip(tr("roomPlateTip", full))
      .px(ui(8)).flex().items_center().rounded(ui(3)).border(2).border_color("#5b3a2c").bg(room.active ? "#c58a55" : "#a8774c")
      .text_size(ui(12)).font_semibold().text_color("#fff4dc").whitespace_nowrap().text_ellipsis().overflow_hidden()
      .child(text);
  }

  // 奥の壁（テーマの images.wall を横に並べ、幅で切る）
  wall(x, y, w) {
    const { WALL_H, IMAGES } = geometry();
    const img = IMAGES.wall;
    const tiles = [];
    for (let dx = 0; dx < w; dx += img.w) tiles.push(image(pic(img.src)).absolute().left(px(dx)).top(0).w(px(img.w)).h(px(img.h)));
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

  // ガラスの部屋の手前のガラスの壁と扉（空き部屋の。人のいる部屋は scene.js の drawables が人と前後させて描く）。
  // 自動ドアの戸（テーマにあれば）は、誰も通らないので閉めたまま（柱のあいだ。柱が手前）
  frontGlass(lot) {
    const { GLASS, IMAGES } = geometry();
    const door = LEFT_PASS - 10;
    const panel = IMAGES.doorPanel;
    return [
      this.tiled({ src: IMAGES.glass.src, tile: IMAGES.glass.w, x: lot.ox + door + 18, y: lot.oy + GLASS.y, w: lot.w - door - 18, h: GLASS.h }),
      ...(panel ? [this.sprite({ src: panel.src, x: lot.ox + door + 2, y: lot.oy + GLASS.y + GLASS.h - panel.h, w: panel.w, h: panel.h })] : []),
      this.sprite({ src: IMAGES.door.src, x: lot.ox + door, y: lot.oy + GLASS.y - 2, w: IMAGES.door.w, h: IMAGES.door.h }),
    ];
  }

  // 窓: 外の空（選んだ場所の時刻と天気。scene.js の windowView）を奥から重ね、最後に窓枠（ガラスは透明）。
  // ホバーでその場所の時刻と天気
  sky(x, y, view, id) {
    return div().id(id).absolute().left(px(x)).top(px(y)).w(px(28)).h(px(16)).tooltip(view.tip)
      .children(view.layers.map((img) => image(pic(`${IMG}/${img}.png`)).absolute().left(0).top(0).size_full()));
  }

  // 壁のホワイトボード（この部屋の人のプランと書いた .md）。窓の左に掛け、クリックで中身（ai-office-docs）。
  // どれもなければ掛けない
  board(room) {
    const docs = room.docs.map((d) => {
      const a = this.office.chars.get(d.address)?.info ?? {};
      return { path: d.path, kind: d.kind, who: [a.name, a.tab].filter(Boolean).join(" · ") || d.address };
    });
    const plans = docs.filter((d) => d.kind === "plan").length;
    const d = { img: "whiteboard-plan", x: room.ox + room.w - 112, y: room.oy + 7 + geometry().DECOR_DY, w: 30, h: 18, glow: true };
    return this.button(`board-${room.id}`, d, (cx) => this.act({ type: "docs", room: room.name, docs }, cx),
      tr("boardTip", plans, docs.length - plans));
  }

  // 部屋の後ろのもの: 奥の壁、左の仕切り（ガラスの部屋: 隣とは壁、縦の廊下に面していればガラス）、壁の飾り（ホワイトボード・
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
  // 暗くするのは部屋の中（奥の壁の下から、手前の開いた部屋は列の下まで、ガラスの部屋はガラスの壁まで）
  newRoom(lot) {
    const { WALL_H, GLASS } = geometry();
    const h = (GLASS ? GLASS.y : lot.h) - WALL_H;
    const doorY = GLASS ? 8 : 22;
    return [
      div().id("new-room").absolute().left(px(lot.ox + PART_W)).top(px(lot.oy + WALL_H)).w(px(lot.w - PART_W)).h(px(h))
        .bg("#00000038").cursor_pointer().hover((s) => s.bg("#00000020"))
        .on_mouse_down("left", (_e, cx) => this.hold(cx))
        .on_click((_e, cx) => cx.spawn(async () => {
          const folder = await pickFolder({ prompt: tr("folderPrompt") });
          if (folder) run("space.new", { folder });
        }))
        .tooltip(tr("newRoomTip"))
        .child(this.sprite({ img: "door", x: (lot.w - PART_W - 16) / 2, y: doorY, w: 16, h: 20 }))
        .child(div().absolute().left(0).top(px(doorY + 26)).w_full().flex().justify_center()
          .text_size(ui(11)).text_color("#fff4dcdd").child(tr("newRoom"))),
      ...(GLASS ? this.frontGlass(lot) : []),
    ];
  }

  // 右上の「テーマ」: テーマのドロップダウン（ai-office-pick。使っているテーマにチェック、使えなかったテーマと理由も）
  themeMenu(themes) {
    // 高さは、説明が 2 行に折り返しても入るように見込む（多ければ中をスクロール）
    const height = Math.min(420, 12 + themes.length * 62 + (this.skippedThemes.length ? 10 + this.skippedThemes.length * 52 : 0));
    openOverlay({ mod: "ai-office-pick", kind: "popup", width: 320, height, props: {
      key: "ai-office.theme",
      items: themes.map(({ name, label, description }) => ({ name, label: inLang(label), description: inLang(description) })),
      current: this.theme,
      notes: this.skippedThemes.map((x) => ({ title: tr("themeSkipped", x.name), text: x.why })),
      height,
    } });
  }

  // 右上の言語のボタン: 言語のドロップダウン（ai-office-pick。選ぶと shared の ai-office.lang に置き、どの ai-office の mod も
  // その言語で描き直す）。いちばん上は OS に合わせる（今の OS の言語も出す）
  langMenu() {
    const os = LANGS[langOf("auto", shared(OS_LANG))];
    const items = [
      { name: "auto", label: tr("langAuto"), description: tr("langAutoNow", os) },
      ...Object.entries(LANGS).map(([name, label]) => ({ name, label })),
    ];
    const choice = shared(LANG);
    const height = 24 + 46 + (items.length - 1) * 34;
    openOverlay({ mod: "ai-office-pick", kind: "popup", width: 220, height, props: {
      key: LANG, items, current: LANGS[choice] ? choice : "auto", height,
    } });
  }

  // ---- 部屋をドラッグして順番を変える（herdr のスペースの順番。左のスペースの一覧と同じ space.move） ----
  // 座標はフロアの左上からの論理 px（e.local_position）。部屋の中のボタンを押したときはフロアに届かない

  // フロアの点（論理 px）→ 絵の座標
  floorPoint(p) {
    return { x: p.x / this.zoom, y: p.y / this.zoom };
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
    if (!over) return tr("dragHold", name(from));
    return tr("dragTo", name(from), name(over.id), over.side === "right");
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
    const { BOX_H } = geometry(); // 部屋の枠（ガラスの部屋は横の廊下を含めない）
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

  // 1 枚のフロア: 部屋の床と廊下の床（ガラスの部屋は列ごとの横の廊下も）、資料室の奥の壁、各部屋の後ろのもの、描くもの、
  // 選んでいる部屋の枠、ドラッグ中の印、外枠
  building(floor, items, t, view) {
    const { ROOM_H, BOX_H, IMAGES } = geometry();
    const { floor: wood, hall, corridor } = IMAGES;
    const floorTiles = [];
    for (let y = 0; y < floor.h; y += wood.h) {
      for (let x = HALL_W; x < floor.w; x += wood.w) {
        floorTiles.push(image(pic(wood.src)).absolute().left(px(x)).top(px(y)).w(px(wood.w)).h(px(wood.h)));
      }
    }
    if (corridor) { // 列ごとの横の廊下（部屋の枠の下）
      for (let oy = 0; oy < floor.h; oy += ROOM_H) {
        for (let x = HALL_W; x < floor.w; x += corridor.w) {
          floorTiles.push(image(pic(corridor.src)).absolute().left(px(x)).top(px(oy + BOX_H)).w(px(corridor.w)).h(px(corridor.h)));
        }
      }
    }
    const hallTiles = [];
    for (let y = 0; y < floor.h; y += hall.h) {
      hallTiles.push(image(pic(hall.src)).absolute().left(0).top(px(y)).w(px(hall.w)).h(px(hall.h)));
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
    const lang = langNow();
    const now = this.floorNow();
    if (!now) return v_flex().id("root").size_full().bg(t.canvas).p(14).text_size(12).text_color(t.dim).child(tr("loadingThemes"));
    const { floor, placed, info } = now;
    const themes = themeList();
    const current = themes.find((x) => x.name === this.theme);
    const counts = { working: 0, blocked: 0, done: 0, idle: 0 };
    for (const [address, a] of info) {
      // まだ状態を報告していない人は、手を挙げたら「待ち」に数える（それまでは数えない）
      const status = a.silent ? (this.office.chars.get(address)?.behavior === "raise" ? "blocked" : null) : a.status;
      if (status) counts[status] = (counts[status] ?? 0) + 1;
    }
    const dragging = this.dragText(floor);
    const quiet = shared(TOASTS) === "off";
    // 窓（mod.open）でほかのレイアウトの上に開いたときは、スイッチが効かないので薄くし、ツールチップで言う
    const toastsHere = layout()?.toast === TOAST_MOD;
    // 右のターミナル（ai-office レイアウトだけ）。隠すとオフィスが窓いっぱいになる。出し入れはレイアウトに覚えられ、再起動しても残る
    const terminal = pathTo(layout(), TERMINAL_BLOCK)?.at(-1) ?? null;
    const langAuto = !LANGS[shared(LANG)]; // 言語を選んでいない（OS に合わせる）
    return v_flex().id("root").size_full().bg(t.canvas).text_color(t.foreground)
      .on_mouse_up("left", (_e, cx) => { // フロアの外（上の帯など）で離した: 部屋のドラッグをやめる
        if (this.drag?.moved) cx.notify();
        this.leave(cx);
        this.drag = null;
      })
      // 上の帯: 細い列（Office ボタンで出すオフィスの列は 440px まで狭まる）では、件数（ドラッグ中はその説明）だけを「…」で切り、
      // ほかは縮めない（全部並べると約 560px）。いちばん右は言語のボタン（地球の絵だけ。どの言語でも同じ幅）
      .child(h_flex().h(32).flex_none().px(14).gap(14).items_center().text_size(12).text_color(t.muted)
        .child(div().flex_none().font_semibold().text_color(t.foreground).child("AI Office"))
        .child(dragging
          ? div().min_w(0).truncate().font_semibold().text_color(t.accent).child(dragging) // 部屋をドラッグ中: どうなるか
          : div().min_w(0).truncate().child(tr("counts", counts)))
        .child(h_flex().id("theme").flex_none().ml_auto().px(6).gap(4).items_center().rounded(4).cursor_pointer().text_color(t.dim)
          .hover((s) => s.text_color(t.foreground))
          .tooltip([inLang(current?.description), tr("themeTip")].filter(Boolean).join("\n"))
          .on_click(() => this.themeMenu(themes))
          .child(tr("themeButton", inLang(current?.label) || this.theme))
          .child(svg("mods/workspace-chrome/chevron-down.svg").size(10)))
        .when(Boolean(terminal), (el) => el.child(div().id("terminal-toggle").flex_none().px(6).rounded(4).cursor_pointer()
          .text_color(t.dim).hover((s) => s.text_color(t.foreground))
          .tooltip(tr(terminal.hidden ? "terminalHiddenTip" : "terminalShownTip"))
          .on_click(() => run("layout.toggle", { id: TERMINAL_BLOCK }))
          .child(tr(terminal.hidden ? "terminalHidden" : "terminalShown"))))
        .child(div().id("toasts").flex_none().px(6).rounded(4).cursor_pointer().text_color(t.dim).when(!toastsHere, (el) => el.opacity(0.5))
          .hover((s) => s.text_color(t.foreground))
          .tooltip([tr(quiet ? "toastsOffTip" : "toastsOnTip"), tr("toastsSound"), toastsHere ? "" : tr("toastsElsewhere")]
            .filter(Boolean).join("\n"))
          .on_click(() => setShared(TOASTS, quiet ? "on" : "off"))
          .child(tr(quiet ? "toastsOff" : "toastsOn")))
        .child(div().id("legend").flex_none().px(6).rounded(4).cursor_pointer().text_color(t.dim).hover((s) => s.text_color(t.foreground))
          .tooltip(tr("legendTip"))
          .on_click(() => openOverlay({ mod: "ai-office-legend", kind: "popup", width: 300, height: 420 }))
          .child(tr("legend")))
        .child(h_flex().id("lang").flex_none().h(20).px(4).items_center().rounded(4).cursor_pointer().text_color(t.dim)
          .hover((s) => s.text_color(t.foreground))
          .tooltip(tr("langTip", LANGS[lang], langAuto))
          .on_click(() => this.langMenu())
          .child(svg("mods/ai-office/globe.svg").size(13))))
      .child(div().id("scroll").flex_1().min_h(0).overflow_scroll() // 細い列（Office ボタン）では横にも
        .on_size_change((size, cx) => { // フロアに使える広さ。変わったら、入るいちばん大きい倍率で描き直す（floorNow）
          if (Math.abs(size.width - this.width) >= 1 || Math.abs(size.height - this.height) >= 1) {
            this.width = size.width;
            this.height = size.height;
            cx.notify();
          }
        })
        // まわりの余白は倍率によらない。幅が余るときは真ん中に
        .child(div().p(MARGIN * SCALE).pl(Math.max(MARGIN * SCALE, (this.width - floor.w * scale) / 2))
          .child(this.building(floor, this.items(placed), t, this.view()))));
  }
}
