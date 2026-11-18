// scene.js: オフィスの中身の計算。herdr も gpui-kit も import しない（bun test で試せる）。
// 座標はすべて絵のピクセル（art px）。mod は SCALE 倍の論理 px で描く。
// 絵の置き方は scripts/build-art.py の見本（preview）と同じ:
//   立ち・歩き（18x24）は左上を (足の x-9, 足の y-23)、座り（18x18）は (席の x-9, BACK-18)、
//   椅子は (席の x-7, BACK-9)、ノート PC は (席の机の x+7, BACK-5)、手は (席の机の x, BACK)。

export const SCALE = 2;
export const TICK_ACTIVE = 250; // ms。窓がアクティブなとき（4fps。6fps だと main-dots の横で CPU 約 15%）
export const TICK_INACTIVE = 500; // 窓が後ろにあるとき（2fps）
export const TICK_RUN = 125; // 誰かが小走りしている間（8fps。速く動くので、4fps だと 1 コマで大きく飛ぶ）
export const SPEED = 14; // 歩く速さ（art px / 秒）
export const RUN_SPEED = 60; // 資料室へ行き来するときの小走り（1 枚のフロアでは資料室が遠い）
export const ERRAND_READ_MS = 5000; // skill を使ったとき、資料室で読む時間
export const TALK_MS = 4800; // 話しかけに行って話す時間（話しかけた人と相手が、TALK_TURN_MS ずつ交互に話す）
export const TALK_TURN_MS = 1200;
export const TALK_DEDUP_MS = 20000; // 受け取った側の出来事は、同じ 2 人でこの間に話しに行っていたら数えない（送った側と重なるので）
export const TALK_COLOR = "#e8b84a"; // 話しかけるときの札（送った文）の色

// オフィスは 1 枚のフロア: 左に縦の廊下（一番上が資料室で、本棚はここに 1 つ）、その右に部屋をすき間なく並べる。
// 部屋の形と、床・壁・ガラスなどの絵は、テーマで選ぶ。テーマは themes/<名前>/theme.json と PNG（人が足すものは
// ~/.config/herdr-app/ai-office-themes/<名前>/ にも置ける）。main.js がフォルダを読み、readTheme で確かめて addTheme で
// 登録し、useTheme が下の寸法と絵を差し替える。同梱のテーマ:
// - modern（初め）: 独立した部屋。部屋どうしの間は奥から手前まで壁でふさぎ、手前（廊下側）はガラスの壁で、左に扉が 1 つ。
//   列ごとに部屋の手前を横の廊下が通り、左の縦の廊下につながる。部屋を出入りするのは扉（通り道 LEFT_PASS）だけ
// - classic: 部屋の左端は仕切りの壁で、奥から PART_END までをふさぎ、手前は通路として開けておく（廊下や隣の部屋とつながる）
// 部屋の中の座標は部屋の左上から、フロア全体の座標はフロアの左上（廊下の左上）から。
export const DESK_X = 26; // 机の左端（左の仕切りの内側）
export const DESK_END = 8; // 机の端の板の幅
export const DESK_H = 21; // 机の高さ（奥の縁から脚の下まで）
export const SEAT_W = 24;
export const PART_W = 4; // 部屋の左の仕切り（壁）の厚さ
export const MIN_ROOM_W = 160;
export const LEFT_PASS = 14; // 机の左の通り道（x）。右は部屋ごと（room.rightPass）。ガラスの部屋の扉はこの x が真ん中
export const HALL_W = 44; // 左の廊下の幅

// テーマで変わる寸法と絵。このファイルの中と bun test は、そのまま読む（ほかのモジュールからは geometry() で読む）。
// テーマを選ぶまで（main.js がテーマのフォルダを読み終えるまで）は undefined
export let THEME = null;
export let ROOM_H, WALL_H, LANE_Y, BACK, FRONT_Y, CORRIDOR_Y, PART_END, GLASS, BOX_H, RIGHT_EXIT, DECOR_DY, HALL_SIDE, IMAGES, COLORS;
export let WINDOW; // 窓枠の絵（img/ の下の名前）: window（十字の桟）か window-slide（2 枚の引き違いの窓）
// 資料室（廊下の一番上）で本を読む場所（フロア全体の座標）。本棚の前から、読む人が増えると順に並ぶ
export let LIBRARY;
// 本棚（bookshelf-empty.png、資料室＝フロアの (6, SHELF.y) に置く）の中で本を立てる場所。scripts/build-art.py の bookshelf と
// 同じ寸法: 3 段で、本の下端の次の行が y = 14・27・40、横は x = 3〜28。本は幅 2 で、1 段に 13 冊
export let SHELF;

// テーマが images に書かなかった絵（src は herdr-app のフォルダ appHome から。w, h は絵の px）
export const DEFAULT_IMAGES = {
  wall: { src: "mods/ai-office/img/wall.png", w: 512, h: 36 },
  floor: { src: "mods/ai-office/img/floor.png", w: 512, h: 160 },
  hall: { src: "mods/ai-office/img/hall.png", w: 48, h: 560 },
};
// 仕切りの壁と、縦の廊下に面したガラスの壁の色（テーマの colors で変えられる）
export const DEFAULT_COLORS = {
  partition: "#e3cfa6", partitionEdge: "#8a6040", partitionFace: "#b07a4c", partitionBase: "#5b3a2c",
  sideGlass: "#bee6fae6", sideGlassEdge: "#46536f",
};
const PNG_SCALE = 4; // テーマの PNG は、絵の 1 ピクセル = 4 ピクセル（オフィスは 2 論理 px で描くので、Retina で 1:1）

