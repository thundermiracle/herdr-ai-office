import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "fs";
import {
  BACK, CORRIDOR_Y, DESK_X, ERRAND_READ_MS, HALL_W, LANE_Y, LEFT_PASS, LIBRARY, MIN_ROOM_W, PART_END, PART_W, BOARD_ROOM_W, ROOM_H, SEAT_W,
  TALK_DEDUP_MS, TALK_MS, TALK_TURN_MS, WALL_H, Office, agentModel, argvValue, bandOf, behaviorOf, clockHands, codexOverride,
  drawables, dropTarget, floorDrawables, floorPath, layoutFloor, lookOf, roomAt, talkLabel,
  modelFamily, modelLabel, parseCodexConfig, parseSkillFile, planPath, roomOf, roomsOf, sameSkill, shelfBooks, sortSkills, SHELF,
  FRONT_Y, GLASS, geometry, useTheme, seatName, readTheme, addTheme, themeList, pngSize, isNoiseDoc, plateText, openAgents,
  DOOR_HOLD_MS, DOOR_MS, DOOR_SLIDE, doorsMoving,
} from "../mods/ai-office/scene.js";

// テーマは、オフィスと同じく mods/ai-office/themes/<名前>/ の theme.json と PNG から読む（確かめで落ちたら、ここで止まる）
const THEMES_DIR = new URL("../mods/ai-office/themes/", import.meta.url).pathname;
const themeJson = (name) => JSON.parse(readFileSync(`${THEMES_DIR}${name}/theme.json`, "utf8"));
const themeSizes = (name, json) => Object.fromEntries(Object.values(json.images ?? {})
  .map((file) => [file, pngSize(readFileSync(`${THEMES_DIR}${name}/${file}`))]));
for (const name of readdirSync(THEMES_DIR).filter((n) => existsSync(`${THEMES_DIR}${n}/theme.json`))) {
  const json = themeJson(name);
  const { theme, problems } = readTheme(name, json, themeSizes(name, json));
  if (problems.length) throw new Error(`themes/${name}: ${problems.join(" / ")}`);
  addTheme(theme);
}

// これまでのテストは classic（仕切りが途中まで・手前の床がつながる部屋）の寸法で書いてある。modern は下の describe("modern")
useTheme("classic");

// 毎回同じになる乱数
function seeded(seed = 1) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const space = (id, extra = {}) => ({ id, name: id, active: false, machine: null, ...extra });
const agent = (address, spaceId, status = "idle", app = "claude-code") => ({ address, space: spaceId, status, app });

function world(statuses, { acts = {}, kinds = {}, models = {} } = {}) {
  const agents = Object.entries(statuses).map(([address, status]) => agent(address, "sp1", status));
  const rooms = roomsOf([space("sp1")], agents);
  const info = new Map(agents.map((a) => [a.address,
    { status: a.status, app: a.app, act: acts[a.address], kind: kinds[a.address], ...models[a.address] }]));
  return { rooms, info };
}

// 歩き終わるまで進める
function settle(office, ms = 30000) {
  for (let t = 0; t < ms; t += 160) office.tick(160);
}

describe("behaviorOf", () => {
  test("status and office.act pick the behavior", () => {
    expect(behaviorOf("working")).toBe("type");
    expect(behaviorOf("working", "edit")).toBe("type");
    expect(behaviorOf("working", "read")).toBe("read");
    expect(behaviorOf("blocked", "read")).toBe("raise");
    expect(behaviorOf("done")).toBe("done");
    expect(behaviorOf("idle")).toBe("wander");
    expect(behaviorOf(null)).toBe("wander");
  });
});

describe("looks", () => {
  test("model ids map to a family, including [1m] and Bedrock ids", () => {
    expect(modelFamily("claude-opus-5-5")).toBe("opus");
    expect(modelFamily("claude-opus-5-5[1m]")).toBe("opus");
    expect(modelFamily("us.anthropic.claude-sonnet-5-5-v1:0")).toBe("sonnet");
    expect(modelFamily("claude-fable-5-2")).toBe("fable");
    expect(modelFamily("claude-haiku-5-5")).toBe("haiku");
    expect(modelFamily("gpt-6.1-sol")).toBeNull();
    expect(modelFamily(null)).toBeNull();
  });

  test("model labels read like people say them", () => {
    expect(modelLabel("claude-opus-5-5")).toBe("Opus 5.5");
    expect(modelLabel("claude-fable-5-2[1m]")).toBe("Fable 5.2");
    expect(modelLabel("gpt-6.1-sol")).toBe("gpt-6.1-sol");
    expect(modelLabel(null)).toBeNull();
  });

  test("one look per AI, told apart by model; effort is a headband", () => {
    expect(lookOf("claude-code", "claude-opus-5-5")).toBe("claude-opus");
    expect(lookOf("claude-code", "claude-haiku-5-5")).toBe("claude-haiku");
    expect(lookOf("claude-code", null)).toBe("claude-sonnet");
    expect(lookOf("codex", "gpt-6.1-sol")).toBe("codex");
    expect(lookOf("kiro", null)).toBe("other");
    expect([null, "low", "medium", "high", "xhigh", "max"].map(bandOf)).toEqual([null, null, "blue", "white", "red", "red"]);
  });

  test("argv and Codex config are read as fallbacks", () => {
    expect(argvValue(["--effort", "max", "--model", "claude-opus-5-5"], ["--model"])).toBe("claude-opus-5-5");
    expect(argvValue(["--model=claude-haiku-5-5"], ["--model"])).toBe("claude-haiku-5-5");
    expect(argvValue(["--no-daemon"], ["-m", "--model"])).toBeNull();
    expect(codexOverride(["-c", 'model_reasoning_effort="high"'], "model_reasoning_effort")).toBe("high");
    expect(parseCodexConfig('model = "gpt-6.1-sol"\nmodel_reasoning_effort = "max"\n[profiles.x]\nmodel = "other"\n'))
      .toEqual({ model: "gpt-6.1-sol", effort: "max" });
  });

  test("agentModel: cache first, then argv, then Codex defaults", () => {
    const codexDefaults = { model: "gpt-6.1-sol", effort: "max" };
    expect(agentModel({ app: "claude-code", argv: ["--model", "claude-opus-5-5", "--effort", "xhigh"],
      cached: { model: "claude-fable-5-2", effort: "high" } })).toEqual({ model: "claude-fable-5-2", effort: "high" });
    expect(agentModel({ app: "claude-code", argv: ["--model", "claude-opus-5-5", "--effort", "xhigh"], cached: null }))
      .toEqual({ model: "claude-opus-5-5", effort: "xhigh" });
    expect(agentModel({ app: "claude-code", argv: [], cached: { model: null, effort: null }, codexDefaults }))
      .toEqual({ model: null, effort: null });
    expect(agentModel({ app: "codex", argv: ["--no-daemon"], codexDefaults })).toEqual(codexDefaults);
    expect(agentModel({ app: "codex", argv: ["-m", "gpt-6.1-mini", "-c", "model_reasoning_effort=low"], codexDefaults }))
      .toEqual({ model: "gpt-6.1-mini", effort: "low" });
  });
});

