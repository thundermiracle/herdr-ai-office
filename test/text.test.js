import { afterEach, describe, expect, test } from "bun:test";
import {
  LANGS, PLACES, TEXT, inLang, langOf, languageOf, parseWeather, placeName, readTheme, tr, useLang, weatherOf, windowTip,
} from "../mods/ai-office/scene.js";

// 画面の言語（text.js）。ほかのテストは日本語で確かめるので、ここで変えたら戻す
afterEach(() => useLang("ja"));

describe("the office's sentences in every language", () => {
  test("every language has every sentence that English has, of the same kind (a function takes the same things)", () => {
    const shape = (table) => Object.entries(table).map(([k, v]) => [k, typeof v, typeof v === "function" ? v.length : null])
      .sort(([a], [b]) => a.localeCompare(b));
    for (const lang of Object.keys(TEXT)) expect([lang, shape(TEXT[lang])]).toEqual([lang, shape(TEXT.en)]);
  });

  test("the language button lists every language, each by its own name", () => {
    expect(Object.keys(LANGS).sort()).toEqual(Object.keys(TEXT).sort());
    expect(LANGS).toEqual({ en: "English", ja: "日本語" });
  });

  test("every place has a name in every language", () => {
    for (const lang of Object.keys(TEXT)) {
      useLang(lang);
      for (const p of PLACES) expect([lang, p.id, placeName(p) !== p.id]).toEqual([lang, p.id, true]);
    }
    useLang("en");
    expect(placeName(PLACES.find((p) => p.id === "sao-paulo"))).toBe("São Paulo");
    useLang("ja");
    expect(placeName(PLACES.find((p) => p.id === "sao-paulo"))).toBe("サンパウロ");
  });

  test("an unknown language, and a sentence missing from the table, fall back to English", () => {
    expect(useLang("fr")).toBe("en");
    expect(tr("legend")).toBe("Legend");
    expect(tr("no.such.sentence")).toBe("no.such.sentence"); // どこにもなければ名前のまま（見れば気づく）
    expect(useLang("ja")).toBe("ja");
    expect(tr("legend")).toBe("凡例");
    expect(tr("counts", { working: 1, blocked: 2, done: 3, idle: 4 })).toBe("作業中 1 · 待ち 2 · 完了 3 · 待機 4");
  });
});

describe("which language the office shows", () => {
  test("the language picked with the button wins, then the OS's, then English", () => {
    expect(langOf("ja", "en")).toBe("ja");
    expect(langOf("en", "ja")).toBe("en");
    expect(langOf("auto", "ja")).toBe("ja");
    expect(langOf(undefined, "ja")).toBe("ja"); // まだ選んでいない
    expect(langOf("auto", "zh")).toBe("en"); // 表のない言語の OS
    expect(langOf(undefined, undefined)).toBe("en"); // OS の言語をまだ調べていない
  });

  test("the OS's language comes from macOS's language list or from LANG", () => {
    // defaults read -g AppleLanguages: いちばん上が使う言語
    expect(languageOf('(\n    "ja-JP",\n    "en-JP",\n    "zh-Hans-JP"\n)\n')).toBe("ja");
    expect(languageOf('(\n    "en-JP",\n    "ja-JP"\n)\n')).toBe("en");
    expect(languageOf('(\n    "zh-Hans-JP"\n)')).toBe("zh");
    expect(languageOf("(\n    en\n)")).toBe("en");
    // LC_ALL・LC_MESSAGES・LANG
    expect(languageOf("ja_JP.UTF-8")).toBe("ja");
    expect(languageOf("en_US.UTF-8")).toBe("en");
    expect(languageOf("de_DE@euro")).toBe("de");
    for (const none of ["C", "C.UTF-8", "POSIX", "", undefined, null]) expect(languageOf(none)).toBeNull();
  });
});

describe("theme names and descriptions per language", () => {
  test("inLang takes the current language, then English, then the first one written", () => {
    const label = { en: "Modern", ja: "モダン" };
    useLang("ja");
    expect(inLang(label)).toBe("モダン");
    expect(inLang({ en: "Modern" })).toBe("Modern");
    expect(inLang({ fr: "Moderne" })).toBe("Moderne");
    expect(inLang("和風")).toBe("和風"); // 1 つの言語だけで書いたテーマ
    expect(inLang(null)).toBe("");
    useLang("en");
    expect(inLang(label)).toBe("Modern");
  });

  test("readTheme keeps a label per language, and uses the folder's name for anything else", () => {
    const labelOf = (label) => readTheme("mine", { label }).theme.label;
    expect(labelOf({ en: "Mine", ja: "自分の" })).toEqual({ en: "Mine", ja: "自分の" });
    expect(labelOf("Mine")).toBe("Mine");
    for (const bad of [3, null, [], {}, { en: 3 }]) expect(labelOf(bad)).toBe("mine");
    expect(readTheme("mine", { description: { en: "Mine" } }).theme.description).toEqual({ en: "Mine" });
    expect(readTheme("mine", {}).theme.description).toBe("");
  });

  test("readTheme says what is wrong in the office's language", () => {
    useLang("en");
    expect(readTheme("broken", { room: {} }).problems).toContain("room.height is not a whole number");
    useLang("ja");
    expect(readTheme("broken", { room: {} }).problems).toContain("room.height が整数でない");
  });
});

describe("the window's weather in English", () => {
  const noon = Date.UTC(2026, 10, 12, 3); // 東京は昼の 12 時

  test("the weather and the place are named in English", () => {
    useLang("en");
    expect(weatherOf(0).label).toBe("Clear");
    expect(weatherOf(61).label).toBe("Light rain");
    expect(weatherOf(73).label).toBe("Snow");
    expect(weatherOf(999).label).toBe("Clear (unknown weather code)");
    expect(windowTip(noon, parseWeather({ current: { weather_code: 61, temperature_2m: 12.6 } }, 0))).toBe("Tokyo 12:00 · Light rain 13°C");
    expect(windowTip(noon, null, false, PLACES.find((p) => p.id === "london"))).toBe("London 03:00 · No weather yet");
    expect(windowTip(noon, weatherOf(73), true)).toContain("(trying it out; herdr-app do ai-office.sky-auto");
  });

  test("weather fetched while the office was in another language is shown in the current one", () => {
    useLang("ja");
    const fetched = parseWeather({ current: { weather_code: 61, temperature_2m: 12.6 } }, 0); // shared に置くもの
    expect(fetched.label).toBe("小雨");
    useLang("en");
    expect(windowTip(noon, fetched)).toBe("Tokyo 12:00 · Light rain 13°C");
    expect(windowTip(noon, { cover: "clear", label: "Old", temp: null })).toBe("Tokyo 12:00 · Old"); // 天気コードがない古いもの
  });
});
