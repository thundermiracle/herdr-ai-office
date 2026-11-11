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

// オフィスは 1 枚のフロア: 左に縦の廊下（一番上が資料室で、本棚はここに 1 つ）、その右に部屋をすき間なく並べる。
// 部屋の左端は仕切りの壁で、奥から PART_END までをふさぎ、手前は通路として開けておく（廊下や隣の部屋とつながる）。
// 部屋の中の座標は部屋の左上から、フロア全体の座標はフロアの左上（廊下の左上）から。
export const ROOM_H = 140;
export const WALL_H = 36;
export const LANE_Y = 54; // 机の奥の通路（足の y）。席を立つとここに出る
export const BACK = 74; // 机の奥の縁
export const DESK_X = 26; // 机の左端（左の仕切りの内側）
export const DESK_END = 8; // 机の端の板の幅
export const SEAT_W = 24;
export const FRONT_Y = [104, 132]; // 手前の床（足の y）
export const CORRIDOR_Y = 118; // 手前の通路を通って廊下へ行くときの高さ（足の y）
export const PART_W = 4; // 部屋の左の仕切りの厚さ
export const PART_END = 96; // 仕切りは奥からここまで（手前は開いている）
export const MIN_ROOM_W = 160;
export const LEFT_PASS = 14; // 机の左の通り道（x）。右は部屋ごと（room.rightPass）
export const HALL_W = 44; // 左の廊下の幅
// 資料室（廊下の一番上）で本を読む場所（フロア全体の座標）。本棚の前から、読む人が増えると順に並ぶ
export const LIBRARY = [{ x: 22, y: 66 }, { x: 12, y: 78 }, { x: 32, y: 78 }, { x: 22, y: 90 }];
export const NEW_ROOM_W = 72; // 空き部屋（クリックで新しい部屋）

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

// 本棚（bookshelf-empty.png、資料室＝フロアの (6, 14) に置く）の中で本を立てる場所。scripts/build-art.py の bookshelf と同じ寸法:
// 3 段で、本の下端の次の行が y = 14・27・40、横は x = 3〜28。本は幅 2 で、1 段に 13 冊
export const SHELF = { x: 6, y: 14, bases: [14, 27, 40], left: 3, right: 29, bookW: 2 };

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

/** 1 つのスペースの部屋。席はエージェントの数 + 1（最後の 1 つは空席で、クリックで雇う）。 */
export function roomOf(space, agentsHere) {
  const count = agentsHere.length + 1;
  const deskEnd = DESK_X + DESK_END * 2 + count * SEAT_W;
  return {
    id: space.id,
    name: space.name,
    active: !!space.active,
    machine: space.machine ?? null,
    folder: space.folder ?? "",
    status: space.status ?? null,
    w: Math.max(MIN_ROOM_W, deskEnd + 30),
    h: ROOM_H,
    deskEnd,
    rightPass: deskEnd + 10,
    seats: Array.from({ length: count }, (_, i) => {
      const segX = DESK_X + DESK_END + i * SEAT_W;
      return { i, segX, cx: segX + 12, agent: agentsHere[i]?.address ?? null };
    }),
  };
}