describe("rooms", () => {
  test("one seat per agent plus one empty seat, and the desk grows", () => {
    const one = roomOf(space("a"), [agent("t1", "a")]);
    const four = roomOf(space("b"), ["t1", "t2", "t3", "t4"].map((t) => agent(t, "b")));
    expect(one.seats.map((s) => s.agent)).toEqual(["t1", null]);
    expect(four.seats).toHaveLength(5);
    expect(four.seats.at(-1).agent).toBeNull();
    expect(four.deskEnd - one.deskEnd).toBe(3 * SEAT_W);
    expect(one.w).toBe(MIN_ROOM_W);
    expect(roomOf(space("c"), Array.from({ length: 8 }, (_, i) => agent(`t${i}`, "c"))).w).toBeGreaterThan(MIN_ROOM_W);
  });

  test("a room with someone's plan gets the whiteboard, and is wide enough for it", () => {
    const agents = [agent("t1", "a"), agent("t2", "a"), agent("t3", "b")];
    const docs = new Map([["t2", [{ path: "/u/.claude/plans/quiet-fox.md", kind: "plan" }]]]);
    const [a, b] = roomsOf([space("a"), space("b")], agents, docs);
    expect(a.docs).toEqual([{ address: "t2", path: "/u/.claude/plans/quiet-fox.md", kind: "plan" }]);
    expect(a.w).toBe(BOARD_ROOM_W);
    expect(b.docs).toEqual([]);
    expect(b.w).toBe(MIN_ROOM_W);
    // 机が長くてもともと広い部屋は、そのまま
    const many = Array.from({ length: 8 }, (_, i) => agent(`t${i}`, "c"));
    const wide = roomOf(space("c"), many);
    expect(roomOf(space("c"), many, new Map([["t0", [{ path: "/p.md", kind: "plan" }]]])).w).toBe(wide.w);
  });

  test("the whiteboard holds only this room's people's plans and .md: plans first, each file once, no noise", () => {
    const agents = [agent("t1", "a"), agent("t2", "a"), agent("t9", "b")];
    const docs = new Map([
      ["t1", [{ path: "/r/notes.md", kind: "doc" }, { path: "/r/CLAUDE.md", kind: "doc" }, { path: "/r/README.md", kind: "doc" }]],
      ["t2", [{ path: "/u/.claude/plans/fox.md", kind: "plan" }, { path: "/r/README.md", kind: "doc" }, { path: "/private/tmp/x/report.md", kind: "doc" }]],
      ["t9", [{ path: "/other/spec.md", kind: "doc" }]], // ほかの部屋（b）の人
    ]);
    const [a, b] = roomsOf([space("a"), space("b")], agents, docs);
    expect(a.docs.map((d) => [d.kind, d.path, d.address])).toEqual([
      ["plan", "/u/.claude/plans/fox.md", "t2"], // プランは ~/.claude/ の中でも出す
      ["doc", "/r/notes.md", "t1"],
      ["doc", "/r/README.md", "t1"], // t2 も書いたが、1 つ
      ["doc", "/private/tmp/x/report.md", "t2"], // 一時フォルダ（Claude Code の作業フォルダ）の報告も載る
    ]);
    expect(b.docs.map((d) => d.path)).toEqual(["/other/spec.md"]); // ほかの部屋のものは混ざらない
    expect(roomsOf([space("c")], [agent("t5", "c")], new Map([["t5", [{ path: "/r/AGENTS.md", kind: "doc" }]]]))[0])
      .toMatchObject({ docs: [], w: MIN_ROOM_W }); // ノイズだけなら、ホワイトボードは掛けない
  });

  test("files that are gone (deleted, not yet written, or a misread Bash line) are not put on the whiteboard", () => {
    const agents = [agent("t1", "a"), agent("t2", "r")];
    const docs = new Map([
      ["t1", [{ path: "/u/.claude/plans/fox.md", kind: "plan" }, { path: "/r/gone.md", kind: "doc" }, { path: "/r/here.md", kind: "doc" }]],
      ["t2", [{ path: "/remote/spec.md", kind: "doc" }]],
    ]);
    const present = new Set(["/r/here.md"]); // プランもまだない（書く直前にラベルが付く）
    const [a, remote] = roomsOf([space("a"), space("r", { machine: "mini" })], agents, docs, present);
    expect(a.docs.map((d) => d.path)).toEqual(["/r/here.md"]);
    expect(remote.docs.map((d) => d.path)).toEqual(["/remote/spec.md"]); // ほかのマシンの部屋は、この Mac から調べない
    expect(roomsOf([space("a")], [agent("t1", "a")], new Map([["t1", [{ path: "/r/gone.md", kind: "doc" }]]]), new Set())[0])
      .toMatchObject({ docs: [], w: MIN_ROOM_W }); // 全部ないなら、ホワイトボードは掛けない
    expect(roomsOf([space("a")], agents, docs)[0].docs).toHaveLength(3); // present を渡さなければ、ラベルのまま
  });

  test("obvious noise is not put on the whiteboard", () => {
    for (const path of ["/r/CLAUDE.md", "/r/claude.local.md", "/r/AGENTS.md", "/r/GEMINI.md", "/r/skills/x/SKILL.md", "/r/LICENSE.md",
      "/r/.github/PULL_REQUEST_TEMPLATE.md", "/r/node_modules/pkg/README.md", "/r/dist/a.md", "/r/.claude/notes.md"]) {
      expect([path, isNoiseDoc(path)]).toEqual([path, true]);
    }
    for (const path of ["/r/README.md", "/r/docs/report.md", "/r/TODO.md", "/r/CHANGELOG.md", "/Users/me/Desktop/memo.md",
      "/tmp/a.md", "/private/tmp/claude-1/scratchpad/report.md", "/var/folders/xy/T/b.md"]) { // 一時フォルダはノイズにしない
      expect([path, isNoiseDoc(path)]).toEqual([path, false]);
    }
  });

  test("agents go to their own space's room", () => {
    const rooms = roomsOf([space("a"), space("b")], [agent("t1", "a"), agent("t2", "b"), agent("t3", "a")]);
    expect(rooms[0].seats.map((s) => s.agent)).toEqual(["t1", "t3", null]);
    expect(rooms[1].seats.map((s) => s.agent)).toEqual(["t2", null]);
  });

  test("one floor: rooms side by side right of the hallway, rows squared off, the empty room last", () => {
    const rooms = roomsOf([space("a"), space("b"), space("c")], [agent("t1", "a"), agent("t2", "a"), agent("t3", "a")]);
    const floor = layoutFloor(rooms, HALL_W + 2 * MIN_ROOM_W + 40);
    expect(floor.rooms.map((r) => r.id)).toEqual(["a", "b", "c", "new-room"]);
    const [a, b, c, lot] = floor.rooms;
    expect(a.ox).toBe(HALL_W); // 廊下のすぐ右
    expect(b.ox).toBe(a.ox + a.w); // すき間なし
    expect(c.oy).toBe(ROOM_H); // 入らなければ次の列
    expect(c.ox).toBe(HALL_W);
    expect(lot.oy).toBe(ROOM_H);
    // 列の右端はそろう（フロアは四角）
    expect(b.ox + b.w).toBe(floor.w);
    expect(lot.ox + lot.w).toBe(floor.w);
    expect(floor.h).toBe(2 * ROOM_H);
  });
});

describe("dropTarget", () => {
  // 3 つの部屋 a・b・c。幅 300 なら 1 列に 1 部屋（a、b、c と縦に並ぶ）
  const floor = (spaces, width = 1000) => layoutFloor(roomsOf(spaces, []), width).rooms;
  const middle = (r) => ({ x: r.ox + r.w / 2, y: r.oy + r.h / 2 });

  test("a later room takes it after itself (mark on its right), an earlier one before itself (on its left)", () => {
    const rooms = floor([space("a"), space("b"), space("c")]);
    const [a, b, c] = rooms;
    expect(dropTarget(rooms, "a", middle(b))).toEqual({ id: "b", side: "right" });
    expect(dropTarget(rooms, "a", middle(c))).toEqual({ id: "c", side: "right" });
    expect(dropTarget(rooms, "c", middle(a))).toEqual({ id: "a", side: "left" });
    // 奥の壁（名札のあたり）でも、手前の床でも
    expect(dropTarget(rooms, "c", { x: b.ox + 20, y: b.oy + 5 })?.id).toBe("b");
    expect(dropTarget(rooms, "c", { x: b.ox + 20, y: b.oy + b.h - 1 })?.id).toBe("b");
  });

  test("across rows too", () => {
    const rooms = floor([space("a"), space("b"), space("c")], 300);
    expect(rooms[2].oy).toBe(2 * ROOM_H);
    expect(dropTarget(rooms, "a", middle(rooms[2]))).toEqual({ id: "c", side: "right" });
  });

  test("nothing on its own room, the hallway, the empty room, or a room on another machine", () => {
    const rooms = floor([space("a"), space("b"), space("m", { machine: "mini" })]);
    const [a, , m, lot] = rooms;
    expect(lot.newRoom).toBe(true);
    expect(dropTarget(rooms, "a", middle(a))).toBeNull();
    expect(dropTarget(rooms, "a", LIBRARY[0])).toBeNull();
    expect(dropTarget(rooms, "a", middle(lot))).toBeNull();
    expect(dropTarget(rooms, "a", middle(m))).toBeNull();
    expect(dropTarget(rooms, "gone", middle(a))).toBeNull();
  });

  test("after the move, someone at their desk stays seated in the room where it went", () => {
    const office = new Office(seeded(21));
    const agents = [agent("t1", "a", "working"), agent("t2", "b", "working")];
    const info = new Map(agents.map((a) => [a.address, { status: a.status, app: a.app }]));
    const placed = (order) => layoutFloor(roomsOf(order, agents), 1000).rooms.filter((r) => !r.newRoom);
    office.sync(placed([space("a"), space("b")]), info);
    settle(office);
    const moved = placed([space("b"), space("a")]); // b を先頭へ
    office.sync(moved, info);
    const c = office.chars.get("t2");
    expect(c.seated).toBe(true);
    expect(office.global(c)).toEqual({ x: moved[0].ox + moved[0].seats[0].cx, y: moved[0].oy + LANE_Y });
  });
});