/** PNG の大きさを絵の px で（先頭の IHDR から。PNG の px の 1/4）。PNG でなければ null。 */
export function pngSize(bytes) {
  const b = bytes;
  if (!b || b.length < 24 || b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4e || b[3] !== 0x47) return null;
  const u32 = (i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  return { w: u32(16) / PNG_SCALE, h: u32(20) / PNG_SCALE };
}

/**
 * theme.json（JSON.parse したもの）を読んで確かめる。sizes: images に書いたファイル名 → pngSize（読めなかったものはなし）。
 * base: そのテーマのフォルダ（appHome から。絵の src になる）。返すもの: { theme, problems }。problems が空でなければ、
 * そのテーマは使わない（部屋が描けない・人が机や壁を通り抜けるなど）。書き方は README の「テーマを足す」。
 */
export function readTheme(name, json, sizes = {}, base = `mods/ai-office/themes/${name}`) {
  const problems = [];
  const r = json?.room ?? {};
  const int = (key) => {
    if (!Number.isInteger(r[key])) problems.push(`room.${key} が整数でない`);
    return r[key];
  };
  const room = {
    height: int("height"), wall: int("wall"), lane: int("lane"), deskBack: int("deskBack"), box: int("box"),
    corridorY: int("corridorY"), partitionEnd: int("partitionEnd"), shelfY: int("shelfY"), decorDy: int("decorDy"),
  };
  if (typeof r.rightExit !== "boolean") problems.push("room.rightExit が true か false でない");
  if (!["glass", "partition"].includes(r.hallSide)) problems.push("room.hallSide が glass か partition でない");
  const front = r.wanderFront ?? null;
  if (front !== null && !(Array.isArray(front) && front.length === 2 && front.every(Number.isInteger) && front[0] <= front[1])) {
    problems.push("room.wanderFront が null か [上, 下] でない");
  }
  const g = json?.glass ?? null;
  if (g !== null && !(Number.isInteger(g.y) && Number.isInteger(g.height))) problems.push("glass が null か { y, height } でない");
  const window = json?.window ?? "cross";
  if (!["cross", "slide"].includes(window)) problems.push("window が cross（十字の桟）か slide（2 枚の引き違い）でない");
  const images = { ...DEFAULT_IMAGES };
  for (const [key, file] of Object.entries(json?.images ?? {})) {
    const size = sizes[file];
    if (!size) {
      problems.push(`images.${key}（${file}）が読めない`);
      continue;
    }
    if (!Number.isInteger(size.w) || !Number.isInteger(size.h)) problems.push(`images.${key}（${file}）の大きさが 4 の倍数でない`);
    images[key] = { src: `${base}/${file}`, w: size.w, h: size.h };
  }
  if (problems.length === 0) {
    const deskEnd = room.deskBack + DESK_H;
    const need = (ok, text) => { if (!ok) problems.push(text); };
    need(room.wall < room.lane && room.lane < room.deskBack - 9, "room.lane（机の奥の通路）は、壁（room.wall）より下、椅子（room.deskBack − 9）より上に");
    need(deskEnd <= room.box && room.box <= room.height, "机（room.deskBack + 21 まで）≦ 部屋の枠（room.box）≦ 1 列の高さ（room.height）に");
    need(room.partitionEnd <= room.box, "仕切り（room.partitionEnd）は部屋の枠（room.box）まで");
    need(room.shelfY >= 0 && room.shelfY + 76 < room.height, "資料室の本棚（room.shelfY）と読む所（+ 76）が 1 列に入らない");
    need(6 + room.decorDy >= 0 && 7 + room.decorDy + 18 <= room.wall - 5, "壁の飾り（窓・ホワイトボード。room.decorDy）が壁に入らない");
    need(images.wall.h === room.wall, `壁の絵の高さ（${images.wall.h}）が room.wall と違う`);
    if (images.corridor) need(images.corridor.h === room.height - room.box, "横の廊下の絵の高さが、1 列の高さ − 部屋の枠と違う");
    if (g) {
      need(g.y >= deskEnd && g.y + g.height === room.box, "ガラス（glass.y から glass.height）は机より手前で、下端が部屋の枠（room.box）に");
      need(room.box < room.corridorY && room.corridorY < room.height, "room.corridorY（横の廊下）は部屋の枠の下、1 列の中に");
      need(front === null, "ガラスの部屋の room.wanderFront は null（うろうろは部屋の中だけ）");
      need(images.glass?.h === g.height, "images.glass（ガラスの壁の 1 枚）が要る。高さは glass.height");
      need(images.door?.h === g.height + 2 && images.door.w >= 20, "images.door（扉。柱 2・開いた所 16・柱 2・寄せた戸）が要る。高さは glass.height + 2");
    } else {
      need(deskEnd < room.corridorY && room.corridorY < room.height, "room.corridorY（手前の通路）は机の下、1 列の中に");
      need(front !== null && deskEnd < front[0] && front[1] < room.height, "手前が開いた部屋の room.wanderFront は、机の下から 1 列の中まで");
    }
  }
  const theme = {
    name, label: typeof json?.label === "string" ? json.label : name, description: typeof json?.description === "string" ? json.description : "",
    order: Number.isFinite(json?.order) ? json.order : 100,
    ROOM_H: room.height, WALL_H: room.wall, LANE_Y: room.lane, BACK: room.deskBack, BOX_H: room.box, CORRIDOR_Y: room.corridorY,
    PART_END: room.partitionEnd, SHELF_Y: room.shelfY, DECOR_DY: room.decorDy, FRONT_Y: front,
    GLASS: g ? { y: g.y, h: g.height } : null, RIGHT_EXIT: r.rightExit, HALL_SIDE: r.hallSide,
    IMAGES: images, COLORS: { ...DEFAULT_COLORS, ...(json?.colors ?? {}) }, WINDOW: window === "slide" ? "window-slide" : "window",
  };
  return { theme, problems };
}

const themes = new Map(); // 名前（フォルダの名前）→ readTheme の theme

/** テーマを使えるようにする（同じ名前なら差し替える）。 */
export function addTheme(theme) {
  themes.set(theme.name, theme);
}

/** 使えるテーマ（theme.json の order の順、同じなら名前の順）。 */
export function themeList() {
  return [...themes.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

/**
 * テーマを選んで、寸法と絵を差し替える。知らない名前なら modern、それもなければ最初のテーマ。テーマがひとつもなければ null。
 * 寸法が変わるので、部屋を並べ直し、Office も作り直すこと。
 */
export function useTheme(name) {
  const t = themes.get(name) ?? themes.get("modern") ?? themeList()[0];
  if (!t) return null;
  THEME = t.name;
  ({ ROOM_H, WALL_H, LANE_Y, BACK, FRONT_Y, CORRIDOR_Y, PART_END, GLASS, BOX_H, RIGHT_EXIT, DECOR_DY, HALL_SIDE, IMAGES, COLORS, WINDOW } = t);
  LIBRARY = [{ x: 22, y: t.SHELF_Y + 52 }, { x: 12, y: t.SHELF_Y + 64 }, { x: 32, y: t.SHELF_Y + 64 }, { x: 22, y: t.SHELF_Y + 76 }];
  SHELF = { x: 6, y: t.SHELF_Y, bases: [14, 27, 40], left: 3, right: 29, bookW: 2 };
  return THEME;
}

/** 今のテーマの寸法と絵（main.js 用。ほかのモジュールからは、差し替えた値をこれで確実に読む）。 */
export function geometry() {
  return { THEME, ROOM_H, WALL_H, LANE_Y, BACK, FRONT_Y, CORRIDOR_Y, PART_END, GLASS, BOX_H, RIGHT_EXIT, DECOR_DY, HALL_SIDE, IMAGES, COLORS, WINDOW,
    SHELF };
}

export const NEW_ROOM_W = 72; // 空き部屋（クリックで新しい部屋）
export const BOARD_ROOM_W = 200; // ホワイトボードを掛ける部屋の幅の下限（名札・ホワイトボード・窓・時計が並ぶ）

export function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** model の ID の系統（opus / sonnet / haiku / fable）。claude-opus-5-5[1m] や us.anthropic.claude-... でも。 */
export function modelFamily(model) {
  return /claude-(opus|sonnet|haiku|fable)/i.exec(model ?? "")?.[1].toLowerCase() ?? null;
}

/** 表示用の model 名。claude-opus-5-5 → Opus 5.5、Claude 以外はそのまま。 */
export function modelLabel(model) {
  const m = /claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d+))?/i.exec(model ?? "");
  if (!m) return model ?? null;
  const name = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  return `${name} ${m[2]}${m[3] ? `.${m[3]}` : ""}`;
}

/**
 * 見た目（img/char/<look>-<pose>.png の look）。服は AI の種類（OSC 7501 の app）、
 * 髪の色と小物は model（opus: 眼鏡とネクタイ、sonnet: なし、haiku: 若葉、fable: 星のピン）。Claude で model が分からなければ sonnet。
 */
export function lookOf(app, model) {
  if (/claude/i.test(app ?? "")) return `claude-${modelFamily(model) ?? "sonnet"}`;
  if (/codex/i.test(app ?? "")) return "codex";
  return "other";
}

/** effort の鉢巻きの色（img/band/<color>-<pose>.png）。low はなし。max は作業中に炎も出す（drawables）。 */
export function bandOf(effort) {
  return { medium: "blue", high: "white", xhigh: "red", max: "red" }[effort] ?? null;
}

/** 起動引数の値（--model X と --model=X のどちらも）。names のどれか。 */
export function argvValue(argv, names) {
  const list = argv ?? [];
  for (let i = 0; i < list.length; i++) {
    for (const n of names) {
      if (list[i] === n && i + 1 < list.length) return list[i + 1];
      if (list[i].startsWith(`${n}=`)) return list[i].slice(n.length + 1);
    }
  }
  return null;
}

/** Codex の設定の上書き（-c model_reasoning_effort="high" など）。 */
export function codexOverride(argv, key) {
  const list = argv ?? [];
  for (let i = 0; i < list.length - 1; i++) {
    if (list[i] !== "-c" && list[i] !== "--config") continue;
    const m = new RegExp(`^${key}\\s*=\\s*"?([^"]*)"?$`).exec(list[i + 1]);
    if (m) return m[1];
  }
  return null;
}

/** ~/.codex/config.toml の、最初の [表] より前にある model と model_reasoning_effort。 */
export function parseCodexConfig(text) {
  const out = { model: null, effort: null };
  for (const line of (text ?? "").split("\n")) {
    if (/^\s*\[/.test(line)) break;
    const m = /^\s*(model|model_reasoning_effort)\s*=\s*"([^"]*)"/.exec(line);
    if (m) out[m[1] === "model" ? "model" : "effort"] = m[2];
  }
  return out;
}

/**
 * エージェント 1 人の model と effort。手がかりの順:
 * Claude は effort-recorder のキャッシュ（cached）→ 起動引数（--model / --effort）。
 * Codex は起動引数（-m / --model、-c model_reasoning_effort=）→ ~/.codex/config.toml の既定（codexDefaults）。
 */
export function agentModel({ app, argv, cached, codexDefaults }) {
  const codex = /codex/i.test(app ?? "");
  const model = cached?.model || argvValue(argv, codex ? ["-m", "--model"] : ["--model"])
    || (codex ? codexDefaults?.model : null) || null;
  const effort = cached?.effort || (codex ? codexOverride(argv, "model_reasoning_effort") : argvValue(argv, ["--effort"]))
    || (codex ? codexDefaults?.effort : null) || null;
  return { model, effort };
}

// ---- skill（本棚の本） ----

/** skill の出どころと本の色。この順に本棚へ並べる（左上から）。 */
export const SKILL_SOURCES = {
  user: { label: "自分の skill", color: "#4a7fd0" },
  project: { label: "このプロジェクト", color: "#e04545" },
  synced: { label: "claude.ai から同期", color: "#e8804e" },
  plugin: { label: "プラグイン", color: "#3aa050" },
  codex: { label: "Codex", color: "#3fa7a3" },
};

/**
 * SKILL.md（プラグインのコマンドの .md も）の先頭の --- から name・description・user-invocable を読む。
 * 先頭がなければ fallback の名前で、説明なし。description は "..." や、> / | の複数行にも対応。
 */
export function parseSkillFile(text, fallback) {
  const out = { name: fallback, description: "", invocable: true };
  const lines = (text ?? "").split("\n");
  if (lines[0]?.trim() !== "---") return out;
  for (let i = 1; i < lines.length && lines[i].trim() !== "---"; i++) {
    const m = /^([A-Za-z-]+):\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    let value = m[2].trim();
    if (/^[>|][-+]?$/.test(value)) {
      const parts = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) parts.push(lines[++i].trim());
      value = parts.join(" ");
    }
    value = value.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    if (m[1] === "name" && value) out.name = value;
    if (m[1] === "description") out.description = value;
    if (m[1] === "user-invocable") out.invocable = value !== "false";
  }
  return out;
}

/** 本棚の並び（出どころの順、同じ出どころは名前の順）。 */
export function sortSkills(skills) {
  const order = Object.keys(SKILL_SOURCES);
  return [...skills].sort((a, b) => order.indexOf(a.source) - order.indexOf(b.source) || a.id.localeCompare(b.id));
}

/** skill の短い名前（codex:rescue → rescue）。札に出す。 */
export function skillShort(id) {
  return (id ?? "").split(":").pop();
}

