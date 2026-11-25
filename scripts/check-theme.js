// テーマのフォルダを、オフィスと同じく確かめる（theme.json と images の PNG）。使えるなら寸法を、使えないなら理由を出す。
// 使い方: bun scripts/check-theme.js <テーマのフォルダ>...（例: ~/.config/herdr-app/ai-office-themes/mine）
// 出す言葉は、ターミナルの言語（LC_ALL・LC_MESSAGES・LANG）に合わせる（日本語でなければ英語）
import { existsSync, readFileSync } from "fs";
import { basename, resolve } from "path";
import { inLang, languageOf, pngSize, readTheme, tr, useLang } from "../mods/ai-office/scene.js";

const lang = useLang(languageOf(process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG));
const TEXT = {
  en: {
    usage: "Usage: bun scripts/check-theme.js <theme folder>...",
    bad: (name) => `Can't use ${name}:`,
    good: (name, label, t, front) => `Can use ${name} (${label}): row ${t.ROOM_H}, wall ${t.WALL_H}, desk back ${t.BACK}, ${front}`,
    glass: (g) => `glass y=${g.y} height ${g.h}`,
    open: "open at the front",
    image: (key, img) => `  ${key}: ${img.src} (${img.w} x ${img.h})`,
  },
  ja: {
    usage: "使い方: bun scripts/check-theme.js <テーマのフォルダ>...",
    bad: (name) => `使えない ${name}:`,
    good: (name, label, t, front) => `使える ${name}（${label}）: 1 列 ${t.ROOM_H}・壁 ${t.WALL_H}・机の奥 ${t.BACK}・${front}`,
    glass: (g) => `ガラス y=${g.y} 高さ ${g.h}`,
    open: "手前は開いている",
    image: (key, img) => `  ${key}: ${img.src}（${img.w} x ${img.h}）`,
  },
};
const T = { ...TEXT.en, ...TEXT[lang] };

const dirs = process.argv.slice(2);
if (!dirs.length) {
  console.error(T.usage);
  process.exit(2);
}
let bad = 0;
for (const arg of dirs) {
  const dir = resolve(arg);
  const name = basename(dir);
  let problems;
  let theme;
  try {
    const json = JSON.parse(readFileSync(`${dir}/theme.json`, "utf8"));
    const sizes = {};
    for (const file of Object.values(json.images ?? {})) {
      if (existsSync(`${dir}/${file}`)) {
        const size = pngSize(readFileSync(`${dir}/${file}`));
        if (size) sizes[file] = size;
      }
    }
    ({ theme, problems } = readTheme(name, json, sizes));
  } catch (e) {
    problems = [tr("themeUnreadable", e.message)];
  }
  if (problems.length) {
    bad++;
    console.log(T.bad(name));
    for (const p of problems) console.log(`  - ${p}`);
  } else {
    console.log(T.good(name, inLang(theme.label), theme, theme.GLASS ? T.glass(theme.GLASS) : T.open));
    for (const [key, img] of Object.entries(theme.IMAGES)) console.log(T.image(key, img));
  }
}
process.exit(bad ? 1 : 0);