describe("planPath", () => {
  const room = roomOf(space("a"), ["t1", "t2"].map((t) => agent(t, "a")));
  // 机（と体の幅 9）にぶつかる縦の移動がないこと
  const crossesDesk = (from, pts) => {
    let p = from;
    for (const q of pts) {
      const vertical = p.x === q.x;
      const spansDesk = Math.min(p.y, q.y) < BACK + 21 && Math.max(p.y, q.y) > BACK;
      if (vertical && spansDesk && q.x > DESK_X - 9 && q.x < room.deskEnd + 9) return true;
      if (!vertical && q.y > BACK - 1 && q.y < BACK + 21 && Math.max(p.x, q.x) > DESK_X - 9 && Math.min(p.x, q.x) < room.deskEnd + 9) return true;
      p = q;
    }
    return false;
  };

  test("behind the desk: along the lane", () => {
    const from = { x: LEFT_PASS, y: 66 };
    const pts = planPath(room, from, { x: room.seats[1].cx, y: LANE_Y });
    expect(pts).toEqual([{ x: LEFT_PASS, y: LANE_Y }, { x: room.seats[1].cx, y: LANE_Y }]);
  });

  test("to the library: around the desk, out along the front corridor, up the hallway", () => {
    const placed = layoutFloor([room], 1000).rooms[0];
    const from = { x: placed.seats[1].cx, y: LANE_Y };
    const spot = { x: LIBRARY[0].x - placed.ox, y: LIBRARY[0].y - placed.oy };
    const pts = planPath(placed, from, spot);
    expect(pts.at(-1)).toEqual(spot);
    expect(crossesDesk(from, pts)).toBe(false);
    // 部屋の外（x < 0）に出るのは、手前の通路（仕切りより手前）か、廊下の中だけ
    let p = from;
    for (const q of pts) {
      if (q.x < 0 && p.x >= 0) expect(q.y).toBe(CORRIDOR_Y);
      if (q.x < 0 || p.x < 0) expect(Math.max(p.y, q.y) > PART_END || Math.max(p.x, q.x) <= -(placed.ox - HALL_W)).toBe(true);
      expect(p.x === q.x || p.y === q.y).toBe(true);
      p = q;
    }
    // 帰りも同じ道
    const back = planPath(placed, spot, from);
    expect(back.at(-1)).toEqual(from);
    expect(crossesDesk(spot, back)).toBe(false);
  });

  test("seat to the front floor goes around the desk", () => {
    const from = { x: room.seats[0].cx, y: LANE_Y };
    const to = { x: room.seats[0].cx + 10, y: 120 };
    const pts = planPath(room, from, to);
    expect(pts.at(-1)).toEqual(to);
    expect(crossesDesk(from, pts)).toBe(false);
    expect(pts.some((p) => p.x === LEFT_PASS || p.x === room.rightPass)).toBe(true);
  });

  test("front floor back to a seat goes around the desk too", () => {
    const from = { x: 150, y: 110 };
    const to = { x: room.seats[1].cx, y: LANE_Y };
    const pts = planPath(room, from, to);
    expect(pts.at(-1)).toEqual(to);
    expect(crossesDesk(from, pts)).toBe(false);
  });

  test("every segment is horizontal or vertical", () => {
    const from = { x: 30, y: 125 };
    let p = from;
    for (const q of planPath(room, from, { x: LIBRARY[1].x - HALL_W, y: LIBRARY[1].y })) {
      expect(p.x === q.x || p.y === q.y).toBe(true);
      p = q;
    }
  });
});

describe("floorPath", () => {
  // 2 つの部屋（a に t1、b に t2）を、幅 width のフロアに並べる（1000 なら 1 列、300 なら 2 列）
  const floor = (width) => {
    const rooms = roomsOf([space("a"), space("b")], [agent("t1", "a"), agent("t2", "b")]);
    return layoutFloor(rooms, width).rooms.filter((r) => !r.newRoom);
  };
  const lane = (room, i = 0, dx = 0) => ({ x: room.ox + room.seats[i].cx + dx, y: room.oy + LANE_Y });
  // 縦横の線分 p→q が、四角 [x0, x1] x [y0, y1] の内側を通るか
  const hits = (p, q, x0, x1, y0, y1) =>
    Math.max(p.x, q.x) > x0 && Math.min(p.x, q.x) < x1 && Math.max(p.y, q.y) > y0 && Math.min(p.y, q.y) < y1;
  // 通れない所: 机（体の幅 9 を足す）、左の仕切り、奥の壁。どれか 1 つでも横切ったら、その名前
  const blocked = (rooms, from, pts) => {
    let p = from;
    for (const q of pts) {
      if (p.x !== q.x && p.y !== q.y) return "diagonal";
      for (const r of rooms) {
        if (hits(p, q, r.ox + DESK_X - 9, r.ox + r.deskEnd + 9, r.oy + BACK, r.oy + BACK + 21)) return `desk of ${r.id}`;
        if (hits(p, q, r.ox, r.ox + PART_W, r.oy, r.oy + PART_END)) return `partition of ${r.id}`;
        if (hits(p, q, r.ox, r.ox + r.w, r.oy, r.oy + WALL_H)) return `wall of ${r.id}`;
      }
      p = q;
    }
    return null;
  };
  const check = (rooms, from, to) => {
    const pts = floorPath(rooms, from, to);
    expect(pts.at(-1)).toEqual(to);
    expect(blocked(rooms, from, pts)).toBeNull();
    return pts;
  };

  test("to the next room in the same row: out the front, along the corridor, in by its door", () => {
    const [a, b] = floor(1000);
    expect(b.oy).toBe(a.oy);
    const pts = check([a, b], lane(a), lane(b, 0, 10));
    expect(pts.some((p) => p.y === a.oy + CORRIDOR_Y)).toBe(true);
    expect(pts.every((p) => p.x >= a.ox)).toBe(true); // 廊下へは出ない
    check([a, b], lane(b, 0, 10), lane(a)); // 帰り（右から左）
  });

  test("to a room in another row: through the hallway", () => {
    const [a, b] = floor(300);
    expect(b.oy).toBe(a.oy + ROOM_H);
    const pts = check([a, b], lane(a), lane(b, 0, 10));
    expect(pts.some((p) => p.x < HALL_W)).toBe(true);
    check([a, b], lane(b, 0, 10), lane(a));
    // まっすぐ下りる道なら、机や壁を横切る（この確かめ方が効いていること）
    expect(blocked([a, b], lane(a), [{ x: lane(a).x, y: lane(b).y }, lane(b)])).not.toBeNull();
  });

  test("from the library in the hallway, and to it from a room in the second row", () => {
    const rooms = floor(300);
    check(rooms, LIBRARY[1], lane(rooms[1], 0, 10));
    check(rooms, lane(rooms[1]), LIBRARY[0]);
    check(rooms, { x: rooms[1].ox + 60, y: rooms[1].oy + 120 }, LIBRARY[2]); // 手前の床から
  });

  test("which room a point is in; the hallway is none", () => {
    const [a, b] = floor(300);
    expect(roomAt([a, b], lane(a))?.id).toBe("a");
    expect(roomAt([a, b], lane(b))?.id).toBe("b");
    expect(roomAt([a, b], LIBRARY[0])).toBeNull();
  });
});

