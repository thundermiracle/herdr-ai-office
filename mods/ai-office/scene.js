// scene.js: オフィスの中身の計算。herdr も gpui-kit も import しない（bun test で試せる）。
// 座標はすべて絵のピクセル（art px）。mod は SCALE 倍の論理 px で描く。
// 絵の置き方は scripts/build-art.py の見本（preview）と同じ:
//   立ち・歩き（18x24）は左上を (足の x-9, 足の y-23)、座り（18x18）は (席の x-9, BACK-18)、
//   椅子は (席の x-7, BACK-9)、ノート PC は (席の机の x+7, BACK-5)、手は (席の机の x, BACK)。

export const SCALE = 2;
export const TICK_ACTIVE = 160; // ms。窓がアクティブなとき（約 6fps）
export const TICK_INACTIVE = 500; // 窓が後ろにあるとき（2fps）
export const SPEED = 14; // 歩く速さ（art px / 秒）

export const ROOM_H = 140;
export const WALL_H = 36;
export const LANE_Y = 54; // 机の奥の通路（足の y）。席を立つとここに出る
export const BACK = 74; // 机の奥の縁
export const DESK_X = 48; // 机の左端
export const DESK_END = 8; // 机の端の板の幅
export const SEAT_W = 24;
export const FRONT_Y = [104, 132]; // 手前の床（足の y）
export const MIN_ROOM_W = 200;
export const LEFT_PASS = 38; // 机の左の通り道（x）。右は部屋ごと（room.rightPass）
export const READ = { x: 22, y: 66 }; // 本棚の前
export const GAP = 12; // 部屋と部屋のすき間
export const NEW_ROOM_W = 64; // 「新しい部屋」の区画（ドア）

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
    status: space.status ?? null,
    w: Math.max(MIN_ROOM_W, deskEnd + 40),
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

/** 部屋を左から並べ、幅に入らなければ次の行へ。最後に「新しい部屋」の区画を置く。 */
export function layoutRooms(rooms, widthArt) {
  const lots = [...rooms, { id: "new-room", newRoom: true, w: NEW_ROOM_W, h: ROOM_H }];
  let x = GAP;
  let y = GAP;
  let rowH = 0;
  let maxX = 0;
  const placed = lots.map((r) => {
    if (x > GAP && x + r.w > widthArt - GAP) {
      x = GAP;
      y += rowH + GAP;
      rowH = 0;
    }
    const p = { ...r, ox: x, oy: y };
    x += r.w + GAP;
    rowH = Math.max(rowH, r.h);
    maxX = Math.max(maxX, x);
    return p;
  });
  return { rooms: placed, w: maxX, h: y + rowH + GAP };
}

/**
 * from から to への道（曲がり角の列、from は含まない）。縦横にだけ動く。
 * 机より奥（y < BACK）と手前を行き来するときは、机の左右の通り道を通る。
 */
export function planPath(room, from, to) {
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
        c.seat = seat;
        c.roomRef = room;
        c.info = a;
        c.look = { look: lookOf(a.app, a.model), band: bandOf(a.effort), flame: a.effort === "max" };
        const b = behaviorOf(a.status, a.act);
        if (b !== c.behavior || (moved && b !== "wander" && b !== "read")) this.retarget(c, b);
      }
    }
    for (const k of [...this.chars.keys()]) if (!seen.has(k)) this.chars.delete(k);
  }

  retarget(c, behavior) {
    const sits = (b) => b === "type" || b === "done";
    c.behavior = behavior;
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
    const goal = behavior === "read" ? READ : { x: c.seat.cx, y: LANE_Y };
    c.path = planPath(c.roomRef, c, goal);
    if (!c.path.length) this.arrive(c);
  }

  arrive(c) {
    if (c.behavior === "type" || c.behavior === "done") {
      c.seated = true;
      c.sitX = c.seat.cx;
    }
    if (c.behavior === "wander") c.wait = 3000 + this.rng() * 6000;
  }

  wanderTarget(room) {
    if (this.rng() < 0.65) {
      return {
        x: 16 + Math.round(this.rng() * (room.w - 32)),
        y: FRONT_Y[0] + Math.round(this.rng() * (FRONT_Y[1] - FRONT_Y[0])),
      };
    }
    return { x: 44 + Math.round(this.rng() * (room.w - 58)), y: LANE_Y };
  }

  /** dt ミリ秒ぶん進める。何か変わったら true（描き直しが要る）。 */
  tick(dt) {
    this.t++;
    let changed = false;
    for (const c of this.chars.values()) {
      if (c.path.length) {
        let budget = (SPEED * dt) / 1000;
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

/** 今のコマが動きを含むか（含まなければ tick しても絵は変わらない）。 */
export function animating(office) {
  for (const c of office.chars.values()) {
    if (c.path.length || c.behavior === "type" || c.behavior === "raise" || c.behavior === "read") return true;
    if (c.behavior === "wander") return true; // まばたきと、次に歩きだすまでの待ち
  }
  return false;
}

/**
 * 1 つの部屋に描くもの。奥から手前の順（z の小さい順）に並べて返す。
 * 1 つ 1 つ: { id, img, over?, x, y, w, h, z, click?, tip?, glow?, char? }。img と over（上に重ねる絵）は img/ の下の名前（.png なし）。
 */
export function drawables(room, office) {
  const out = [];
  const add = (d) => out.push(d);
  add({ id: "shelf", img: "bookshelf", x: 6, y: 14, w: 32, h: 42, z: 56 });
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
    if (c.behavior === "raise" && !c.path.length) {
      const kind = c.info.kind === "question" ? "bubble-ask" : "bubble-alert";
      add({ id: `bubble-${c.address}`, img: kind, x: x - 6, y: y - 36 - (Math.floor(ph / 3) % 2), w: 13, h: 14, z: 1000 });
    }
  }
  return out.sort((a, b) => a.z - b.z);
}