/** 使っている skill（office.skill）と本が同じか。片方に名前空間（codex: など）がなければ短い名前で比べる。 */
export function sameSkill(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  return (!a.includes(":") || !b.includes(":")) && skillShort(a) === skillShort(b);
}

/** 本棚に立てる本（1 冊 = 1 つの skill）。座標は本棚の左上から。入りきらない数は more。 */
export function shelfBooks(skills) {
  const per = Math.floor((SHELF.right - SHELF.left) / SHELF.bookW);
  const shown = skills.slice(0, per * SHELF.bases.length);
  return {
    books: shown.map((skill, i) => {
      const h = 7 + (hash(skill.id) % 4);
      return {
        skill,
        x: SHELF.left + (i % per) * SHELF.bookW,
        y: SHELF.bases[Math.floor(i / per)] - h,
        w: SHELF.bookW,
        h,
        color: SKILL_SOURCES[skill.source]?.color ?? "#9aa4b4",
      };
    }),
    more: skills.length - shown.length,
  };
}

export const PLATE_MAX = 16; // 壁の名札に出す名前の長さ（半角 1・全角 2 で数える。herdr-ai-office が 15）

/**
 * 壁の名札に出す名前。長ければ、頭と終わりを残して真ん中を「…」にする（頭の同じ名前、たとえばワークツリーのスペース
 * webapp-v2-fix-login と webapp-v2-add-docs も、終わりで見分けられる）。長さは半角 1・全角 2 で数え、max まで。
 */
export function plateText(name, max = PLATE_MAX) {
  const wide = (ch) => /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/u.test(ch);
  const width = (ch) => (wide(ch) ? 2 : 1);
  const chars = [...(name ?? "")];
  if (chars.reduce((n, ch) => n + width(ch), 0) <= max) return name ?? "";
  const take = (list, room) => {
    const out = [];
    let n = 0;
    for (const ch of list) {
      if (n + width(ch) > room) break;
      out.push(ch);
      n += width(ch);
    }
    return out;
  };
  const head = take(chars, Math.ceil((max - 1) / 2));
  const tail = take([...chars].reverse(), Math.floor((max - 1) / 2)).reverse();
  return `${head.join("")}…${tail.join("")}`;
}

/**
 * 机の名札に出す名前。タブバー（herdr の tabs mod の label）と同じ: 人が付けたタブ名はそのまま。名前のないタブや、
 * プログラムの名前のタブは、エージェントの今のタイトル（Claude Code なら会話の要約）。タイトルが役に立たない
 * （空・アドレス・プログラムの名前・フォルダの道・user@host）ときはタブ名、名前のないタブならプログラムの名前。
 */
export function seatName({ tabName, named, program, title, address }) {
  const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}\p{Ps}\p{Pi}]+/u, "").replace(/^\[ [!.] \] /, "").trim();
  const prog = program?.name;
  const base = named ? tabName : prog ?? tabName ?? "Terminal";
  const live = clean(title);
  const path = /^[~/]|^[A-Za-z]:\\/.test((title ?? "").replace(/^[^\p{L}\p{N}~/]+/u, ""));
  const telling = live && live !== address && live !== prog && !path && !live.includes("@") && live.toLowerCase() !== program?.key;
  return (tabName === prog || !named) && telling ? live : base;
}

/**
 * 状態から動きを決める。act はターミナルのラベル office.act（read / edit / run ...）。
 * type: 席でタイピング、read: 本棚で読む、raise: 手を挙げて待つ、done: 席で ✓、wander: うろうろ
 */
export function behaviorOf(status, act) {
  if (status === "blocked") return "raise";
  if (status === "done") return "done";
  if (status === "working") return act === "read" ? "read" : "type";
  return "wander";
}

// ホワイトボードに出さない .md（明らかにノイズ）: エージェントへの指示や設定（CLAUDE.md・AGENTS.md・GEMINI.md・SKILL.md・
// MEMORY.md と、.claude/・.codex/ などの中）、依存や作ったものの中（node_modules/・vendor/・dist/・build/ など）、.git/ と
// .github/（テンプレート）、決まり文句のファイル（LICENSE・CODE_OF_CONDUCT・SECURITY）。一時フォルダの .md はノイズにしない
// （Claude Code はプロジェクトに入れないファイルを /private/tmp/claude-… の作業フォルダに置くので、頼んだ報告ほどそこにある）
const NOISE_NAMES = /^(claude(\.local)?|agents|gemini|skill|memory|license|code_of_conduct|security)\.(md|markdown)$/i;
const NOISE_DIRS = /\/(\.claude|\.codex|\.cursor|\.gemini|\.git|\.github|node_modules|vendor|dist|build|target|\.venv|venv|\.next|\.cache|coverage)\//;

/** 明らかにノイズの .md か（ホワイトボードに出さない。プランには使わない）。 */
export function isNoiseDoc(path) {
  return NOISE_NAMES.test(path.split("/").pop()) || NOISE_DIRS.test(path);
}

/**
 * 1 つのスペースの部屋。席はエージェントの数 + 1（最後の 1 つは空席で、クリックで雇う）。
 * docs: address → その人が書いたもの [{ path, kind }]（kind: plan はフックが書く office.plan、doc は office.docs）。
 * 部屋にいる人の書いたものだけで（ほかの部屋の人のものは載らない）、明らかにノイズの .md は除く（isNoiseDoc）。
 * どれかがあれば、部屋の壁にホワイトボードを掛ける。room.docs: [{ path, kind, address }]（同じファイルは 1 つ。
 * プランが先、そのあと人ごとの .md）
 */
export function roomOf(space, agentsHere, docs = new Map()) {
  const count = agentsHere.length + 1;
  const deskEnd = DESK_X + DESK_END * 2 + count * SEAT_W;
  const roomDocs = [];
  const seen = new Set();
  const add = (d) => {
    if (seen.has(d.path)) return;
    seen.add(d.path);
    roomDocs.push(d);
  };
  for (const plans of [true, false]) {
    for (const a of agentsHere) {
      for (const d of docs.get(a.address) ?? []) {
        if ((d.kind === "plan") !== plans || (d.kind !== "plan" && isNoiseDoc(d.path))) continue;
        add({ path: d.path, kind: d.kind, address: a.address });
      }
    }
  }
  return {
    id: space.id,
    name: space.name,
    active: !!space.active,
    machine: space.machine ?? null,
    folder: space.folder ?? "",
    status: space.status ?? null,
    w: Math.max(MIN_ROOM_W, deskEnd + 30, roomDocs.length ? BOARD_ROOM_W : 0),
    h: ROOM_H,
    deskEnd,
    docs: roomDocs,
    rightPass: deskEnd + 10,
    seats: Array.from({ length: count }, (_, i) => {
      const segX = DESK_X + DESK_END + i * SEAT_W;
      return { i, segX, cx: segX + 12, agent: agentsHere[i]?.address ?? null };
    }),
  };
}

/**
 * 今開いているタブのエージェント（表示中のスペースの、開いているタブにいる人。タブを分けていれば全員）の address の集まり。
 * spaces は herdr の spaces()（active と tabs[].active）、agents は agents()（tab）。オフィスはこの人たちを、マウスを
 * 乗せたときと同じように、いつも明るくする。
 */
export function openAgents(spaces, agents) {
  const tab = spaces.find((s) => s.active)?.tabs?.find((t) => t.active)?.id;
  return new Set(tab ? agents.filter((a) => a.tab === tab).map((a) => a.address) : []);
}

/** スペースごとに部屋を作る。agents は herdr の agents()（スペース・タブ・ペインの順）。docs は roomOf と同じ。 */
export function roomsOf(spaces, agents, docs = new Map()) {
  return spaces.map((s) => roomOf(s, agents.filter((a) => a.space === s.id), docs));
}


/**
 * 1 枚のフロアに並べる: 廊下の右に部屋をすき間なく左から並べ、幅（廊下を除く）に入らなければ次の列へ。
 * 列の右端はそろえる（列のいちばん右の部屋を広げる）ので、フロアは四角になる。最後に空き部屋を置く。
 * 返す部屋には、フロアの中の位置（ox, oy。部屋の左上）が付く。
 */
export function layoutFloor(rooms, widthArt) {
  const lots = [...rooms, { id: "new-room", newRoom: true, w: NEW_ROOM_W, h: ROOM_H }];
  const avail = Math.max(widthArt - HALL_W, MIN_ROOM_W);
  const rows = [[]];
  let rowW = 0;
  for (const lot of lots) {
    if (rows.at(-1).length && rowW + lot.w > avail) {
      rows.push([]);
      rowW = 0;
    }
    rows.at(-1).push(lot);
    rowW += lot.w;
  }
  const sum = (row) => row.reduce((n, lot) => n + lot.w, 0);
  const width = Math.max(...rows.map(sum));
  const placed = [];
  rows.forEach((row, ri) => {
    const extra = width - sum(row);
    let x = HALL_W;
    row.forEach((lot, i) => {
      const w = lot.w + (i === row.length - 1 ? extra : 0);
      placed.push({ ...lot, w, ox: x, oy: ri * ROOM_H, row: ri });
      x += w;
    });
  });
  return { rooms: placed, w: HALL_W + width, h: rows.length * ROOM_H };
}

// 同じ点が続かないように並べ直す（from と同じ点も除く）
function tidy(from, pts) {
  const out = [];
  for (const p of pts) {
    const last = out.at(-1) ?? from;
    if (last.x !== p.x || last.y !== p.y) out.push(p);
  }
  return out;
}