describe("Office", () => {
  test("a working agent sits at its seat and types", () => {
    const { rooms, info } = world({ t1: "working" });
    const office = new Office(seeded());
    office.sync(rooms, info);
    const c = office.chars.get("t1");
    expect(c.seated).toBe(true); // 席の後ろから始まるので、そのまま座る
    expect(c.behavior).toBe("type");
  });

  test("an idle agent stands up and wanders, then comes back when it works again", () => {
    const office = new Office(seeded(2));
    let w = world({ t1: "working" });
    office.sync(w.rooms, w.info);
    w = world({ t1: "idle" });
    office.sync(w.rooms, w.info);
    const c = office.chars.get("t1");
    expect(c.seated).toBe(false);
    expect(c.behavior).toBe("wander");
    let walked = false;
    for (let t = 0; t < 20000; t += 160) {
      office.tick(160);
      if (c.path.length) walked = true;
    }
    expect(walked).toBe(true);
    w = world({ t1: "working" });
    office.sync(w.rooms, w.info);
    settle(office);
    expect(c.seated).toBe(true);
    expect(c.x).toBe(w.rooms[0].seats[0].cx);
  });

  test("reading goes to the library at the top of the hallway; two readers stand side by side", () => {
    const office = new Office(seeded(3));
    const w = world({ t1: "working", t2: "working" }, { acts: { t1: "read", t2: "read" } });
    const placed = layoutFloor(w.rooms, 1000).rooms.filter((r) => !r.newRoom);
    office.sync(placed, w.info);
    settle(office);
    const room = placed[0];
    const at = (addr) => { const c = office.chars.get(addr); return [c.x + room.ox, c.y + room.oy]; }; // フロア全体の座標
    expect(at("t1")).toEqual([LIBRARY[0].x, LIBRARY[0].y]);
    expect(at("t2")).toEqual([LIBRARY[1].x, LIBRARY[1].y]);
    expect(office.chars.get("t1").seated).toBe(false);
  });

  test("when the rooms reflow, someone out in the hallway walks again from their room", () => {
    const office = new Office(seeded(12));
    const w = world({ t1: "working" }, { acts: { t1: "read" } });
    let placed = layoutFloor(w.rooms, 1000).rooms.filter((r) => !r.newRoom);
    office.sync(placed, w.info);
    for (let t = 0; t < 4000; t += 160) office.tick(160); // 歩いている途中
    placed = placed.map((r) => ({ ...r, ox: r.ox + 200, oy: r.oy + ROOM_H }));
    office.sync(placed, w.info);
    settle(office, 60000); // 部屋が遠くへ動いたので、道が長い
    const c = office.chars.get("t1");
    expect([c.x + placed[0].ox, c.y + placed[0].oy]).toEqual([LIBRARY[0].x, LIBRARY[0].y]);
  });

  test("blocked stands behind its seat with a bubble, done sits with a check", () => {
    const office = new Office(seeded(4));
    let w = world({ t1: "blocked", t2: "done" }, { kinds: { t1: "question" } });
    office.sync(w.rooms, w.info);
    settle(office);
    const room = w.rooms[0];
    const d = drawables(room, office);
    expect(d.find((x) => x.id === "bubble-t1")?.img).toBe("bubble-ask");
    expect(d.find((x) => x.id === "bubble-t2")?.img).toBe("bubble-done");
    expect(d.find((x) => x.id === "char-t1")?.img).toMatch(/-raise-[01]$/);
    expect(d.find((x) => x.id === "char-t2")?.img).toMatch(/-sit-happy$/);
  });

  test("when a seat shifts, a seated agent stands up where it was and walks to the new seat", () => {
    const office = new Office(seeded(8));
    let w = world({ t1: "working", t2: "working" });
    office.sync(w.rooms, w.info);
    const c = office.chars.get("t2");
    const old = w.rooms[0].seats[1].cx;
    w = world({ t2: "working" });
    office.sync(w.rooms, w.info);
    expect([c.seated, c.x]).toEqual([false, old]);
    settle(office);
    expect([c.seated, c.x]).toEqual([true, w.rooms[0].seats[0].cx]);
  });

  test("agents that are gone are removed", () => {
    const office = new Office(seeded(5));
    let w = world({ t1: "idle", t2: "idle" });
    office.sync(w.rooms, w.info);
    w = world({ t2: "idle" });
    office.sync(w.rooms, w.info);
    expect([...office.chars.keys()]).toEqual(["t2"]);
  });
});

describe("drawables", () => {
  test("the look follows the model, the headband the effort, and max effort burns while typing", () => {
    const office = new Office(seeded(10));
    const w = world({ t1: "working", t2: "working", t3: "idle" }, {
      models: { t1: { model: "claude-opus-5-5", effort: "max" }, t2: { model: "claude-haiku-5-5", effort: "low" },
        t3: { model: "claude-fable-5-2", effort: "high" } },
    });
    office.sync(w.rooms, w.info);
    const d = drawables(w.rooms[0], office);
    const get = (id) => d.find((x) => x.id === id);
    expect(get("char-t1").img).toMatch(/^char\/claude-opus-sit-[01]$/);
    expect(get("char-t1").over).toBe(get("char-t1").img.replace(/^char\/claude-opus-/, "band/red-")); // 同じポーズの鉢巻き
    expect(get("flame-t1").img).toMatch(/^fx-flame-[01]$/);
    expect(get("char-t2").img).toMatch(/^char\/claude-haiku-sit-[01]$/);
    expect(get("char-t2").over).toBeNull(); // low は鉢巻きなし
    expect(get("flame-t2")).toBeUndefined();
    expect(get("char-t3").img).toMatch(/^char\/claude-fable-(stand|blink)$/);
    expect(get("char-t3").over).toMatch(/^band\/white-(stand|blink)$/);
    expect(get("char-t1").tip).toContain("Opus 5.5 · max");
  });

  test("painter's order: chair, seated agent, desk, laptop, hands; bubbles on top", () => {
    const office = new Office(seeded(6));
    const w = world({ t1: "working", t2: "done" });
    office.sync(w.rooms, w.info);
    const d = drawables(w.rooms[0], office);
    const at = (id) => d.findIndex((x) => x.id === id);
    expect(at("chair-0")).toBeLessThan(at("char-t1"));
    expect(at("char-t1")).toBeLessThan(at("desk-0"));
    expect(at("desk-0")).toBeLessThan(at("laptop-0"));
    expect(at("laptop-0")).toBeLessThan(at("hands-t1"));
    expect(at("bubble-t2")).toBe(d.length - 1);
  });

  test("only the empty seat hires, characters focus their terminal", () => {
    const office = new Office(seeded(7));
    const w = world({ t1: "working" });
    office.sync(w.rooms, w.info);
    const d = drawables(w.rooms[0], office);
    const hire = { type: "hire", space: "sp1", machine: null };
    expect(d.find((x) => x.id === "chair-0").click).toBeUndefined();
    expect(d.find((x) => x.id === "chair-1").click).toEqual(hire);
    expect(d.find((x) => x.id === "hire-1").click).toEqual(hire);
    expect(d.find((x) => x.id === "char-t1").click).toEqual({ type: "focus", terminal: "t1" });
  });

  test("the empty seat looks different: green chair, no laptop, a + sign", () => {
    const office = new Office(seeded(9));
    const w = world({ t1: "idle" }); // 席を立っていても、本人の席は空席にならない
    office.sync(w.rooms, w.info);
    const d = drawables(w.rooms[0], office);
    expect(d.find((x) => x.id === "chair-0").img).toBe("chair");
    expect(d.find((x) => x.id === "laptop-0")).toMatchObject({ // PC: タブのメニュー（クリックは表示してから）
      click: { type: "tab-menu", terminal: "t1", focus: true }, right: { type: "tab-menu", terminal: "t1" } });
    expect(d.find((x) => x.id === "chair-1").img).toBe("chair-free");
    expect(d.find((x) => x.id === "laptop-1")).toBeUndefined();
    expect(d.find((x) => x.id === "hire-1")?.img).toBe("hire-sign");
    expect(d.find((x) => x.id === "hire-0")).toBeUndefined();
  });
});

describe("wall plates", () => {
  test("a long space name keeps its head and tail around a … (about as long as herdr-ai-office)", () => {
    expect(plateText("herdr-ai-office")).toBe("herdr-ai-office"); // 15 は入る
    expect(plateText("webapp-v2-feature-fix-login")).toBe("webapp-v…x-login");
    expect(plateText("webapp-v2-feature-add-docs")).toBe("webapp-v…dd-docs"); // 頭が同じでも、終わりで見分けられる
    expect(plateText("office-test-3 名前がとても長いスペースで名札とホワイトボードの並びを確かめる部屋")).toBe("office-t…る部屋"); // 全角は 2
    expect(plateText("日本語のスペース名です")).toBe("日本語の…名です");
    expect(plateText("")).toBe("");
  });
});

describe("who sits where", () => {
  const claude = { name: "Claude Code", key: "claude", agent: true };
  test("the seat name is the tab bar's: a given tab name stays, an unnamed tab follows the agent's live title", () => {
    expect(seatName({ tabName: "1", named: null, program: claude, title: "✳ Fix the login bug", address: "t1" })).toBe("Fix the login bug");
    expect(seatName({ tabName: "reviewer", named: true, program: claude, title: "✳ Fix the login bug", address: "t1" })).toBe("reviewer");
    expect(seatName({ tabName: "Claude Code", named: true, program: claude, title: "Fix it", address: "t1" })).toBe("Fix it");
    // 役に立たないタイトル（フォルダの道・アドレス・空）なら、名前のないタブはプログラムの名前
    expect(seatName({ tabName: "1", named: null, program: claude, title: "~/Code/x", address: "t1" })).toBe("Claude Code");
    expect(seatName({ tabName: "1", named: null, program: claude, title: "t1", address: "t1" })).toBe("Claude Code");
    expect(seatName({ tabName: "1", named: null, program: claude, title: "", address: "t1" })).toBe("Claude Code");
  });

  test("the open tab's agents are the ones in the shown space's active tab (all of them when it is split)", () => {
    const spaces = [
      { id: "a", active: false, tabs: [{ id: "a1", active: true }] },
      { id: "b", active: true, tabs: [{ id: "b1", active: false }, { id: "b2", active: true }] },
    ];
    const agents = [
      { address: "t1", tab: "a1" }, // 見ていないスペースの、そこで開いているタブ
      { address: "t2", tab: "b1" },
      { address: "t3", tab: "b2" },
      { address: "t4", tab: "b2" }, // 同じタブを分けている
    ];
    expect([...openAgents(spaces, agents)]).toEqual(["t3", "t4"]);
    expect(openAgents([{ id: "a", active: true, tabs: [] }], agents).size).toBe(0);
    expect(openAgents([], agents).size).toBe(0);
  });

  test("each taken seat has a name plate on the desk; the plate, the laptop and the person share the owner", () => {
    const office = new Office(seeded(9));
    const w = world({ t1: "working", t2: "idle" });
    w.info.get("t1").seatName = "Fix the login bug";
    office.sync(w.rooms, w.info);
    settle(office);
    const d = drawables(w.rooms[0], office);
    const plate = d.find((x) => x.id === "name-0");
    expect(plate).toMatchObject({ plate: "Fix the login bug", owner: "t1", click: { type: "focus", terminal: "t1" }, y: BACK + 10 });
    expect(d.find((x) => x.id === "laptop-0").owner).toBe("t1");
    expect(d.find((x) => x.id === "char-t1").owner).toBe("t1");
    expect(d.find((x) => x.id === "name-1").owner).toBe("t2"); // 席を立っている人の名札も席に残る
    expect(d.find((x) => x.id === "name-2")).toBeUndefined(); // 空いた席には名札がない
    expect(plate.z).toBeGreaterThan(d.find((x) => x.id === "hands-t1").z);
  });
});

