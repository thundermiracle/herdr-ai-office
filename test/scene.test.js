import { describe, expect, test } from "bun:test";
import {
  BACK, DESK_X, LANE_Y, LEFT_PASS, MIN_ROOM_W, READ, SEAT_W,
  Office, agentModel, argvValue, bandOf, behaviorOf, clockHands, codexOverride, drawables, layoutRooms, lookOf,
  modelFamily, modelLabel, parseCodexConfig, parseSkillFile, planPath, roomOf, roomsOf, sameSkill, shelfBooks, sortSkills, SHELF,
} from "../mods/ai-office/scene.js";

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

  test("agents go to their own space's room", () => {
    const rooms = roomsOf([space("a"), space("b")], [agent("t1", "a"), agent("t2", "b"), agent("t3", "a")]);
    expect(rooms[0].seats.map((s) => s.agent)).toEqual(["t1", "t3", null]);
    expect(rooms[1].seats.map((s) => s.agent)).toEqual(["t2", null]);
  });

  test("rooms wrap to the next row and the new-room lot comes last", () => {
    const rooms = roomsOf([space("a"), space("b"), space("c")], []);
    const { rooms: placed, h } = layoutRooms(rooms, 450);
    expect(placed.map((r) => r.id)).toEqual(["a", "b", "c", "new-room"]);
    expect(placed[0].oy).toBe(placed[1].oy);
    expect(placed[2].oy).toBeGreaterThan(placed[1].oy);
    expect(h).toBeGreaterThan(placed[2].oy + placed[2].h);
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
    const pts = planPath(room, READ, { x: room.seats[1].cx, y: LANE_Y });
    expect(pts).toEqual([{ x: READ.x, y: LANE_Y }, { x: room.seats[1].cx, y: LANE_Y }]);
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
    for (const q of planPath(room, from, READ)) {
      expect(p.x === q.x || p.y === q.y).toBe(true);
      p = q;
    }
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

  test("reading goes to the bookshelf", () => {
    const office = new Office(seeded(3));
    const w = world({ t1: "working" }, { acts: { t1: "read" } });
    office.sync(w.rooms, w.info);
    settle(office);
    const c = office.chars.get("t1");
    expect([c.x, c.y]).toEqual([READ.x, READ.y]);
    expect(c.seated).toBe(false);
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
    expect(d.find((x) => x.id === "laptop-0")).toBeDefined();
    expect(d.find((x) => x.id === "chair-1").img).toBe("chair-free");
    expect(d.find((x) => x.id === "laptop-1")).toBeUndefined();
    expect(d.find((x) => x.id === "hire-1")?.img).toBe("hire-sign");
    expect(d.find((x) => x.id === "hire-0")).toBeUndefined();
  });
});

describe("clockHands", () => {
  const at = (h, m) => clockHands(new Date(2026, 10, 11, h, m));
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
    const shelf = d.find((x) => x.id === "shelf");
    expect(shelf.click).toEqual({ type: "skills", room: "sp1" });
    expect(shelf.books.map((b) => b.skill.id)).toEqual(["codex:rescue"]); // herdr は読まれているので棚にない
    expect(d.find((x) => x.id === "tag-t1")).toMatchObject({ text: "herdr" });
    // 調べ終わって席で作業（skill はターンが終わるまで残る）
    w = world({ t1: "working" }, { acts: { t1: "edit" } });
    w.info.get("t1").skill = "herdr";
    office.sync(w.rooms, w.info);
    settle(office);
    d = drawables(w.rooms[0], office, skills);
    expect(d.find((x) => x.id === "shelf").books).toHaveLength(2);
    expect(d.find((x) => x.id === "tag-t1")).toMatchObject({ text: "herdr" });
  });
});