/**
 * from から to への道（曲がり角の列、from は含まない）。縦横にだけ動く。座標は room の中。
 * 机より奥（y < BACK）と手前を行き来するときは、机の左右の通り道を通る（modern は左だけ。手前は横の廊下で、扉は左にある）。
 * 部屋の左の外（x < 0。廊下や、左の部屋の手前の通路）とは、手前の通路（CORRIDOR_Y）を通って行き来する。
 */
export function planPath(room, from, to) {
  const outside = (p) => p.x < 0;
  if (outside(from) || outside(to)) {
    const door = { x: LEFT_PASS, y: CORRIDOR_Y }; // 部屋の手前の、左の端
    if (outside(from) && outside(to)) return tidy(from, [{ x: from.x, y: to.y }, to]);
    if (outside(to)) return tidy(from, [...planPath(room, from, door), { x: to.x, y: CORRIDOR_Y }, to]);
    return tidy(from, [{ x: from.x, y: CORRIDOR_Y }, door, ...planPath(room, door, to)]);
  }
  // 机より奥。modern の机の右の床（ガラスの壁まで）も、机の奥の通路から縦に行けるので奥と同じに扱う
  const back = (p) => p.y < BACK || (GLASS !== null && p.y < GLASS.y && p.x >= room.rightPass);
  const pts = [];
  const go = (x, y) => {
    const last = pts.at(-1) ?? from;
    if (last.x !== x || last.y !== y) pts.push({ x, y });
  };
  if (back(from) && back(to)) {
    go(from.x, LANE_Y);
    go(to.x, LANE_Y);
    go(to.x, to.y);
  } else if (!back(from) && !back(to)) {
    go(to.x, from.y);
    go(to.x, to.y);
  } else {
    const cost = (x) => Math.abs(from.x - x) + Math.abs(x - to.x);
    const pass = !RIGHT_EXIT || cost(LEFT_PASS) <= cost(room.rightPass) ? LEFT_PASS : room.rightPass;
    if (back(from)) {
      go(from.x, LANE_Y);
      go(pass, LANE_Y);
      go(pass, to.y);
      go(to.x, to.y);
    } else {
      go(pass, from.y);
      go(pass, LANE_Y);
      go(to.x, LANE_Y);
      go(to.x, to.y);
    }
  }
  return pts;
}

const HALL_X = HALL_W / 2; // 廊下を上下に歩くときの x（フロア全体の座標）

/** フロア全体の座標の点がある部屋（廊下なら null）。空き部屋は数えない。 */
export function roomAt(rooms, p) {
  return rooms.find((r) => !r.newRoom && p.x >= r.ox && p.x < r.ox + r.w && p.y >= r.oy && p.y < r.oy + r.h) ?? null;
}

/**
 * 部屋をドラッグして落とす先: フロア全体の座標の点 p にある、from（ドラッグしている部屋の id）とは別の部屋。
 * 同じマシンの部屋だけ（herdr のスペースの一覧と同じ）。廊下・空き部屋・自分の部屋なら null。
 * side は差し込む印を出す側: 後ろの部屋へ動かすならその部屋の右（後ろに入る）、前の部屋へなら左（前に入る）。
 */
export function dropTarget(rooms, from, p) {
  const list = rooms.filter((r) => !r.newRoom);
  const source = list.find((r) => r.id === from);
  const over = roomAt(list, p);
  if (!source || !over || over === source || (over.machine ?? null) !== (source.machine ?? null)) return null;
  return { id: over.id, side: list.indexOf(source) < list.indexOf(over) ? "right" : "left" };
}

/**
 * フロアの上の道（曲がり角の列、from は含まない）。座標はフロア全体で、from と to は部屋の中か廊下の点。
 * 同じ部屋の中は planPath。部屋を出るときは手前の通路へ（左の扉。classic で同じ列の右の部屋へ行くなら右の通り道から）。
 * 同じ列の部屋へは通路を横に、違う列の部屋や廊下へは、通路を廊下まで歩いて廊下を上下に。入るときは相手の部屋の左の扉から。
 */
export function floorPath(rooms, from, to) {
  const a = roomAt(rooms, from);
  const b = roomAt(rooms, to);
  const local = (room, p) => ({ x: p.x - room.ox, y: p.y - room.oy });
  const global = (room, pts) => pts.map((p) => ({ x: p.x + room.ox, y: p.y + room.oy }));
  if (a && b && a.id === b.id) return global(a, planPath(a, local(a, from), local(a, to)));
  const pts = [];
  let at = from;
  if (a) {
    const exit = { x: RIGHT_EXIT && b && b.oy === a.oy && b.ox > a.ox ? a.rightPass : LEFT_PASS, y: CORRIDOR_Y };
    pts.push(...global(a, planPath(a, local(a, from), exit)));
    at = { x: a.ox + exit.x, y: a.oy + exit.y };
  }
  if (a && b && b.oy === a.oy) {
    pts.push({ x: b.ox + LEFT_PASS, y: at.y }); // 同じ列: 手前の通路を横に
  } else {
    const y = b ? b.oy + CORRIDOR_Y : to.y;
    const x = at.x < HALL_W ? at.x : HALL_X;
    pts.push({ x, y: at.y }, { x, y }, b ? { x: b.ox + LEFT_PASS, y } : to); // 廊下まで歩いて、上下に
  }
  if (b) pts.push(...global(b, planPath(b, { x: LEFT_PASS, y: CORRIDOR_Y }, local(b, to))));
  return tidy(from, pts);
}

/** キャラクターたちの今（位置・行き先・座っているか）。View が 1 つ持ち、tick で進める。 */
export class Office {
  constructor(rng = Math.random) {
    this.rng = rng;
    this.chars = new Map(); // address -> キャラ
    this.rooms = []; // 今の部屋の並び（sync のたびに）。ほかの部屋へ行く道に使う
    this.t = 0; // tick の数（コマ送りに使う）
    this.clock = 0; // tick で進んだ時間（ms）
  }

  /**
   * 部屋とエージェントの今に合わせる。info: address -> { status, app, kind, act, title, ... }。
   * 新しいエージェントは自分の席の後ろから始める。いなくなったエージェントは消す。
   */
  sync(rooms, info) {
    this.rooms = rooms;
    const seen = new Set();
    const talks = []; // 話しかけた出来事（送った人 → 相手）。全員をそろえてから、相手を探して行かせる
    for (const room of rooms) {
      for (const seat of room.seats) {
        if (!seat.agent) continue;
        const a = info.get(seat.agent) ?? {};
        seen.add(seat.agent);
        let c = this.chars.get(seat.agent);
        if (!c || c.room !== room.id) {
          c = { address: seat.agent, room: room.id, x: seat.cx, y: LANE_Y, path: [], seated: false, facing: "r",
            behavior: null, wait: 0, phase: hash(seat.agent) % 24 };
          this.chars.set(seat.agent, c);
        }
        const moved = c.seat && c.seat.cx !== seat.cx;
        const origin = `${room.ox},${room.oy}`;
        // 窓の幅が変わって部屋が並び直すと、部屋の外（廊下・ほかの部屋）の座標はずれる。部屋の手前に戻して歩き直す
        const outside = (p) => p.x < 0 || p.x >= room.w || p.y < 0 || p.y >= room.h;
        const relocated = c.origin !== undefined && c.origin !== origin && (outside(c) || c.path.some(outside));
        if (relocated) {
          c.x = LEFT_PASS;
          c.y = CORRIDOR_Y;
          c.path = [];
          c.seated = false;
        }
        c.origin = origin;
        c.seat = seat;
        c.roomRef = room;
        c.info = a;
        c.look = { look: lookOf(a.app, a.model), band: bandOf(a.effort), flame: a.effort === "max" };
        // 出来事のラベル（フックが書く office.skill_at・office.talk_at・office.heard_at）: 値が変わったら出来事。
        // 初めて見た値は出来事にしない
        const happened = (key, value) => {
          if (c[key] === undefined) {
            c[key] = value ?? null;
            return false;
          }
          if (!value || value === c[key]) return false;
          c[key] = value;
          return true;
        };
        // skill を使った: 資料室へ取りに行って読む（left: 着いてから読む残り時間）
        let errandNow = false;
        if (happened("skillAt", a.skillAt) && a.skill) {
          c.errand = { kind: "skill", skill: a.skill, left: null };
          errandNow = true;
        }
        // hc send で話しかけた（送った人のフック）か、話しかけられた（受け取った人のフック）
        if (happened("talkAt", a.talkAt)) talks.push({ from: c.address, to: a.talk, text: a.talkText, sender: true });
        if (happened("heardAt", a.heardAt)) talks.push({ from: a.heard, to: c.address, text: a.heardText, sender: false });
        let b = behaviorOf(a.status, a.act);
        if (c.errand && b === "raise") c.errand = null; // 質問・許可待ちは用事より先（すぐ手を挙げる）
        if (c.errand) b = c.errand.kind === "talk" ? "visit" : "read"; // 用事の途中は、エージェントが次に移っても続ける
        if (errandNow || b !== c.behavior || relocated || (moved && b !== "wander" && b !== "read")) this.retarget(c, b);
      }
    }
    for (const k of [...this.chars.keys()]) if (!seen.has(k)) this.chars.delete(k);
    for (const e of talks) this.visit(this.chars.get(this.resolve(e.from)), this.resolve(e.to), e.text, e.sender);
    // 話しかけに行く途中・話している間に、相手がいなくなったら戻る。相手の居場所が変わったら（作業を受けて席に座るなど）追い直す
    for (const c of this.chars.values()) {
      if (c.errand?.kind !== "talk") continue;
      const partner = this.chars.get(c.errand.to);
      if (!partner) {
        c.errand = null;
        c.returning = true;
        this.retarget(c, behaviorOf(c.info.status, c.info.act));
        continue;
      }
      const spot = this.visitSpot(partner);
      if (!c.errand.spot || Math.abs(spot.x - c.errand.spot.x) + Math.abs(spot.y - c.errand.spot.y) > 6) {
        c.errand.left = null;
        this.retarget(c, "visit");
      }
    }
  }

