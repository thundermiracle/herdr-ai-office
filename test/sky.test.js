import { describe, expect, test } from "bun:test";
import { skyPhase, sunAt, sunTimes, tokyoAt, tokyoClock } from "../mods/ai-office/scene.js";

// 東京の y-m-d h:mm（UTC+9）の時刻
const jst = (y, mo, d, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h - 9, mi);

describe("Tokyo time", () => {
  test("the clock is UTC+9 whatever the machine's time zone", () => {
    expect(tokyoClock(Date.UTC(2026, 10, 12, 7, 15))).toEqual({ min: 16 * 60 + 15, text: "16:15" });
    expect(tokyoClock(Date.UTC(2026, 10, 11, 15, 0)).text).toBe("00:00");
    expect(tokyoClock(Date.UTC(2026, 10, 11, 14, 59)).text).toBe("23:59");
  });

  test("a time of the same Tokyo day", () => {
    expect(tokyoAt(jst(2026, 11, 12, 16, 15), 0)).toBe(jst(2026, 11, 12));
    expect(tokyoAt(jst(2026, 11, 12, 0, 5), 19 * 60 + 30)).toBe(jst(2026, 11, 12, 19, 30));
    expect(tokyoAt(jst(2026, 11, 12, 23, 59), 60)).toBe(jst(2026, 11, 12, 1, 0));
  });
});

describe("the sun over Tokyo", () => {
  // Open-Meteo の日の出・日の入り（東京、timezone=Asia/Tokyo）。計算は 1 分ほど遅く出るので、2 分まで許す
  const near = (got, h, m) => expect(Math.abs(got - (h * 60 + m))).toBeLessThanOrEqual(2);

  test("sunrise and sunset match Open-Meteo in autumn, summer and winter", () => {
    const nov = sunTimes(jst(2026, 11, 12, 12));
    near(nov.rise, 6, 13);
    near(nov.set, 16, 36);
    const jun = sunTimes(jst(2026, 6, 21, 12));
    near(jun.rise, 4, 25);
    near(jun.set, 19, 0);
    const dec = sunTimes(jst(2025, 12, 21, 3));
    near(dec.rise, 6, 46);
    near(dec.set, 16, 31);
  });

  test("high at noon, below the horizon at midnight, rising in the morning", () => {
    const noon = sunAt(jst(2026, 6, 21, 11, 45));
    expect(noon.elevation).toBeGreaterThan(75); // 夏至の南中は 90 − 35.7 + 23.4 ≈ 77.7°
    expect(sunAt(jst(2026, 6, 21, 0, 0)).elevation).toBeLessThan(-20);
    expect(sunAt(jst(2026, 11, 12, 8, 0)).morning).toBe(true);
    expect(sunAt(jst(2026, 11, 12, 15, 0)).morning).toBe(false);
  });

  test("the sky's time of day through a November day", () => {
    const at = (h, m) => skyPhase(sunAt(jst(2026, 11, 12, h, m)));
    expect(at(3, 0)).toBe("night");
    expect(at(5, 40)).toBe("twilight");
    expect(at(6, 15)).toBe("dawn");
    expect(at(12, 0)).toBe("day");
    expect(at(16, 30)).toBe("dusk");
    expect(at(17, 5)).toBe("twilight");
    expect(at(18, 30)).toBe("night");
  });

  test("summer days are longer: still day at 18:00 in June, already night in December", () => {
    expect(skyPhase(sunAt(jst(2026, 6, 21, 18, 0)))).toBe("day");
    expect(skyPhase(sunAt(jst(2025, 12, 21, 18, 0)))).toBe("night");
  });
});
