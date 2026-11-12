import { describe, expect, test } from "bun:test";
import {
  RAIN_FRAMES, TRIAL_WEATHER, parseSkyCommand, parseWeather, phaseMinute, skyPhase, sunAt, sunTimes, tokyoAt, tokyoClock,
  weatherOf, windowTip, windowView,
} from "../mods/ai-office/scene.js";

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

describe("weather", () => {
  test("WMO codes become the window's sky and what falls from it", () => {
    expect(weatherOf(0)).toMatchObject({ cover: "clear", fx: null, label: "快晴" });
    expect(weatherOf(2)).toMatchObject({ cover: "cloudy", fx: null });
    expect(weatherOf(3)).toMatchObject({ cover: "overcast", fx: null, label: "曇り" });
    expect(weatherOf(45)).toMatchObject({ cover: "overcast", fx: null, label: "霧" });
    expect(weatherOf(53)).toMatchObject({ cover: "overcast", fx: "rain", label: "霧雨" });
    expect(weatherOf(61)).toMatchObject({ fx: "rain", label: "小雨" });
    expect(weatherOf(65)).toMatchObject({ fx: "rain", label: "大雨" });
    expect(weatherOf(81)).toMatchObject({ fx: "rain", label: "にわか雨" });
    expect(weatherOf(73)).toMatchObject({ cover: "overcast", fx: "snow", label: "雪" });
    expect(weatherOf(86)).toMatchObject({ fx: "snow" });
    expect(weatherOf(95)).toMatchObject({ fx: "thunder", label: "雷雨" });
    expect(weatherOf(42)).toMatchObject({ cover: "clear", fx: null });
  });

  test("Open-Meteo's answer is read; anything else is null", () => {
    // 2026-11-12 16:15 の東京の、実際の応答（current の部分）
    const json = { current: { time: "2026-11-12T16:15", interval: 900, weather_code: 0, temperature_2m: 17.0 } };
    expect(parseWeather(json, 123)).toEqual({ code: 0, cover: "clear", fx: null, label: "快晴", temp: 17, time: "2026-11-12T16:15", fetchedAt: 123 });
    expect(parseWeather({ current: { weather_code: 63 } }, 1)).toMatchObject({ fx: "rain", temp: null });
    expect(parseWeather({ error: true, reason: "x" }, 1)).toBeNull();
    expect(parseWeather(null, 1)).toBeNull();
  });
});

describe("windowView", () => {
  const night = jst(2026, 11, 12, 22, 0);
  const noon = jst(2026, 11, 12, 12, 0);

  test("the sky for the time and the weather, under the frame", () => {
    expect(windowView(noon, null, 0).layers).toEqual(["sky/day-clear", "window"]);
    expect(windowView(night, weatherOf(2), 0).layers).toEqual(["sky/night-cloudy", "window"]);
    expect(windowView(night, weatherOf(63), 0).layers).toEqual(["sky/night-overcast", "sky/rain-0", "window"]);
    expect(windowView(noon, weatherOf(73), 6).layers).toEqual(["sky/day-overcast", "sky/snow-3", "window"]);
  });

  test("rain moves every other tick and loops; a clear sky does not change between ticks", () => {
    const rain = weatherOf(63);
    const frames = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((t) => windowView(noon, rain, t).layers[1]);
    expect(frames).toEqual(["sky/rain-0", "sky/rain-0", "sky/rain-1", "sky/rain-1", "sky/rain-2", "sky/rain-2", "sky/rain-3", "sky/rain-3", "sky/rain-0"]);
    expect(RAIN_FRAMES).toBe(4);
    expect(windowView(noon, weatherOf(0), 1).key).toBe(windowView(noon, weatherOf(0), 2).key);
  });

  test("thunder flashes twice every 24 ticks", () => {
    const flashes = Array.from({ length: 48 }, (_, t) => t).filter((t) => windowView(noon, weatherOf(95), t).layers.includes("sky/flash"));
    expect(flashes).toEqual([0, 2, 24, 26]);
  });

  test("the tooltip shows Tokyo's time and weather", () => {
    expect(windowTip(noon, parseWeather({ current: { weather_code: 61, temperature_2m: 12.6 } }, 0))).toBe("東京 12:00 · 小雨 13°C");
    expect(windowTip(night, null)).toBe("東京 22:00 · 天気はまだ分かりません");
    expect(windowTip(night, weatherOf(73), true)).toContain("試し中");
  });
});

describe("trying the sky", () => {
  const now = jst(2026, 11, 12, 16, 15);

  test("weather, a Tokyo time, a time of day, or back to the real one", () => {
    expect(parseSkyCommand("sky-rain", now)).toEqual({ weather: "rain" });
    expect(parseSkyCommand("sky-1930", now)).toEqual({ time: 19 * 60 + 30 });
    expect(parseSkyCommand("sky-night", now)).toEqual({ time: 0 });
    expect(parseSkyCommand("sky-auto", now)).toEqual({ weather: null, time: null });
    expect(Object.keys(TRIAL_WEATHER)).toEqual(["clear", "cloudy", "overcast", "fog", "rain", "snow", "thunder"]);
  });

  test("each time of day lands in that time of day", () => {
    for (const phase of ["night", "twilight", "dawn", "day", "dusk"]) {
      const { time } = parseSkyCommand(`sky-${phase}`, now);
      expect(skyPhase(sunAt(tokyoAt(now, time)))).toBe(phase);
    }
    expect(phaseMinute(now, "dusk")).toBeLessThan(phaseMinute(now, "twilight"));
  });

  test("other commands and bad times are not for the sky", () => {
    expect(parseSkyCommand("focus", now)).toBeNull();
    expect(parseSkyCommand("sky-2460", now)).toBeNull();
    expect(parseSkyCommand("sky-constructor", now)).toBeNull();
    expect(parseSkyCommand("sky-", now)).toBeNull();
  });
});