  /** hc send の相手の名前から、オフィスにいるエージェントの address: アドレス → hc の名前 → タブの名前の順。いなければ null。 */
  resolve(target) {
    if (!target) return null;
    if (this.chars.has(target)) return target;
    const all = [...this.chars.values()];
    return (all.find((c) => c.info?.tname === target) ?? all.find((c) => c.info?.tab === target))?.address ?? null;
  }

  /**
   * c が to（address）へ話しかけに行く。text は送った文（札に出す）。自分あて・相手がいない・手を挙げている間は行かない。
   * 受け取った側の出来事（sender が false）は、同じ相手へ行っている途中や、行ったばかりなら数えない（送った側と重なる）。
   */
  visit(c, to, text, sender) {
    if (!c || !to || to === c.address || !this.chars.has(to) || c.info?.status === "blocked") return;
    const recent = c.errand?.kind === "talk" && c.errand.to === to
      || (c.lastTalk?.to === to && this.clock - c.lastTalk.at < TALK_DEDUP_MS);
    if (!sender && recent) return;
    c.errand = { kind: "talk", to, text: text || null, left: null, spot: null }; // left: 着いてから話す残り時間
    c.lastTalk = { to, at: this.clock };
    this.retarget(c, "visit");
  }

  // 話しかけた相手が歩いている途中か
  partnerMoving(c) {
    return c.errand?.kind === "talk" && (this.chars.get(c.errand.to)?.path.length ?? 0) > 0;
  }

  // 部屋の座標（キャラの部屋の左上から）とフロア全体の座標
  origin(c) {
    const { ox = HALL_W, oy = 0 } = c.roomRef;
    return { ox, oy };
  }

  global(c, p = c) {
    const { ox, oy } = this.origin(c);
    return { x: ox + p.x, y: oy + p.y };
  }

  local(c, p) {
    const { ox, oy } = this.origin(c);
    return { x: p.x - ox, y: p.y - oy };
  }

  // ほかの部屋にいるか（話しかけに行ったあとなど）。廊下は自分の部屋の道（planPath）で戻れるので含めない
  away(c) {
    const r = roomAt(this.rooms, this.global(c));
    return !!r && r.id !== c.room;
  }

  // ほかの部屋を通る道（キャラの部屋の座標で）
  route(c, goal) {
    return floorPath(this.rooms, this.global(c), this.global(c, goal)).map((p) => this.local(c, p));
  }

  /**
   * 話しかける相手のそばの、立つ所（フロア全体の座標）。相手が席にいる・席へ向かう（作業中・完了・手を挙げる）なら、
   * その椅子の後ろの通路の右。立っているなら、次に止まる所の左（入らなければ右）。
   */
  visitSpot(p) {
    const { ox, oy } = this.origin(p);
    if (p.seated || ["type", "done", "raise"].includes(p.behavior)) {
      return { x: ox + p.seat.cx + (p.behavior === "raise" ? 16 : 12), y: oy + LANE_Y };
    }
    const end = p.path.at(-1) ?? p;
    const x = Math.round(ox + end.x);
    const y = Math.round(oy + end.y);
    const here = roomAt(this.rooms, { x, y });
    const side = GLASS && here && y - here.oy >= BACK && y - here.oy < GLASS.y; // modern の机の右の床（机の前には立たない）
    const lo = here ? here.ox + (side ? here.rightPass : LEFT_PASS) : 6;
    const hi = here ? here.ox + here.w - (side ? 28 : 10) : HALL_W - 6;
    return { x: x - 14 >= lo ? x - 14 : Math.min(x + 14, hi), y };
  }

  retarget(c, behavior) {
    const sits = (b) => b === "type" || b === "done";
    if (behavior === "visit" && !this.chars.has(c.errand?.to)) {
      c.errand = null; // 相手がもういない
      behavior = behaviorOf(c.info.status, c.info.act);
    }
    c.behavior = behavior;
    if (behavior !== "read") c.spot = undefined;
    if (c.seated && sits(behavior) && c.sitX === c.seat.cx) return; // 座ったまま
    if (c.seated) {
      c.seated = false; // 席を立って、座っていた椅子の後ろに出る（席がずれたなら、そこから新しい席へ歩く）
      c.x = c.sitX;
      c.y = LANE_Y;
    }
    c.wait = 0;
    const away = this.away(c);
    if (behavior === "wander" && !away) {
      c.path = [];
      c.wait = 400 + this.rng() * 1500; // 少し間をおいて歩きだす
      return;
    }
    let goal;
    if (behavior === "visit") {
      c.errand.spot = this.visitSpot(this.chars.get(c.errand.to));
      goal = this.local(c, c.errand.spot);
    } else if (behavior === "read") goal = this.librarySpot(c);
    else if (behavior === "wander") goal = this.wanderTarget(c.roomRef); // ほかの部屋からは、まず自分の部屋へ
    else goal = { x: c.seat.cx, y: LANE_Y };
    c.path = behavior === "visit" || away ? this.route(c, goal) : planPath(c.roomRef, c, goal);
    // 資料室へ行くとき（skill を取りに行く・調べ物）、話しかけに行くとき、廊下やほかの部屋から戻るときは小走り
    c.run = behavior === "read" || behavior === "visit" || c.returning === true || c.x < 0 || away;
    c.returning = false;
    if (!c.path.length) this.arrive(c);
  }

  // 資料室で読む場所（部屋の中の座標で）。ほかの人がいない場所のうち、本棚にいちばん近いところ
  librarySpot(c) {
    const taken = new Set([...this.chars.values()].filter((o) => o !== c && o.spot !== undefined).map((o) => o.spot));
    let i = 0;
    while (taken.has(i) && i < LIBRARY.length - 1) i++;
    c.spot = i;
    const { ox = HALL_W, oy = 0 } = c.roomRef;
    return { x: LIBRARY[i].x - ox, y: LIBRARY[i].y - oy };
  }

  arrive(c) {
    c.run = false;
    if (c.behavior === "type" || c.behavior === "done") {
      c.seated = true;
      c.sitX = c.seat.cx;
    }
    if (c.behavior === "wander") c.wait = 3000 + this.rng() * 6000;
    if (c.errand?.kind === "skill" && c.behavior === "read") c.errand.left = ERRAND_READ_MS; // 資料室に着いた: ここから読む
    if (c.errand?.kind === "talk" && c.behavior === "visit") {
      c.errand.left = TALK_MS; // 相手のそばに着いた: ここから話す。相手の方を向く
      const partner = this.chars.get(c.errand.to);
      if (partner) c.facing = this.global(partner).x < this.global(c).x ? "l" : "r";
    }
  }

  // うろうろする行き先。modern は部屋の中だけ（横の廊下へ出ると、どの部屋の人か分かりにくい）: 机の奥の通路か、
  // 机の右の床（植木の手前まで。机が部屋いっぱいなら通路だけ）。classic は手前の床か、机の奥の通路
  wanderTarget(room) {
    if (GLASS) {
      const right = room.w - 28;
      if (right > room.rightPass && this.rng() < 0.5) {
        return {
          x: room.rightPass + Math.round(this.rng() * (right - room.rightPass)),
          y: BACK + 2 + Math.round(this.rng() * (GLASS.y - 4 - BACK)),
        };
      }
    } else if (this.rng() < 0.65) {
      return {
        x: 16 + Math.round(this.rng() * (room.w - 32)),
        y: FRONT_Y[0] + Math.round(this.rng() * (FRONT_Y[1] - FRONT_Y[0])),
      };
    }
    return { x: LEFT_PASS + Math.round(this.rng() * (room.w - 2 * LEFT_PASS)), y: LANE_Y };
  }

  /** dt ミリ秒ぶん進める。何か変わったら true（描き直しが要る）。 */
  tick(dt) {
    this.t++;
    this.clock += dt;
    let changed = false;
    // 話しかけられている人（相手が向かっている・話している）は、うろうろを始めない
    const visited = new Set([...this.chars.values()].filter((c) => c.errand?.kind === "talk").map((c) => c.errand.to));
    for (const c of this.chars.values()) {
      // 用事（skill を読む・話す）: 終わったら、今の状態の動きに戻る（席へは小走り）
      // 話すのは、相手も止まってから（作業を受けて席へ戻る途中なら、座るのを待つ）
      if (c.errand && c.errand.left !== null && !c.path.length && !this.partnerMoving(c)) {
        c.errand.left -= dt;
        if (c.errand.left <= 0) {
          c.errand = null;
          c.returning = true;
          this.retarget(c, behaviorOf(c.info.status, c.info.act));
          changed = true;
        }
      }
      if (c.path.length) {
        let budget = ((c.run ? RUN_SPEED : SPEED) * dt) / 1000;
        while (budget > 0 && c.path.length) {
          const p = c.path[0];
          const dx = p.x - c.x;
          const dy = p.y - c.y;
          if (dx) c.facing = dx > 0 ? "r" : "l";
          const d = Math.abs(dx) + Math.abs(dy);
          if (d <= budget) {
            c.x = p.x;
            c.y = p.y;
            c.path.shift();
            budget -= d;
          } else {
            if (dx) c.x += Math.sign(dx) * budget;
            else c.y += Math.sign(dy) * budget;
            budget = 0;
          }
        }
        if (!c.path.length) this.arrive(c);
        changed = true;
      } else if (c.behavior === "wander" && !visited.has(c.address)) {
        c.wait -= dt;
        if (c.wait <= 0) {
          c.path = planPath(c.roomRef, c, this.wanderTarget(c.roomRef));
          changed = true;
        }
      }
    }
    return changed;
  }
}

