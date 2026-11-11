import { describe, expect, test } from "bun:test";
import {
  BACK, DESK_X, LANE_Y, LEFT_PASS, MIN_ROOM_W, READ, SEAT_W,
  Office, behaviorOf, clockHands, drawables, layoutRooms, looksOf, planPath, roomOf, roomsOf, shirtOf,
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

function world(statuses, { acts = {}, kinds = {} } = {}) {
  const agents = Object.entries(statuses).map(([address, status]) => agent(address, "sp1", status));
  const rooms = roomsOf([space("sp1")], agents);
  const info = new Map(agents.map((a) => [a.address, { status: a.status, app: a.app, act: acts[a.address], kind: kinds[a.address] }]));
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
  test("shirt follows the agent kind, hair is stable per address", () => {
    expect(shirtOf("claude-code")).toBe("orange");
    expect(shirtOf("codex")).toBe("teal");
    expect(shirtOf("pi")).toBe("violet");
    expect(looksOf("t1", "codex")).toEqual(looksOf("t1", "codex"));
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