/** スペースごとに部屋を作る。agents は herdr の agents()（スペース・タブ・ペインの順）。 */
export function roomsOf(spaces, agents) {
  return spaces.map((s) => roomOf(s, agents.filter((a) => a.space === s.id)));
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
 * 机より奥（y < BACK）と手前を行き来するときは、机の左右の通り道を通る。
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
  const back = (p) => p.y < BACK;
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
    const pass = cost(LEFT_PASS) <= cost(room.rightPass) ? LEFT_PASS : room.rightPass;
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

/** キャラクターたちの今（位置・行き先・座っているか）。View が 1 つ持ち、tick で進める。 */
export class Office {
  constructor(rng = Math.random) {
    this.rng = rng;
    this.chars = new Map(); // address -> キャラ
    this.t = 0; // tick の数（コマ送りに使う）
  }

  /**
   * 部屋とエージェントの今に合わせる。info: address -> { status, app, kind, act, title, ... }。
   * 新しいエージェントは自分の席の後ろから始める。いなくなったエージェントは消す。
   */
  sync(rooms, info) {
    const seen = new Set();
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
        // 窓の幅が変わって部屋が並び直すと、部屋の外（廊下など）の座標はずれる。部屋の手前に戻して歩き直す
        const relocated = c.origin !== undefined && c.origin !== origin && (c.x < 0 || c.path.some((p) => p.x < 0));
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
        // skill を使った出来事: office.skill_at（フックが使うたびに時刻を書く）が変わった。初めて見た値は出来事にしない
        let errandNow = false;
        if (c.skillAt === undefined) c.skillAt = a.skillAt ?? null;
        else if (a.skillAt && a.skillAt !== c.skillAt) {
          c.skillAt = a.skillAt;
          if (a.skill) {
            c.errand = { skill: a.skill, left: null }; // left: 資料室に着いてから読む残り時間
            errandNow = true;
          }
        }
        let b = behaviorOf(a.status, a.act);
        if (c.errand && b === "raise") c.errand = null; // 質問・許可待ちは用事より先（すぐ手を挙げる）
        if (c.errand) b = "read"; // 用事の途中は、エージェントが次のツールに移っても資料室で読む
        if (errandNow || b !== c.behavior || relocated || (moved && b !== "wander" && b !== "read")) this.retarget(c, b);
      }
    }
    for (const k of [...this.chars.keys()]) if (!seen.has(k)) this.chars.delete(k);
  }

  retarget(c, behavior) {
    const sits = (b) => b === "type" || b === "done";
    c.behavior = behavior;
    if (behavior !== "read") c.spot = undefined;
    if (c.seated && sits(behavior) && c.sitX === c.seat.cx) return; // 座ったまま
    if (c.seated) {
      c.seated = false; // 席を立って、座っていた椅子の後ろに出る（席がずれたなら、そこから新しい席へ歩く）
      c.x = c.sitX;
      c.y = LANE_Y;
    }
    c.wait = 0;
    if (behavior === "wander") {
      c.path = [];
      c.wait = 400 + this.rng() * 1500; // 少し間をおいて歩きだす
      return;
    }
    const goal = behavior === "read" ? this.librarySpot(c) : { x: c.seat.cx, y: LANE_Y };
    c.path = planPath(c.roomRef, c, goal);
    // 資料室へ行くとき（skill を取りに行く・調べ物）と、廊下から戻るときは小走り
    c.run = behavior === "read" || c.returning === true || c.x < 0;
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
    if (c.errand && c.behavior === "read") c.errand.left = ERRAND_READ_MS; // 資料室に着いた: ここから読む
  }

  wanderTarget(room) {
    if (this.rng() < 0.65) {
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
    let changed = false;
    for (const c of this.chars.values()) {
      // skill の用事: 読み終わったら、今の状態の動きに戻る（席へは小走り）
      if (c.errand && c.errand.left !== null && !c.path.length) {
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
      } else if (c.behavior === "wander") {
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
 * 壁時計の針の向き（12 方向のどれか）。時針は時の数だけで決め（切り捨て。2:31 でも 2 時を指す）、
 * 分針は 5 分ごと。絵は img/clock-h-<h>.png と img/clock-m-<m>.png。
 */
export function clockHands(date) {
  return { h: date.getHours() % 12, m: Math.floor(date.getMinutes() / 5) };
}

/** 誰かが小走りしているか（コマ送りを速くする）。 */
export function running(office) {
  for (const c of office.chars.values()) if (c.run && c.path.length) return true;
  return false;
}

/** 今のコマが動きを含むか（含まなければ tick しても絵は変わらない）。 */
export function animating(office) {
  for (const c of office.chars.values()) {
    if (c.path.length || c.behavior === "type" || c.behavior === "raise" || c.behavior === "read") return true;
    if (c.behavior === "wander") return true; // まばたきと、次に歩きだすまでの待ち
  }
  return false;
}

/**
 * 1 つの部屋に描くもの（部屋の中の座標。廊下へ出ている人は x < 0）。奥から手前の順（z の小さい順）に並べて返す。
 * 1 つ 1 つ: { id, img, over?, books?, x, y, w, h, z, click?, tip?, glow?, char? } か、札 { id, text, color, x（中心）, y, z }。
 * img と over（上に重ねる絵）は img/ の下の名前（.png なし）。books は本棚の上に描く本（shelfBooks、本棚の左上から）。
 * skills は資料室の本棚の skill（札の色に使う）。
 */
export function drawables(room, office, skills = []) {
  const out = [];
  const add = (d) => out.push(d);
  const colorOf = (id) => SKILL_SOURCES[skills.find((x) => sameSkill(id, x.id))?.source]?.color ?? "#9aa4b4";
  add({ id: "plant", img: "plant", x: room.w - 18, y: 78, w: 12, h: 17, z: 95 });
  add({ id: "desk-l", img: "desk-l", x: DESK_X, y: BACK, w: 8, h: 21, z: BACK + 15 });
  for (const seat of room.seats) {
    add({ id: `desk-${seat.i}`, img: "desk-m", x: seat.segX, y: BACK, w: 24, h: 21, z: BACK + 15 });
    if (seat.agent) {
      // 誰かの席: いつもの椅子とノート PC（本人が歩き回っていても置いたまま）
      add({ id: `chair-${seat.i}`, img: "chair", x: seat.cx - 7, y: BACK - 9, w: 14, h: 9, z: BACK - 2 });
      add({ id: `laptop-${seat.i}`, img: "laptop", x: seat.segX + 7, y: BACK - 5, w: 10, h: 9, z: BACK + 15.5 });
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
        x, y, w: 18, h, z, click, tip, char: c });
    };
    if (c.seated) {
      const pose = c.behavior === "done" ? "sit-happy" : ph % 8 < 6 ? "sit-0" : "sit-1";
      if (flame && c.behavior === "type") {
        add({ id: `flame-${c.address}`, img: `fx-flame-${ph % 2}`, x: c.seat.cx - 14, y: BACK - 15, w: 28, h: 10, z: BACK - 1.2 });
      }
      person(pose, c.seat.cx - 9, BACK - 18, 18, BACK - 1);
      if (c.behavior === "type" && c.info.skill) {
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
    else pose = ph % 23 === 0 ? "blink" : "stand";
    person(pose, x - 9, y - 23, 24, y);
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