describe("clockHands", () => {
  const at = (h, m) => clockHands(h * 60 + m); // その場所の 0 時からの分
  test("the hour hand points at the hour (floored), the minute hand moves every 5 minutes", () => {
    expect(at(0, 0)).toEqual({ h: 0, m: 0 });
    expect(at(2, 31)).toEqual({ h: 2, m: 6 });
    expect(at(12, 4)).toEqual({ h: 0, m: 0 });
    expect(at(12, 5)).toEqual({ h: 0, m: 1 });
    expect(at(23, 59)).toEqual({ h: 11, m: 11 });
  });
});

describe("skills", () => {
  test("SKILL.md front matter: plain, quoted, folded, and missing", () => {
    expect(parseSkillFile("---\nname: herdr\ndescription: \"Control Herdr: panes\"\n---\nbody", "dir"))
      .toEqual({ name: "herdr", description: "Control Herdr: panes", invocable: true });
    expect(parseSkillFile("---\nname: x\ndescription: >\n  one\n  two\nuser-invocable: false\n---\n", "dir"))
      .toEqual({ name: "x", description: "one two", invocable: false });
    expect(parseSkillFile("# New Skill\n", "new-skill")).toEqual({ name: "new-skill", description: "", invocable: true });
  });

  test("books line up by source then name, three rows of 13", () => {
    const sk = (id, source) => ({ id, name: id, source, description: "" });
    const sorted = sortSkills([sk("b", "plugin"), sk("z", "user"), sk("a", "codex"), sk("y", "user")]);
    expect(sorted.map((x) => x.id)).toEqual(["y", "z", "b", "a"]);
    const many = Array.from({ length: 41 }, (_, i) => sk(`s${String(i).padStart(2, "0")}`, "user"));
    const { books, more } = shelfBooks(many);
    expect(books).toHaveLength(39);
    expect(more).toBe(2);
    expect(books[0]).toMatchObject({ x: SHELF.left, w: 2 });
    expect(books[0].y + books[0].h).toBe(SHELF.bases[0]);
    expect(books[13].y + books[13].h).toBe(SHELF.bases[1]);
    expect(books[12].x + books[12].w).toBeLessThanOrEqual(SHELF.right);
  });

  test("a used skill matches its book with or without the namespace", () => {
    expect(sameSkill("herdr", "herdr")).toBe(true);
    expect(sameSkill("pdf", "anthropic-skills:pdf")).toBe(true);
    expect(sameSkill("codex:rescue", "codex:rescue")).toBe(true);
    expect(sameSkill("codex:rescue", "other:rescue")).toBe(false);
    expect(sameSkill(null, "herdr")).toBe(false);
  });

  test("reading a skill takes its book off the shelf and shows its name; at the desk the tag stays", () => {
    const office = new Office(seeded(11));
    const skills = sortSkills([{ id: "herdr", name: "herdr", source: "user" }, { id: "codex:rescue", name: "rescue", source: "plugin" }]);
    let w = world({ t1: "working" }, { acts: { t1: "read" } });
    w.info.get("t1").skill = "herdr";
    office.sync(w.rooms, w.info);
    settle(office);
    let d = drawables(w.rooms[0], office, skills);
    expect(d.find((x) => x.id === "shelf")).toBeUndefined(); // 本棚は部屋ではなく資料室に 1 つ
    const shelf = floorDrawables(office, skills)[0];
    expect(shelf.click).toEqual({ type: "skills" });
    expect(shelf.books.map((b) => b.skill.id)).toEqual(["codex:rescue"]); // herdr は読まれているので棚にない
    expect(d.find((x) => x.id === "tag-t1")).toMatchObject({ text: "herdr" });
    // 調べ終わって席で作業（skill はターンが終わるまで残る）
    w = world({ t1: "working" }, { acts: { t1: "edit" } });
    w.info.get("t1").skill = "herdr";
    office.sync(w.rooms, w.info);
    settle(office);
    d = drawables(w.rooms[0], office, skills);
    expect(floorDrawables(office, skills)[0].books).toHaveLength(2);
    expect(d.find((x) => x.id === "tag-t1")).toMatchObject({ text: "herdr" });
  });
});

describe("skill errands", () => {
  // 部屋を並べてから、t1 の情報を少しずつ変えて同期する
  function floorWorld(extra = {}) {
    const w = world({ t1: "working" }, { acts: { t1: "edit" } });
    Object.assign(w.info.get("t1"), extra);
    return { rooms: layoutFloor(w.rooms, 1000).rooms.filter((r) => !r.newRoom), info: w.info };
  }
  const atLibrary = (office, rooms) => {
    const c = office.chars.get("t1");
    return c.x + rooms[0].ox === LIBRARY[0].x && c.y + rooms[0].oy === LIBRARY[0].y;
  };
  const runUntil = (office, done, ms = 60000) => {
    for (let t = 0; t < ms && !done(); t += 160) office.tick(160);
    return done();
  };

  test("using a skill sends them to the library even while the agent moves on, then they run back", () => {
    const office = new Office(seeded(13));
    let w = floorWorld();
    office.sync(w.rooms, w.info);
    const c = office.chars.get("t1");
    expect(c.seated).toBe(true);
    // skill を使った（エージェントはもう次のツール: act は edit のまま）
    w = floorWorld({ skill: "herdr", skillAt: "100" });
    office.sync(w.rooms, w.info);
    expect([c.behavior, c.run, c.seated]).toEqual(["read", true, false]);
    expect(runUntil(office, () => atLibrary(office, w.rooms))).toBe(true);
    office.sync(w.rooms, w.info); // 着いても、状態（working・edit）に引き戻されない
    expect(c.behavior).toBe("read");
    const d = drawables(w.rooms[0], office, []);
    expect(d.find((x) => x.id === "tag-t1")).toMatchObject({ text: "herdr" });
    // 読み終わったら席へ戻ってタイピング
    for (let t = 0; t < ERRAND_READ_MS + 160; t += 160) office.tick(160);
    expect(c.errand).toBeNull();
    expect(c.run).toBe(true);
    expect(runUntil(office, () => c.seated)).toBe(true);
    expect(c.behavior).toBe("type");
  });

  test("plain research trips to the library run too, and so does the way back", () => {
    const office = new Office(seeded(16));
    let w = floorWorld();
    office.sync(w.rooms, w.info);
    const c = office.chars.get("t1");
    w = floorWorld({ act: "read" });
    office.sync(w.rooms, w.info);
    expect([c.behavior, c.run]).toEqual(["read", true]);
    expect(runUntil(office, () => atLibrary(office, w.rooms))).toBe(true);
    w = floorWorld({ act: "edit" });
    office.sync(w.rooms, w.info);
    expect([c.behavior, c.run]).toEqual(["type", true]);
  });

  test("the value seen first is not an event; the same skill used again is", () => {
    const office = new Office(seeded(14));
    let w = floorWorld({ skill: "herdr", skillAt: "100" });
    office.sync(w.rooms, w.info);
    const c = office.chars.get("t1");
    expect(c.errand ?? null).toBeNull();
    w = floorWorld({ skill: "herdr", skillAt: "101" });
    office.sync(w.rooms, w.info);
    expect(c.errand).toMatchObject({ skill: "herdr" });
  });

  test("a question cuts the errand short: they raise a hand at once", () => {
    const office = new Office(seeded(15));
    let w = floorWorld();
    office.sync(w.rooms, w.info);
    w = floorWorld({ skill: "herdr", skillAt: "100" });
    office.sync(w.rooms, w.info);
    w = floorWorld({ skill: "herdr", skillAt: "100", status: "blocked" });
    office.sync(w.rooms, w.info);
    const c = office.chars.get("t1");
    expect(c.errand).toBeNull();
    expect(c.behavior).toBe("raise");
  });
});

