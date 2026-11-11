// parse.js: 質問しているエージェントの画面（hc read の文字）から、質問と選択肢を読む。herdr を import しない（bun test で試せる）。
// Claude Code の選択式（AskUserQuestion や許可の確認）は、選択肢が「1. ラベル」のように番号付きで並び、
// 今の選択に ❯（› や > も）が付く。選択肢の説明は、その下にラベルより深い字下げで続く。

const OPTION = /^(\s*)([❯›>]\s*)?(\d+)\.\s+(.*\S)\s*$/;
const RULE = /^\s*[─━\-═]{3,}\s*$/; // 区切り線
const CHIP = /^\s*[☐☒✓✔□■◻◼]\s/; // 質問の見出しの印（複数の質問のタブ）
const CHECKBOX = /^\[[ xX✓✔]\]|^[☐☒□■◻◼]/; // 複数選ぶ質問の選択肢の印

/**
 * 画面のいちばん下にある「1.」から始まる選択肢のまとまりと、その上の質問を読む。
 * 返すもの: { question, options: [{ n, label, description }], cursor（今選ばれている番号）, multi } か、読めなければ null。
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
  for (let j = start - 1; j >= 0 && question.length < 4; j--) {
    const line = lines[j];
    if (!line.trim() || RULE.test(line) || CHIP.test(line)) {
      if (question.length) break;
      continue;
    }
    question.unshift(line.trim());
  }
  return {
    question: question.join(" "),
    options: options.map(({ n, label, description }) => ({ n, label, description })),
    cursor: cursor || 1,
    multi: options.some((o) => CHECKBOX.test(o.label)),
  };
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

/** 同じ質問か（送る前に画面を読み直して、変わっていたら送らない）。 */
export function sameQuestion(a, b) {
  return Boolean(a && b) && a.question === b.question
    && a.options.length === b.options.length && a.options.every((o, i) => o.label === b.options[i].label);
}
