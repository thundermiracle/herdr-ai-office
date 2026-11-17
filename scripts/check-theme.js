// テーマのフォルダを、オフィスと同じく確かめる（theme.json と images の PNG）。使えるなら寸法を、使えないなら理由を出す。
// 使い方: bun scripts/check-theme.js <テーマのフォルダ>...（例: ~/.config/herdr-app/ai-office-themes/mine）
import { existsSync, readFileSync } from "fs";
import { basename, resolve } from "path";
import { pngSize, readTheme } from "../mods/ai-office/scene.js";

const dirs = process.argv.slice(2);
if (!dirs.length) {
  console.error("使い方: bun scripts/check-theme.js <テーマのフォルダ>...");
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
    problems = [`theme.json を読めない（${e.message}）`];
  }
  if (problems.length) {
    bad++;
    console.log(`使えない ${name}:`);
    for (const p of problems) console.log(`  - ${p}`);
  } else {
    const glass = theme.GLASS ? `ガラス y=${theme.GLASS.y} 高さ ${theme.GLASS.h}` : "手前は開いている";
    console.log(`使える ${name}（${theme.label}）: 1 列 ${theme.ROOM_H}・壁 ${theme.WALL_H}・机の奥 ${theme.BACK}・${glass}`);
    for (const [key, img] of Object.entries(theme.IMAGES)) console.log(`  ${key}: ${img.src}（${img.w} x ${img.h}）`);
  }
}
process.exit(bad ? 1 : 0);