/**
 * 壁時計の針の向き（12 方向のどれか）。min はその場所の 0 時からの分（placeClock）。時針は時の数だけで決め
 * （切り捨て。2:31 でも 2 時を指す）、分針は 5 分ごと。絵は img/clock-h-<h>.png と img/clock-m-<m>.png。
 */
export function clockHands(min) {
  return { h: Math.floor(min / 60) % 12, m: Math.floor((min % 60) / 5) };
}

// ---- 場所（壁時計の時刻と、窓の外の空と天気） ----

/**
 * 選べる場所（壁時計をクリックして選ぶ。壁時計の時刻・窓の空・天気がその場所になる）。東から西の順。
 * std は冬の UTC からの分、dst は夏時間の決まり（us: 米国、eu: 欧州、au: 豪州の南東部。null はなし）。
 * mod の中には Intl がないので、夏時間は dst の決まりで計算する（tz は IANA の名前。bun test で Intl と比べる）。
 */
export const PLACES = [
  { id: "sydney", name: "シドニー", lat: -33.8688, lon: 151.2093, std: 600, dst: "au", tz: "Australia/Sydney" },
  { id: "tokyo", name: "東京", lat: 35.6895, lon: 139.6917, std: 540, dst: null, tz: "Asia/Tokyo" },
  { id: "seoul", name: "ソウル", lat: 37.5665, lon: 126.978, std: 540, dst: null, tz: "Asia/Seoul" },
  { id: "shanghai", name: "上海", lat: 31.2304, lon: 121.4737, std: 480, dst: null, tz: "Asia/Shanghai" },
  { id: "taipei", name: "台北", lat: 25.033, lon: 121.5654, std: 480, dst: null, tz: "Asia/Taipei" },
  { id: "singapore", name: "シンガポール", lat: 1.3521, lon: 103.8198, std: 480, dst: null, tz: "Asia/Singapore" },
  { id: "bangkok", name: "バンコク", lat: 13.7563, lon: 100.5018, std: 420, dst: null, tz: "Asia/Bangkok" },
  { id: "delhi", name: "デリー", lat: 28.6139, lon: 77.209, std: 330, dst: null, tz: "Asia/Kolkata" },
  { id: "dubai", name: "ドバイ", lat: 25.2048, lon: 55.2708, std: 240, dst: null, tz: "Asia/Dubai" },
  { id: "moscow", name: "モスクワ", lat: 55.7558, lon: 37.6173, std: 180, dst: null, tz: "Europe/Moscow" },
  { id: "berlin", name: "ベルリン", lat: 52.52, lon: 13.405, std: 60, dst: "eu", tz: "Europe/Berlin" },
  { id: "paris", name: "パリ", lat: 48.8566, lon: 2.3522, std: 60, dst: "eu", tz: "Europe/Paris" },
  { id: "london", name: "ロンドン", lat: 51.5074, lon: -0.1278, std: 0, dst: "eu", tz: "Europe/London" },
  { id: "sao-paulo", name: "サンパウロ", lat: -23.5505, lon: -46.6333, std: -180, dst: null, tz: "America/Sao_Paulo" },
  { id: "new-york", name: "ニューヨーク", lat: 40.7128, lon: -74.006, std: -300, dst: "us", tz: "America/New_York" },
  { id: "chicago", name: "シカゴ", lat: 41.8781, lon: -87.6298, std: -360, dst: "us", tz: "America/Chicago" },
  { id: "denver", name: "デンバー", lat: 39.7392, lon: -104.9903, std: -420, dst: "us", tz: "America/Denver" },
  { id: "los-angeles", name: "ロサンゼルス", lat: 34.0522, lon: -118.2437, std: -480, dst: "us", tz: "America/Los_Angeles" },
  { id: "honolulu", name: "ホノルル", lat: 21.3069, lon: -157.8583, std: -600, dst: null, tz: "Pacific/Honolulu" },
];
/** 東京（場所を選べるようにする前は、窓の外はいつも東京だった。関数の場所の既定）。 */
export const TOKYO = PLACES.find((p) => p.id === "tokyo");
const DAY_MS = 86400000;

// その年のその月（0 始まり）の n 番目の日曜日の日にち（n が -1 なら最後の日曜日）
function sundayOf(year, month, n) {
  if (n > 0) return 1 + ((7 - new Date(Date.UTC(year, month, 1)).getUTCDay()) % 7) + (n - 1) * 7;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return last - new Date(Date.UTC(year, month, last)).getUTCDay();
}

/** その時刻（ms）の、その場所の UTC からの分（夏時間なら std + 60）。 */
export function offsetAt(place, ms) {
  const { std, dst } = place;
  if (!dst) return std;
  const year = new Date(ms + std * 60000).getUTCFullYear();
  const local = (month, n, hour) => Date.UTC(year, month, sundayOf(year, month, n), hour) - std * 60000; // その場所の標準時で
  const utc = (month, n, hour) => Date.UTC(year, month, sundayOf(year, month, n), hour);
  let summer = false;
  // 米国: 3 月の第 2 日曜 2 時から、11 月の第 1 日曜 2 時（夏時間の。標準時の 1 時）まで
  if (dst === "us") summer = ms >= local(2, 2, 2) && ms < local(10, 1, 1);
  // 欧州: 3 月の最後の日曜から 10 月の最後の日曜まで（どちらも UTC の 1 時）
  if (dst === "eu") summer = ms >= utc(2, -1, 1) && ms < utc(9, -1, 1);
  // 豪州の南東部: 10 月の第 1 日曜 2 時から、4 月の第 1 日曜 3 時（夏時間の。標準時の 2 時）まで（南半球なので年をまたぐ）
  if (dst === "au") summer = ms < local(3, 1, 2) || ms >= local(9, 1, 2);
  return summer ? std + 60 : std;
}

/** UTC からの分を "UTC+9" "UTC−4" "UTC+5:30" に。 */
export function offsetLabel(min) {
  const sign = min < 0 ? "−" : "+";
  const a = Math.abs(min);
  return `UTC${sign}${Math.floor(a / 60)}${a % 60 ? `:${String(a % 60).padStart(2, "0")}` : ""}`;
}

/** Mac の時差（分）にいちばん近い場所（同じなら一覧の順。日本なら東京）。場所をまだ選んでいないときに使う。 */
export function defaultPlace(offsetMin, ms) {
  let best = TOKYO;
  let gap = Infinity;
  for (const p of PLACES) {
    const d = Math.abs(offsetAt(p, ms) - offsetMin);
    if (d < gap) {
      best = p;
      gap = d;
    }
  }
  return best;
}

/** その場所の 0 時からの分（0..1439）と "HH:MM"。 */
export function placeClock(place, ms) {
  const min = Math.floor(((ms / 60000 + offsetAt(place, ms)) % 1440 + 1440) % 1440);
  const two = (n) => String(n).padStart(2, "0");
  return { min, text: `${two(Math.floor(min / 60))}:${two(min % 60)}` };
}

/** その場所のその日（ms の日）の 0 時から min 分の時刻（ms）。夏時間の切り替わる日は 1 時間ずれることがある（窓の試しには十分）。 */
export function placeAt(place, ms, min) {
  const offset = offsetAt(place, ms) * 60000;
  return Math.floor((ms + offset) / DAY_MS) * DAY_MS - offset + min * 60000;
}

/**
 * 太陽の高さ（度。地平線が 0、下はマイナス）と、南中より前（午前）か。
 * 簡易な天文の式で、日の出・日の入りの時刻にして 1〜2 分の誤差（窓の空には十分）。
 */
export function sunAt(ms, { lat, lon } = TOKYO) {
  const rad = Math.PI / 180;
  const d = ms / DAY_MS - 10957.5; // 2000-01-01 12:00 UTC からの日数
  const g = (357.529 + 0.98560028 * d) * rad; // 平均近点角
  const q = 280.459 + 0.98564736 * d; // 平均黄経
  const ecl = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad; // 黄経
  const tilt = (23.439 - 0.00000036 * d) * rad; // 地軸の傾き
  const ra = Math.atan2(Math.cos(tilt) * Math.sin(ecl), Math.cos(ecl)); // 赤経
  const dec = Math.asin(Math.sin(tilt) * Math.sin(ecl)); // 赤緯
  const gmst = 18.697374558 + 24.06570982441908 * d; // グリニッジ恒星時（時）
  const turn = 2 * Math.PI;
  let ha = (((gmst * 15 + lon) * rad - ra) % turn + turn) % turn; // 時角
  if (ha > Math.PI) ha -= turn;
  const el = Math.asin(Math.sin(lat * rad) * Math.sin(dec) + Math.cos(lat * rad) * Math.cos(dec) * Math.cos(ha));
  return { elevation: el / rad, morning: ha < 0 };
}