describe("talking to another agent (hc send)", () => {
  // 部屋 a に t1（作業中）、部屋 b に t2（待機、タブの名前 reviewer）と t3（作業中）。extra で t1 などの情報を足す
  function talkWorld(width, extra = {}) {
    const agents = [agent("t1", "a", "working"), agent("t2", "b", "idle"), agent("t3", "b", "working")];
    const rooms = layoutFloor(roomsOf([space("a"), space("b")], agents), width).rooms.filter((r) => !r.newRoom);
    const info = new Map(agents.map((x) => [x.address, {
      status: x.status, app: x.app, act: "edit", tname: null, tab: x.address === "t2" ? "reviewer" : "1", ...extra[x.address],
    }]));
    return { rooms, info };
  }
  const start = (office, width = 1000) => {
    office.sync(...Object.values(talkWorld(width)));
    for (let t = 0; t < 3000; t += 160) office.tick(160);
  };
  const runUntil = (office, done, ms = 60000) => {
    for (let t = 0; t < ms && !done(); t += 160) office.tick(160);
    return done();
  };
  const arrived = (c) => c.errand?.left != null && !c.path.length;
  const sync = (office, width, extra) => {
    const w = talkWorld(width, extra);
    office.sync(w.rooms, w.info);
    return w;
  };

  test("the sender runs to the other room, says what it sent, hears back, and runs to its seat", () => {
    const office = new Office(seeded(21));
    start(office);
    const w = sync(office, 1000, { t1: { talk: "t3", talkAt: "1", talkText: "Please review src/x.rs only" } });
    const c = office.chars.get("t1");
    expect(c.errand).toMatchObject({ kind: "talk", to: "t3", text: "Please review src/x.rs only" });
    expect([c.behavior, c.run, c.seated]).toEqual(["visit", true, false]);
    expect(runUntil(office, () => arrived(c))).toBe(true);
    // t3 は座って作業中: その椅子の後ろの通路（右）に立ち、t3 の方を向く
    const b = w.rooms[1];
    expect(office.global(c)).toEqual({ x: b.ox + b.seats[1].cx + 12, y: b.oy + LANE_Y });
    expect(c.facing).toBe("l");
    // 話しかけた人の番: 送った文の札。相手の番: 相手に「…」
    expect(drawables(w.rooms[0], office).find((d) => d.id === "tag-t1")).toMatchObject({ text: "Please review…" });
    for (let t = 0; t < TALK_TURN_MS; t += 160) office.tick(160);
    expect(drawables(b, office).find((d) => d.id === "talk-t3")?.img).toBe("bubble-talk");
    expect(drawables(w.rooms[0], office).find((d) => d.id === "tag-t1")).toBeUndefined();
    // 話し終わったら、小走りで自分の席へ戻って座る
    for (let t = 0; t < TALK_MS; t += 160) office.tick(160);
    expect(c.errand).toBeNull();
    expect(c.run).toBe(true);
    expect(runUntil(office, () => c.seated)).toBe(true);
    expect(c.x).toBe(w.rooms[0].seats[0].cx);
  });

  test("within one room: along the lane behind the desk, never leaving the room", () => {
    const office = new Office(seeded(29));
    start(office);
    // b の t3（右の席）が、同じ部屋の t2（左の席、作業中で座っている）へ話しかける。帰りは自分の席へ
    const w = sync(office, 1000, { t2: { status: "working" }, t3: { talk: "reviewer", talkAt: "1", talkText: "ここ見て" } });
    const b = w.rooms[1];
    const c = office.chars.get("t3");
    expect(c.errand).toMatchObject({ kind: "talk", to: "t2" });
    const inRoom = () => roomAt(w.rooms, office.global(c))?.id === "b";
    let stayed = true;
    expect(runUntil(office, () => {
      if (!inRoom()) stayed = false;
      return arrived(c);
    })).toBe(true);
    expect(office.global(c)).toEqual({ x: b.ox + b.seats[0].cx + 12, y: b.oy + LANE_Y });
    expect(c.facing).toBe("l");
    // t2 がまだ席へ戻る途中なら、座るまで待ってから話しだす（待っている間は札も吹き出しも出さず、話す時間も減らない）
    const t2 = office.chars.get("t2");
    expect(t2.path.length).toBeGreaterThan(0); // この乱数の種では、t3 が着いたとき t2 はまだ歩いている
    expect(drawables(b, office).find((d) => d.id === "tag-t3")).toBeUndefined();
    const left = c.errand.left;
    office.tick(160);
    expect(c.errand.left).toBe(left);
    expect(runUntil(office, () => t2.seated)).toBe(true);
    expect(drawables(b, office).find((d) => d.id === "tag-t3")).toMatchObject({ text: "ここ見て" });
    for (let t = 0; t < TALK_TURN_MS; t += 160) office.tick(160);
    expect(drawables(b, office).find((d) => d.id === "talk-t2")?.img).toBe("bubble-talk");
    for (let t = 0; t < TALK_MS; t += 160) office.tick(160);
    expect(runUntil(office, () => {
      if (!inRoom()) stayed = false;
      return c.seated;
    })).toBe(true);
    expect(stayed).toBe(true);
    expect(c.x).toBe(b.seats[1].cx);
  });

  test("rooms in different rows: through the hallway, to the same spot", () => {
    const office = new Office(seeded(22));
    start(office, 300);
    const w = sync(office, 300, { t1: { talk: "t3", talkAt: "1" } });
    const c = office.chars.get("t1");
    expect(w.rooms[1].oy).toBe(ROOM_H);
    let hallway = false;
    expect(runUntil(office, () => {
      if (office.global(c).x < HALL_W) hallway = true;
      return arrived(c);
    })).toBe(true);
    expect(hallway).toBe(true);
    expect(office.global(c)).toEqual({ x: w.rooms[1].ox + w.rooms[1].seats[1].cx + 12, y: ROOM_H + LANE_Y });
    // 文が分からなければ、話しかけた人も「…」
    expect(drawables(w.rooms[0], office).find((d) => d.id === "talk-t1")?.img).toBe("bubble-talk");
  });

  test("the other agent is found by address, hc name or tab name; self and strangers are no-ops", () => {
    const office = new Office(seeded(23));
    start(office);
    sync(office, 1000, { t1: { talk: "reviewer", talkAt: "1" } });
    expect(office.chars.get("t1").errand?.to).toBe("t2");
    sync(office, 1000, { t1: { talk: "rev3", talkAt: "2" }, t3: { tname: "rev3" } });
    expect(office.chars.get("t1").errand?.to).toBe("t3");
    const other = new Office(seeded(24));
    start(other);
    sync(other, 1000, { t1: { talk: "t1", talkAt: "1" } });
    sync(other, 1000, { t1: { talk: "nobody", talkAt: "2" } });
    expect(other.chars.get("t1").errand ?? null).toBeNull();
    expect(other.chars.get("t1").behavior).toBe("type");
  });

  test("an idle agent that starts working on the message is followed to its seat", () => {
    const office = new Office(seeded(25));
    start(office);
    sync(office, 1000, { t1: { talk: "t2", talkAt: "1" } });
    const c = office.chars.get("t1");
    const before = { ...c.errand.spot };
    // 届いた依頼で t2 が作業を始めると、席へ戻って座る。話しかけた人はそちらへ行き直す
    const w = sync(office, 1000, { t1: { talk: "t2", talkAt: "1" }, t2: { status: "working" } });
    const b = w.rooms[1];
    expect(c.errand.spot).toEqual({ x: b.ox + b.seats[0].cx + 12, y: b.oy + LANE_Y });
    expect(c.errand.spot).not.toEqual(before);
    expect(runUntil(office, () => arrived(c))).toBe(true);
    expect(office.global(c)).toEqual(c.errand.spot);
  });

  test("a wandering agent being visited does not walk off", () => {
    const office = new Office(seeded(26));
    start(office);
    sync(office, 1000, { t1: { talk: "t2", talkAt: "1" } });
    const c = office.chars.get("t1");
    const t2 = office.chars.get("t2");
    runUntil(office, () => !t2.path.length); // 歩いている途中なら、その行き先までは歩く
    const at = { x: t2.x, y: t2.y };
    expect(runUntil(office, () => arrived(c))).toBe(true);
    expect({ x: t2.x, y: t2.y }).toEqual(at);
  });

  test("both hooks report the same message: one visit; a later message is a new one", () => {
    const office = new Office(seeded(27));
    start(office);
    sync(office, 1000, { t1: { talk: "t3", talkAt: "1", talkText: "hi" } });
    const c = office.chars.get("t1");
    const errand = c.errand;
    // 少しあとで、受け取った t3 のフックも同じ話しかけを書く
    for (let t = 0; t < 2000; t += 160) office.tick(160);
    sync(office, 1000, { t1: { talk: "t3", talkAt: "1", talkText: "hi" }, t3: { heard: "t1", heardAt: "9", heardText: "hi" } });
    expect(c.errand).toBe(errand);
    // 受け取った側だけ（送った人にフックがない: Codex など）でも行く。ただし、行ったばかりの 2 人は数えない
    runUntil(office, () => c.seated, 60000);
    for (let t = 0; t < TALK_DEDUP_MS; t += 160) office.tick(160);
    sync(office, 1000, { t1: { talk: "t3", talkAt: "1" }, t3: { heard: "t1", heardAt: "10", heardText: "again" } });
    expect(c.errand).toMatchObject({ kind: "talk", to: "t3", text: "again" });
  });

  test("a question cuts the visit short, and a blocked agent does not set out", () => {
    const office = new Office(seeded(28));
    start(office);
    sync(office, 1000, { t1: { talk: "t3", talkAt: "1" } });
    const w = sync(office, 1000, { t1: { talk: "t3", talkAt: "1", status: "blocked", kind: "question" } });
    const c = office.chars.get("t1");
    expect(c.errand).toBeNull();
    expect(c.behavior).toBe("raise");
    expect(runUntil(office, () => !c.path.length)).toBe(true);
    expect(office.global(c)).toEqual({ x: w.rooms[0].ox + w.rooms[0].seats[0].cx, y: LANE_Y });
    sync(office, 1000, { t1: { talk: "t3", talkAt: "2", status: "blocked", kind: "question" } });
    expect(c.errand).toBeNull();
  });

  test("the label is cut short", () => {
    expect(talkLabel("  short\n text ")).toBe("short text");
    expect(talkLabel("レビューをお願いします。src/x.rs だけ")).toBe("レビューをお願いします。s…");
  });
});

