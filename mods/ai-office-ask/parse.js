// parse.js: 質問しているエージェントの画面（hc read の文字）から、質問と選択肢を読む。herdr を import しない（bun test で試せる）。
// Claude Code の選択式（AskUserQuestion や許可の確認）は、選択肢が「1. ラベル」のように番号付きで並び、
// 今の選択に ❯（› や > も）が付く。選択肢の説明は、その下にラベルより深い字下げで続く。
// 質問が複数あるときは、上の区切り線の下にタブ（← ☒ 進め方  ☐ 言語  ✔ Submit →。☒ は答えた質問）が並び、
// 答えるたびに次の質問になる。最後は答えの確認（Review your answers … Ready to submit your answers? と
// 1. Submit answers / 2. Cancel）。質問が 1 つだけなら、答えるとすぐ送られる（タブに Submit もない）。

const OPTION = /^(\s*)([❯›>]\s*)?(\d+)\.\s+(.*\S)\s*$/;
const RULE = /^\s*[─━\-═]{3,}\s*$/; // 区切り線
const CHIP = /^\s*[☐☒✓✔□■◻◼]\s/; // 質問の見出しの印（複数の質問のタブ）
const CHECKBOX = /^\[[ xX✓✔]\]|^[☐☒□■◻◼]/; // 複数選ぶ質問の選択肢の印
const STEP = /([☐☒])\s*([^☐☒✔]*)/g; // タブの 1 つ（☐ まだ / ☒ 答えた と、その見出し。✔ Submit の前まで）
const REVIEW = "Review your answers"; // 答えの確認の見出し
const LOOK_UP = 40; // タブと確認の見出しを、質問の上にこの行数まで探す

/**
 * 画面のいちばん下にある「1.」から始まる選択肢のまとまりと、その上の質問を読む。
 * 返すもの: { question, options: [{ n, label, description }], cursor（今選ばれている番号）, multi,
 *   steps（複数の質問のタブ: [{ label, done }]。質問が 1 つ・タブがなければ []）,
 *   review（答えの確認の画面なら、見出しと質問の間の行: 質問と「→ 答え」。ほかの画面では null） }
 * か、読めなければ null。
 */
export function parseQuestion(screen) {
  const lines = (screen ?? "").split("\n").map((line) => line.replace(/\s+$/, ""));
  let start = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = OPTION.exec(lines[i]);
    if (m && m[3] === "1") {
      start = i;
      break;
    }
  }
  if (start < 0) return null;

  const options = [];
  let cursor = 0;
  for (let i = start, next = 1; i < lines.length; i++) {
    const m = OPTION.exec(lines[i]);
    if (m && Number(m[3]) === next) {
      options.push({ n: next, label: m[4], description: "", indent: m[1].length + (m[2]?.length ?? 0) });
      if (m[2]) cursor = next;
      next++;
      continue;
    }
    if (!lines[i].trim() || RULE.test(lines[i])) continue;
    const last = options.at(-1);
    if (last && lines[i].match(/^\s*/)[0].length > last.indent) {
      last.description = last.description ? `${last.description} ${lines[i].trim()}` : lines[i].trim();
      continue;
    }
    break; // 選択肢のまとまりの終わり（下の操作の案内など）
  }

  // 質問: 「1.」の上の、空行に当たるまでの行（区切り線と見出しの印の行は除く）
  const question = [];
  let top = start; // 質問のいちばん上の行
  for (let j = start - 1; j >= 0 && question.length < 4; j--) {
    const line = lines[j];
    if (!line.trim() || RULE.test(line) || CHIP.test(line)) {
      if (question.length) break;
      continue;
    }
    question.unshift(line.trim());
    top = j;
  }
  return {
    question: question.join(" "),
    options: options.map(({ n, label, description }) => ({ n, label, description })),
    cursor: cursor || 1,
    multi: options.some((o) => CHECKBOX.test(o.label)),
    ...above(lines, top),
  };
}

// 質問の上（区切り線に当たるまで）にあるタブと、答えの確認の行
function above(lines, top) {
  let steps = [];
  let review = null;
  for (let j = top - 1; j >= Math.max(0, top - LOOK_UP); j--) {
    const line = lines[j];
    if (RULE.test(line)) break; // 質問の画面の上の区切り線（その上は前の会話。Todo の ☐ ☒ もある）
    if (line.trim() === REVIEW && review === null) {
      review = lines.slice(j + 1, top).map((l) => l.trim()).filter((l) => l && !RULE.test(l));
      continue;
    }
    const found = [...line.matchAll(STEP)].map((m) => ({ label: m[2].replace(/[←→]/g, "").trim(), done: m[1] === "☒" }));
    if (found.length) {
      steps = found.length > 1 ? found : [];
      break;
    }
  }
  return { steps, review };
}

/** 選択肢 n を選ぶキー: 今の選択から上下に動かして Enter（hc keys に渡す名前）。 */
export function keysFor(parsed, n) {
  const d = n - parsed.cursor;
  return [...Array(Math.abs(d)).fill(d > 0 ? "down" : "up"), "enter"];
}

/** 書いて答える選択肢か（Type something. など）。選んだあとはターミナルで書く。 */
export function typesAnswer(option) {
  return /type something|chat about this|^other\b|自由に/i.test(option?.label ?? "");
}

/** 同じ質問か（送る前に画面を読み直して、変わっていたら送らない）。同じ文の質問が続いても、答えた数で見分ける。 */
export function sameQuestion(a, b) {
  const done = (q) => (q.steps ?? []).filter((s) => s.done).length;
  return Boolean(a && b) && a.question === b.question && done(a) === done(b)
    && a.options.length === b.options.length && a.options.every((o, i) => o.label === b.options[i].label);
}

/**
 * 答えを送ったあとに読み直した画面で、次にすること: "next"（次の質問が出た）、"done"（もう質問で待っていない）、
 * "wait"（まだ答えた質問のまま）。prev は答えた質問、now は読み直した質問（読めなければ null）、
 * asking はまだ質問で答え待ちか（blocked で kind が question）。答え待ちでなくなったあとの画面には、前の会話の
 * 番号付きの行が残っていることがあるので、答え待ちのときだけ次の質問とみなす。
 */
export function afterAnswer(prev, now, asking) {
  if (!asking) return "done";
  return now && !sameQuestion(now, prev) ? "next" : "wait";
}

/**
 * 答えたあと、画面を読み直すたびに呼ぶ。状態や画面が一瞬だけ変わることもあるので、同じ判定（afterAnswer）が
 * 2 回続いたら決める（next なら同じ質問が 2 回）。last は前の回に返したもの（はじめは null）。
 * 返すもの: { step, q, sure }（sure: これで決まり）。
 */
export function nextRead(last, prev, now, asking) {
  const step = afterAnswer(prev, now, asking);
  const sure = step !== "wait" && last?.step === step && (step === "done" || sameQuestion(last.q, now));
  return { step, q: now, sure };
}