/**
 * その場所のその日の日の出と日の入り（0 時からの分）。太陽の上の縁が地平線を通るとき（高さ −0.833°、
 * 大気で浮き上がる分を含む）。1 分ずつ見る。
 */
export function sunTimes(ms, place = TOKYO) {
  const start = placeAt(place, ms, 0);
  let rise = null;
  let set = null;
  let prev = sunAt(start, place).elevation;
  for (let m = 1; m < 1440; m++) {
    const el = sunAt(start + m * 60000, place).elevation;
    if (rise === null && prev < -0.833 && el >= -0.833) rise = m;
    if (set === null && prev >= -0.833 && el < -0.833) set = m;
    prev = el;
  }
  return { rise, set };
}

/**
 * 窓の空の時間帯（太陽の高さで）: 夜 → 薄明（日の出前・日の入り後の青い空）→ 朝焼け / 夕焼け → 昼。
 * 朝焼けと夕焼けは、日の出の 20 分ほど前から 30 分ほど後まで（日の入りはその逆）。
 */
export function skyPhase({ elevation, morning }) {
  if (elevation >= 5) return "day";
  if (elevation >= -4) return morning ? "dawn" : "dusk";
  if (elevation >= -10) return "twilight";
  return "night";
}

/** 試すときの時間帯の時刻（その場所のその日の、だいたいまんなか。0 時からの分）。薄明は夕方の。 */
export function phaseMinute(ms, phase, place = TOKYO) {
  const { rise, set } = sunTimes(ms, place);
  const at = { night: 0, dawn: rise + 10, day: 12 * 60, dusk: set - 10, twilight: set + 25 };
  return Object.prototype.hasOwnProperty.call(at, phase) ? at[phase] : null;
}

export const WEATHER_MS = 15 * 60 * 1000; // 天気を取り直す間隔（Open-Meteo の今の天気は 15 分ごとに新しくなる）
export const RAIN_FRAMES = 4; // img/sky/rain-<n>.png
export const SNOW_FRAMES = 8; // img/sky/snow-<n>.png

/**
 * WMO の天気コード（Open-Meteo の weather_code）→ 窓の空模様（cover: clear / cloudy / overcast）と、
 * 重ねるもの（fx: rain / snow / thunder か null）、ツールチップの名前。霧は曇り。知らないコードは晴れ。
 */
export function weatherOf(code) {
  const c = Number(code);
  const w = (cover, fx, label) => ({ code: c, cover, fx, label });
  if (c === 0) return w("clear", null, "快晴");
  if (c === 1) return w("clear", null, "晴れ");
  if (c === 2) return w("cloudy", null, "晴れ時々曇り");
  if (c === 3) return w("overcast", null, "曇り");
  if (c === 45 || c === 48) return w("overcast", null, "霧");
  if (c >= 51 && c <= 57) return w("overcast", "rain", "霧雨");
  if (c >= 61 && c <= 67) return w("overcast", "rain", { 61: "小雨", 65: "大雨" }[c] ?? "雨");
  if (c >= 71 && c <= 77) return w("overcast", "snow", { 71: "小雪", 75: "大雪" }[c] ?? "雪");
  if (c >= 80 && c <= 82) return w("overcast", "rain", "にわか雨");
  if (c === 85 || c === 86) return w("overcast", "snow", "にわか雪");
  if (c >= 95 && c <= 99) return w("overcast", "thunder", "雷雨");
  return w("clear", null, "晴れ（天気コード不明）");
}

/** 試すときの天気（herdr-app do ai-office.sky-rain など）と、その代表の天気コード。 */
export const TRIAL_WEATHER = { clear: 0, cloudy: 2, overcast: 3, fog: 45, rain: 63, snow: 73, thunder: 95 };

/** Open-Meteo の応答（current の weather_code・temperature_2m・time）から今の天気。読めなければ null。 */
export function parseWeather(json, fetchedAt) {
  const cur = json?.current;
  if (typeof cur?.weather_code !== "number") return null;
  const temp = typeof cur.temperature_2m === "number" ? cur.temperature_2m : null;
  return { ...weatherOf(cur.weather_code), temp, time: cur.time ?? null, fetchedAt };
}

/**
 * 窓の外の絵（img/ の下の名前を奥から順に: 空、その場所の街並みと名物（view/<場所>-<時間帯>）、雨や雪、窓枠 frame
 * （テーマの WINDOW: window は十字の桟、window-slide は 2 枚の引き違い）。
 * ms は空の時刻、weather は weatherOf か null（晴れ）、
 * t はコマ送りの数。雨と雪は 2 コマに 1 回進む（雨のためだけに毎コマ描き直さない）。雷は 24 コマごとに 2 回光る。
 * key は絵が変わったかを見るため（同じなら描き直さない）。
 */
export function windowView(ms, weather, t, place = TOKYO, frame = "window") {
  const phase = skyPhase(sunAt(ms, place));
  const fx = weather?.fx ?? null;
  const step = Math.floor(t / 2);
  const layers = [`sky/${phase}-${weather?.cover ?? "clear"}`, `view/${place.id}-${phase}`];
  if (fx === "rain" || fx === "thunder") layers.push(`sky/rain-${step % RAIN_FRAMES}`);
  if (fx === "snow") layers.push(`sky/snow-${step % SNOW_FRAMES}`);
  if (fx === "thunder" && (t % 24 === 0 || t % 24 === 2)) layers.push("sky/flash");
  layers.push(frame);
  return { phase, layers, key: layers.join("+") };
}

/** 窓のツールチップ: その場所の時刻と天気（と気温）。試し中なら戻し方も。 */
export function windowTip(ms, weather, trial = false, place = TOKYO) {
  const now = weather ? (weather.temp == null ? weather.label : `${weather.label} ${Math.round(weather.temp)}°C`) : "天気はまだ分かりません";
  const tip = `${place.name} ${placeClock(place, ms).text} · ${now}`;
  return trial ? `${tip}（試し中。herdr-app do ai-office.sky-auto で本物に戻す）` : tip;
}

/**
 * 窓を試すコマンド（herdr-app do ai-office.sky-<なに>）: 天気（TRIAL_WEATHER の名前）、その場所の時刻（1930 のように 4 桁）、
 * 時間帯（night / twilight / dawn / day / dusk）、auto（どちらも本物に戻す）。
 * 変える項目だけを返す（{ weather?, time? }。time は 0 時からの分、null は本物）。ほかのコマンドは null。
 */
export function parseSkyCommand(command, ms, place = TOKYO) {
  const m = /^sky-([a-z0-9]+)$/.exec(command ?? "");
  if (!m) return null;
  const word = m[1];
  if (word === "auto") return { weather: null, time: null };
  if (Object.prototype.hasOwnProperty.call(TRIAL_WEATHER, word)) return { weather: word };
  const hm = /^(\d\d)(\d\d)$/.exec(word);
  if (hm) return Number(hm[1]) < 24 && Number(hm[2]) < 60 ? { time: Number(hm[1]) * 60 + Number(hm[2]) } : null;
  const min = phaseMinute(ms, word, place);
  return min === null ? null : { time: min };
}

/** 話しかけるときの札の文（空白をまとめ、長ければ切る）。 */
export function talkLabel(text) {
  const chars = [...String(text ?? "").replace(/\s+/g, " ").trim()];
  return chars.length > 14 ? `${chars.slice(0, 13).join("")}…` : chars.join("");
}

/** 誰かが小走りしているか（コマ送りを速くする）。 */
export function running(office) {
  for (const c of office.chars.values()) if (c.run && c.path.length) return true;
  return false;
}

/** 今のコマが動きを含むか（含まなければ tick しても絵は変わらない）。 */
export function animating(office) {
  for (const c of office.chars.values()) {
    if (c.path.length || ["type", "raise", "read", "visit"].includes(c.behavior)) return true;
    if (c.behavior === "wander") return true; // まばたきと、次に歩きだすまでの待ち
  }
  return false;
}

/**
 * 1 つの部屋に描くもの（部屋の中の座標。廊下へ出ている人は x < 0）。奥から手前の順（z の小さい順）に並べて返す。
 * 1 つ 1 つ: { id, img, over?, books?, tile?, x, y, w, h, z, click?, right?, tip?, glow?, char?, owner? } か、
 * 札 { id, text, color, x（中心）, y, z } か、机の名札 { id, plate（名前）, x, y, w, h, z, owner, click, tip }。
 * click と right は、左クリックと右クリックでする事（main.js の act）。owner はそのものの持ち主のエージェント（キャラ・PC・
 * 名札）。main.js は、どれかにマウスが乗ると、同じ持ち主のものを一緒に光らせる。
 * img と over（上に重ねる絵）は img/ の下の名前（.png なし）。books は本棚の上に描く本（shelfBooks、本棚の左上から）。
 * tile があれば、img（幅 tile）を w の幅まで横に並べる（ガラスの壁）。src があれば img/ でなくその絵（テーマの絵）。
 * skills は資料室の本棚の skill（札の色に使う）。
 */