describe("themes from the themes/ folder", () => {
  test("the bundled themes load in their order, with their own pictures where they differ", () => {
    expect(themeList().map((t) => [t.name, t.label])).toEqual([["modern", "モダン"], ["classic", "クラシック"]]);
    const modern = themeList()[0];
    expect(modern.IMAGES.wall).toEqual({ src: "mods/ai-office/themes/modern/wall.png", w: 512, h: 30 });
    expect(modern.IMAGES.glass).toMatchObject({ w: 24, h: 14 });
    expect(themeList()[1].IMAGES.wall.src).toBe("mods/ai-office/img/wall.png"); // classic は既定の絵
    expect(themeList().map((t) => t.WINDOW)).toEqual(["window-slide", "window"]); // 窓: modern は引き違い、classic は十字
  });

  test("pngSize reads the picture size (a quarter of the PNG) and refuses what is not a PNG", () => {
    expect(pngSize(readFileSync(`${THEMES_DIR}modern/glass-door.png`))).toEqual({ w: 20, h: 16 });
    expect(pngSize(readFileSync(`${THEMES_DIR}modern/glass-door-panel.png`))).toEqual({ w: 16, h: 14 });
    expect(pngSize(new TextEncoder().encode("not a png at all, really"))).toBeNull();
  });

  test("a broken theme is refused, with the reasons", () => {
    const json = themeJson("modern");
    const sizes = themeSizes("modern", json);
    const problems = (change) => {
      const copy = structuredClone(json);
      change(copy);
      return readTheme("broken", copy, sizes).problems.join(" / ");
    };
    expect(problems(() => {})).toBe("");
    expect(problems((j) => { j.room.deskBack = 70; })).toContain("ガラス"); // 机がガラスに重なる
    expect(problems((j) => { delete j.images.door; })).toContain("images.door");
    expect(problems((j) => { j.room.hallSide = "door"; })).toContain("room.hallSide");
    expect(problems((j) => { j.window = "round"; })).toContain("window");
    expect(problems((j) => { j.room.lane = 60; })).toContain("room.lane");
    expect(problems((j) => { j.images.wall = "missing.png"; })).toContain("読めない");
    const classic = themeJson("classic");
    classic.room.wall = 30; // 既定の壁の絵は 36
    expect(readTheme("broken", classic, {}).problems.join(" / ")).toContain("壁の絵の高さ");
  });

  test("a theme from the user's folder points its pictures there", () => {
    const json = themeJson("modern");
    const { theme } = readTheme("mine", json, themeSizes("modern", json), "ai-office-themes/mine");
    expect(theme.IMAGES.wall.src).toBe("ai-office-themes/mine/wall.png");
    expect(theme.IMAGES.floor.src).toBe("mods/ai-office/img/floor.png");
  });
});