export function drawables(room, office, skills = []) {
  const out = [];
  const add = (d) => out.push(d);
  const colorOf = (id) => SKILL_SOURCES[skills.find((x) => sameSkill(id, x.id))?.source]?.color ?? "#9aa4b4";
  // 話している 2 人: 話しかけた人が相手のそばに着いてから、TALK_TURN_MS ずつ交互に話す（0: 話しかけた人、1: 相手）
  const talking = (c) => c.errand?.kind === "talk" && c.errand.left !== null && !c.path.length && !office.partnerMoving(c);
  const turnOf = (c) => Math.floor((TALK_MS - c.errand.left) / TALK_TURN_MS) % 2;
  const answering = new Set(); // 今が自分の番の、話しかけられている人
  for (const c of office.chars.values()) if (talking(c) && turnOf(c) === 1) answering.add(c.errand.to);
  const talkBubble = (c, x, y) => add({ id: `talk-${c.address}`, img: "bubble-talk", x, y, w: 13, h: 14, z: 1000 });
  add({ id: "plant", img: "plant", x: room.w - 18, y: BACK + 4, w: 12, h: 17, z: 95 });
  // ガラスの部屋（テーマの glass）の手前のガラスの壁と扉: 机・植木・部屋の中の人より手前、横の廊下を歩く人より奥。
  // ガラスはテーマの images.glass を横に並べる（tile）。扉（images.door）は通り道 LEFT_PASS を真ん中に 16 開いていて、
  // 両側に柱、開けた戸は右のガラスの手前に寄せてある。src はテーマのフォルダの絵（main.js は img より src を使う）
  if (GLASS) {
    const door = LEFT_PASS - 10; // 扉の左の柱
    const z = GLASS.y + GLASS.h;
    add({ id: "glass", img: "glass", src: IMAGES.glass.src, tile: IMAGES.glass.w, x: door + 18, y: GLASS.y, w: room.w - door - 18,
      h: GLASS.h, z });
    add({ id: "glass-door", img: "glass-door", src: IMAGES.door.src, x: door, y: GLASS.y - 2, w: IMAGES.door.w, h: IMAGES.door.h,
      z: z + 0.1 });
  }
  add({ id: "desk-l", img: "desk-l", x: DESK_X, y: BACK, w: 8, h: 21, z: BACK + 15 });
  for (const seat of room.seats) {
    add({ id: `desk-${seat.i}`, img: "desk-m", x: seat.segX, y: BACK, w: 24, h: 21, z: BACK + 15 });
    if (seat.agent) {
      // 誰かの席: いつもの椅子とノート PC（本人が歩き回っていても置いたまま）。PC は名札と同じく、クリックでその人を
      // 表示してから、右クリックはそのまま、その人のタブのメニュー（名前を変える・閉じる。main.js の tabMenu）
      add({ id: `chair-${seat.i}`, img: "chair", x: seat.cx - 7, y: BACK - 9, w: 14, h: 9, z: BACK - 2 });
      add({ id: `laptop-${seat.i}`, img: "laptop", x: seat.segX + 7, y: BACK - 5, w: 10, h: 9, z: BACK + 15.5, owner: seat.agent,
        click: { type: "tab-menu", terminal: seat.agent, focus: true }, right: { type: "tab-menu", terminal: seat.agent },
        tip: "PC: クリックでこのエージェントのタブのメニュー（名前を変える・閉じる）。右クリックはメニューだけ", glow: true });
      // 机の前の板の名札（タブバーと同じ名前。長ければ切る）。本人が歩き回っていても席に残るので、誰の席か分かる。
      // クリックはキャラと同じく、その人を表示
      const info = office.chars.get(seat.agent)?.info ?? {};
      const name = info.seatName ?? info.tab ?? info.name ?? seat.agent;
      add({ id: `name-${seat.i}`, plate: name, x: seat.segX + 1, y: BACK + 10, w: 22, h: 6, z: BACK + 15.9, owner: seat.agent,
        click: { type: "focus", terminal: seat.agent }, tip: `${name}（クリックで表示）` });
      continue;
    }
    // 空いた席（雇える席）: 緑の椅子、ノート PC なし、上に「＋」の札が揺れる
    const hire = { type: "hire", space: room.id, machine: room.machine };
    const tip = "空いた席: クリックでエージェントを雇う";
    add({ id: `chair-${seat.i}`, img: "chair-free", x: seat.cx - 7, y: BACK - 9, w: 14, h: 9, z: BACK - 2, click: hire, tip, glow: true });
    add({ id: `hire-${seat.i}`, img: "hire-sign", x: seat.cx - 5, y: BACK - 24 - (Math.floor(office.t / 4) % 2), w: 11, h: 11,
      z: BACK - 1.5, click: hire, tip, glow: true });
  }
  add({ id: "desk-r", img: "desk-r", x: room.deskEnd - DESK_END, y: BACK, w: 8, h: 21, z: BACK + 15 });

  for (const c of office.chars.values()) {
    if (c.room !== room.id) continue;
    const { look, band, flame } = c.look;
    const ph = office.t + c.phase;
    const click = { type: "focus", terminal: c.address };
    const tip = [c.info.name, modelLabel(c.info.model), c.info.effort, c.info.where, c.info.status].filter(Boolean).join(" · ");
    // キャラ。effort の鉢巻きは同じ大きさの重ね絵（over）で、キャラのすぐ上に描く
    const person = (pose, x, y, h, z) => {
      add({ id: `char-${c.address}`, img: `char/${look}-${pose}`, over: band ? `band/${band}-${pose}` : null,
        x, y, w: 18, h, z, click, tip, char: c, owner: c.address });
    };
    if (c.seated) {
      const pose = c.behavior === "done" ? "sit-happy" : ph % 8 < 6 ? "sit-0" : "sit-1";
      if (flame && c.behavior === "type") {
        add({ id: `flame-${c.address}`, img: `fx-flame-${ph % 2}`, x: c.seat.cx - 14, y: BACK - 15, w: 28, h: 10, z: BACK - 1.2 });
      }
      person(pose, c.seat.cx - 9, BACK - 18, 18, BACK - 1);
      if (answering.has(c.address) && c.behavior !== "done") talkBubble(c, c.seat.cx - 6, BACK - 31); // 話しかけられて答える
      else if (c.behavior === "type" && c.info.skill) {
        add({ id: `tag-${c.address}`, text: skillShort(c.info.skill), color: colorOf(c.info.skill), x: c.seat.cx, y: BACK - 28, z: 1001 });
      }
      const hands = c.behavior === "done" ? "hands-rest" : ph % 2 ? "hands-a" : "hands-b";
      add({ id: `hands-${c.address}`, img: hands, x: c.seat.segX, y: BACK, w: 24, h: 6, z: BACK + 15.7 });
      if (c.behavior === "done") {
        add({ id: `bubble-${c.address}`, img: "bubble-done", x: c.seat.cx - 6, y: BACK - 31 - (Math.floor(ph / 4) % 2), w: 13, h: 14, z: 1000 });
      }
      continue;
    }
    const x = Math.round(c.x);
    const y = Math.round(c.y);
    let pose;
    if (c.path.length) pose = `walk-${c.facing}-${ph % 2}`;
    else if (c.behavior === "read") pose = ph % 12 < 9 ? "read-0" : "read-1";
    else if (c.behavior === "raise") pose = `raise-${Math.floor(ph / 3) % 2}`;
    else if (c.behavior === "visit") pose = `walk-${c.facing}-0`; // 相手の方を向いて話す
    else pose = ph % 23 === 0 ? "blink" : "stand";
    person(pose, x - 9, y - 23, 24, y);
    // 話しかけた人の番: 送った文の札（文が分からなければ「…」の吹き出し）。相手の番: 相手に「…」の吹き出し
    if (talking(c) && turnOf(c) === 0) {
      if (c.errand.text) add({ id: `tag-${c.address}`, text: talkLabel(c.errand.text), color: TALK_COLOR, x, y: y - 33, z: 1001 });
      else talkBubble(c, x - 6, y - 36);
    }
    if (answering.has(c.address) && c.behavior !== "raise" && !c.path.length) talkBubble(c, x - 6, y - 36);
    const reading = c.errand?.skill ?? c.info.skill;
    if (c.behavior === "read" && !c.path.length && reading) {
      add({ id: `tag-${c.address}`, text: skillShort(reading), color: colorOf(reading), x, y: y - 33, z: 1001 });
    }
    if (c.behavior === "raise" && !c.path.length) {
      // 質問の「?」はクリックで質問と選択肢を出す（ai-office-ask）。許可待ちの「!」は、キャラと同じくターミナルへ
      const question = c.info.kind === "question";
      add({ id: `bubble-${c.address}`, img: question ? "bubble-ask" : "bubble-alert", x: x - 6, y: y - 36 - (Math.floor(ph / 3) % 2),
        w: 13, h: 14, z: 1000, glow: true,
        click: question ? { type: "ask", terminal: c.address, name: tip } : click,
        tip: question ? "クリックで質問に答える" : tip });
    }
  }
  return out.sort((a, b) => a.z - b.z);
}

/**
 * フロア全体に 1 つだけ描くもの（フロア全体の座標）: 資料室の本棚。1 冊 = 1 つの skill で、
 * 今読まれている skill の本は抜いておく。クリックで一覧。
 */
export function floorDrawables(office, skills = []) {
  const reading = [...office.chars.values()]
    .filter((c) => c.behavior === "read" && !c.path.length && (c.errand?.skill ?? c.info.skill))
    .map((c) => c.errand?.skill ?? c.info.skill);
  const { books, more } = shelfBooks(skills);
  return [{ id: "shelf", img: "bookshelf-empty", x: SHELF.x, y: SHELF.y, w: 32, h: 42, z: 56,
    books: books.filter((b) => !reading.some((r) => sameSkill(r, b.skill.id))),
    click: { type: "skills" },
    tip: `資料室の本棚: 使える skill ${skills.length} 冊${more > 0 ? `（棚に入りきらない ${more} 冊も）` : ""}。クリックで一覧` }];
}