describe("modern theme", () => {
  beforeAll(() => useTheme("modern"));
  afterAll(() => useTheme("classic"));

  test("a row is lower (the room down to the glass, then the corridor), and classic comes back unchanged", () => {
    expect(geometry().THEME).toBe("modern");
    expect({ ROOM_H, WALL_H, glassBottom: GLASS.y + GLASS.h }).toEqual({ ROOM_H: 116, WALL_H: 30, glassBottom: 100 });
    expect(SHELF.y).toBe(8);
    useTheme("classic");
    expect({ ROOM_H, WALL_H, LANE_Y, BACK, CORRIDOR_Y, PART_END, FRONT_Y })
      .toEqual({ ROOM_H: 140, WALL_H: 36, LANE_Y: 54, BACK: 74, CORRIDOR_Y: 118, PART_END: 96, FRONT_Y: [104, 132] });
    expect(GLASS).toBeNull();
    expect(LIBRARY[0]).toEqual({ x: 22, y: 66 });
    expect(SHELF.y).toBe(14);
    expect(useTheme("no-such-theme")).toBe("modern");
  });

  test("leaving the room goes through the door on the left, never past the right end of the desk", () => {
    const room = roomOf(space("sp1"), [agent("t1", "sp1"), agent("t2", "sp1")]);
    const path = planPath(room, { x: 60, y: LANE_Y }, { x: room.w - 20, y: CORRIDOR_Y });
    expect(path).toEqual([{ x: LEFT_PASS, y: LANE_Y }, { x: LEFT_PASS, y: CORRIDOR_Y }, { x: room.w - 20, y: CORRIDOR_Y }]);
    expect(path.some((p) => p.x === room.rightPass)).toBe(false);
  });

  test("to the next room on the right: out of the left door, along the corridor, in by its door", () => {
    const rooms = layoutFloor(roomsOf([space("a"), space("b")], [agent("t1", "a"), agent("t2", "b")]), 1000).rooms
      .filter((r) => !r.newRoom);
    const [a, b] = rooms;
    expect(b.oy).toBe(a.oy);
    const from = { x: a.ox + 60, y: a.oy + LANE_Y };
    const to = { x: b.ox + 60, y: b.oy + LANE_Y };
    const path = floorPath(rooms, from, to);
    expect(path[0]).toEqual({ x: a.ox + LEFT_PASS, y: a.oy + LANE_Y });
    expect(path).toContainEqual({ x: a.ox + LEFT_PASS, y: a.oy + CORRIDOR_Y });
    expect(path).toContainEqual({ x: b.ox + LEFT_PASS, y: b.oy + CORRIDOR_Y });
    expect(path.at(-1)).toEqual(to);
    expect(path.some((p) => p.x === a.ox + a.rightPass)).toBe(false);
  });

  test("wandering stays in the room: behind the desk, or on the floor right of the desk (not in the corridor)", () => {
    const office = new Office(seeded(3));
    const room = roomOf(space("sp1"), [agent("t1", "sp1")]);
    const where = new Set();
    for (let i = 0; i < 60; i++) {
      const p = office.wanderTarget(room);
      if (p.y === LANE_Y) where.add("lane");
      else if (p.x >= room.rightPass && p.x <= room.w - 28 && p.y > BACK && p.y < GLASS.y) where.add("right of the desk");
      else where.add(`bad ${p.x},${p.y}`);
    }
    expect([...where].sort()).toEqual(["lane", "right of the desk"]);
    // 机の右へは机の奥の通路から回り込み、机の前は通らない。そこから廊下へは、通路に戻って左の扉から
    const side = { x: room.rightPass + 4, y: BACK + 10 };
    expect(planPath(room, { x: 40, y: LANE_Y }, side)).toEqual([{ x: side.x, y: LANE_Y }, side]);
    expect(planPath(room, side, { x: 60, y: CORRIDOR_Y }))
      .toEqual([{ x: side.x, y: LANE_Y }, { x: LEFT_PASS, y: LANE_Y }, { x: LEFT_PASS, y: CORRIDOR_Y }, { x: 60, y: CORRIDOR_Y }]);
  });

  test("a full desk leaves no floor on the right: wandering is only behind the desk", () => {
    const office = new Office(seeded(5));
    const room = roomOf(space("sp1"), Array.from({ length: 6 }, (_, i) => agent(`t${i}`, "sp1")));
    for (let i = 0; i < 30; i++) expect(office.wanderTarget(room).y).toBe(LANE_Y);
  });

  test("the glass is in front of the desk, the plant and the sitters, and behind people in the corridor", () => {
    const { rooms, info } = world({ t1: "idle", t2: "working" });
    const office = new Office(seeded(1));
    office.sync(rooms, info);
    settle(office);
    const c = office.chars.get("t1");
    Object.assign(c, { x: 60, y: 110, path: [] }); // 横の廊下に立っている
    const out = drawables(rooms[0], office);
    const z = (id) => out.find((d) => d.id === id).z;
    expect(z("desk-0")).toBeLessThan(z("glass"));
    expect(z("plant")).toBeLessThan(z("glass"));
    expect(z("char-t2")).toBeLessThan(z("glass")); // 席で作業している
    expect(z("char-t1")).toBeGreaterThan(z("glass"));
    expect(out.find((d) => d.id === "glass")).toMatchObject({ tile: 24, x: LEFT_PASS + 8, y: GLASS.y, h: GLASS.h });
    useTheme("classic");
    expect(drawables(rooms[0], office).some((d) => ["glass", "glass-door", "glass-door-panel"].includes(d.img))).toBe(false);
    useTheme("modern");
  });

  // 自動ドアの戸の x: 閉まっていると柱のあいだ（扉の左の柱 + 2）、開ききると DOOR_SLIDE 右
  const DOOR_X = LEFT_PASS - 10 + 2;
  const panelX = (room, office) => drawables(room, office).find((d) => d.id === "glass-door-panel").x;

  // c を道に沿って歩かせる（160ms ごとに tick）。コマごとに、足元が戸口のガラスの段（柱のあいだ、ガラスの上から下）に
  // あったら、その部屋の戸の開き具合を集める。moving: 戸が開け閉めの途中だったコマがあったか
  function walk(office, c, path, { run = false } = {}) {
    Object.assign(c, { path, run, seated: false });
    const seen = [];
    let moving = false;
    for (let t = 0; t < 60000 && c.path.length; t += 160) {
      office.tick(160);
      moving ||= doorsMoving(office);
      const p = office.global(c);
      for (const r of office.rooms) {
        const { ox = HALL_W, oy = 0 } = r;
        if (Math.abs(p.x - (ox + LEFT_PASS)) <= 8 && p.y >= oy + GLASS.y && p.y <= oy + GLASS.y + GLASS.h) {
          seen.push({ room: r.id, open: office.doors.get(r.id)?.open ?? 0 });
        }
      }
    }
    return { seen, moving };
  }

  test("the glass door is an automatic door: closed, fully open while someone goes through (walking or running), then closed", () => {
    const { rooms, info } = world({ t1: "working" });
    const office = new Office(seeded(1));
    office.sync(rooms, info);
    settle(office);
    const room = rooms[0];
    expect(panelX(room, office)).toBe(DOOR_X);
    expect(doorsMoving(office)).toBe(false);
    const out = drawables(room, office);
    const z = (id) => out.find((d) => d.id === id).z;
    expect(z("glass")).toBeLessThan(z("glass-door-panel")); // 戸はガラスの手前、柱の奥（開くと柱の後ろを通る）
    expect(z("glass-door-panel")).toBeLessThan(z("glass-door"));
    const c = office.chars.get("t1");
    for (const run of [false, true]) {
      Object.assign(c, { x: LEFT_PASS, y: LANE_Y });
      const leaving = walk(office, c, planPath(room, c, { x: room.w - 20, y: CORRIDOR_Y }), { run }); // 左の扉から横の廊下へ
      expect(leaving.seen.length).toBeGreaterThan(0);
      expect(leaving.seen.every((s) => s.open === 1)).toBe(true);
      expect(leaving.moving).toBe(true);
      expect(panelX(room, office)).toBe(DOOR_X); // 廊下を歩いているうちに閉まった
      const coming = walk(office, c, planPath(room, c, { x: LEFT_PASS + 30, y: LANE_Y }), { run }); // 廊下から扉を通って中へ
      expect(coming.seen.length).toBeGreaterThan(0);
      expect(coming.seen.every((s) => s.open === 1)).toBe(true);
      for (let t = 0; t < DOOR_HOLD_MS + DOOR_MS + 320; t += 160) office.tick(160);
      expect(panelX(room, office)).toBe(DOOR_X);
      expect(doorsMoving(office)).toBe(false);
    }
    // 開いている途中の戸は、開き具合に合わせて右へ（開ききると右の柱の向こう）
    office.doors.set(room.id, { open: 1, hold: DOOR_HOLD_MS });
    expect(panelX(room, office)).toBe(DOOR_X + DOOR_SLIDE);
    office.doors.set(room.id, { open: 0.5, hold: DOOR_HOLD_MS });
    expect(panelX(room, office)).toBe(DOOR_X + DOOR_SLIDE / 2);
    expect(doorsMoving(office)).toBe(true);
  });

  test("walking along the corridor past the door, or standing at the top of the aisle, does not open it", () => {
    const { rooms, info } = world({ t1: "working" });
    const office = new Office(seeded(1));
    office.sync(rooms, info);
    settle(office);
    const room = rooms[0];
    const c = office.chars.get("t1");
    Object.assign(c, { x: room.w - 20, y: CORRIDOR_Y });
    Object.assign(c, { path: planPath(room, c, { x: -30, y: CORRIDOR_Y }), seated: false }); // 廊下をまっすぐ資料室の方へ
    let opened = 0;
    for (let t = 0; t < 30000 && c.path.length; t += 160) {
      office.tick(160);
      opened = Math.max(opened, office.doors.get(room.id)?.open ?? 0);
    }
    expect(c.x).toBe(-30);
    expect(opened).toBe(0);
    Object.assign(c, { x: LEFT_PASS, y: LANE_Y, path: [] }); // 机の奥の通路の左端（扉へ下りる通り道の上）に立っている
    for (let t = 0; t < 3000; t += 160) office.tick(160);
    expect(office.doors.get(room.id).open).toBe(0);
  });

  test("someone visiting the next room opens their own door on the way out and that room's door on the way in", () => {
    const rooms = layoutFloor(roomsOf([space("a"), space("b")], [agent("t1", "a", "working"), agent("t2", "b", "working")]), 1000)
      .rooms.filter((r) => !r.newRoom);
    const info = new Map(["t1", "t2"].map((a) => [a, { status: "working", app: "claude-code" }]));
    const office = new Office(seeded(1));
    office.sync(rooms, info);
    settle(office);
    const [a, b] = rooms;
    expect(b.oy).toBe(a.oy);
    const c = office.chars.get("t1");
    Object.assign(c, { x: 60, y: LANE_Y });
    const { seen } = walk(office, c, office.route(c, office.local(c, { x: b.ox + 60, y: b.oy + LANE_Y })));
    expect([...new Set(seen.map((s) => s.room))]).toEqual(["a", "b"]);
    expect(seen.every((s) => s.open === 1)).toBe(true);
  });

  test("a glass theme without a door panel keeps the door picture as it is (open), and a panel must fit the doorway", () => {
    const json = themeJson("modern");
    const sizes = themeSizes("modern", json);
    const tall = { ...json, images: { ...json.images, doorPanel: "wall.png" } }; // 高さ 30（ガラスは 14）
    expect(readTheme("tall-door", tall, sizes).problems.join(" / ")).toContain("images.doorPanel");
    delete json.images.doorPanel;
    const { theme, problems } = readTheme("modern-open-door", json, sizes);
    expect(problems).toEqual([]);
    addTheme(theme);
    useTheme("modern-open-door");
    try {
      const { rooms, info } = world({ t1: "working" });
      const office = new Office(seeded(1));
      office.sync(rooms, info);
      const c = office.chars.get("t1");
      Object.assign(c, { x: LEFT_PASS, y: LANE_Y });
      walk(office, c, planPath(rooms[0], c, { x: 60, y: CORRIDOR_Y }));
      expect(office.doors.size).toBe(0); // 戸がないので、扉は動かさない
      const out = drawables(rooms[0], office);
      expect(out.some((d) => d.id === "glass-door")).toBe(true);
      expect(out.some((d) => d.id === "glass-door-panel")).toBe(false);
    } finally {
      useTheme("modern");
    }
  });
});
