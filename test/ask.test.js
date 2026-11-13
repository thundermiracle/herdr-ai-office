import { describe, expect, test } from "bun:test";
import { afterAnswer, keysFor, nextRead, parseQuestion, sameQuestion, typesAnswer } from "../mods/ai-office-ask/parse.js";

// Claude Code の選択式に似た画面（AskUserQuestion）
const ASK = `
some earlier output
────────────────────────────────────────
 ☐ 進め方

次の作業はどれにしますか？

  1. テストを書く
     まず失敗するテストから
❯ 2. 実装する
     すぐにコードを書く
  3. 調べる
  4. Type something.
────────────────────────────────────────
  5. Chat about this

Enter to select · ↑/↓ to navigate · Esc to cancel
`;

// 続けて 3 問の 2 問目（Claude Code の複数の質問）。区切り線の上は前の会話（Todo の ☒ もある）
const STEP2 = `
 ☒ 前のタスク
────────────────────────────────────────
←  ☒ 進め方  ☐ 言語  ☐ テスト  ✔ Submit  →

どの言語で書きますか？

❯ 1. TypeScript
     型を付けて書く
  2. Rust
  3. Python
  4. Type something.
────────────────────────────────────────
  5. Chat about this

Enter to select · Tab/Arrow keys to navigate · Esc to cancel
`;

// 3 問に答えたあとの、答えの確認
const REVIEW = `
────────────────────────────────────────
←  ☒ 進め方  ☒ 言語  ☒ テスト  ✔ Submit  →

Review your answers

 ● 次の作業はどれにしますか？
   → 調べる
 ● どの言語で書きますか？
   → TypeScript
 ● テストはどこまで書きますか？
   → 結合テストまで

Ready to submit your answers?

❯ 1. Submit answers
  2. Cancel
`;

// 許可の確認
const PERMISSION = `
 Bash command
   rm -rf build

 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and don't ask again for rm commands in /tmp/x
   3. No, and tell Claude what to do differently (esc)
`;

describe("parseQuestion", () => {
  test("question, options with descriptions, and where the cursor is", () => {
    const q = parseQuestion(ASK);
    expect(q.question).toBe("次の作業はどれにしますか？");
    expect(q.options.map((o) => o.label)).toEqual(["テストを書く", "実装する", "調べる", "Type something.", "Chat about this"]);
    expect(q.options[0].description).toBe("まず失敗するテストから");
    expect(q.options[2].description).toBe("");
    expect(q.cursor).toBe(2);
    expect(q.multi).toBe(false);
  });

  test("a permission prompt reads the same way", () => {
    const q = parseQuestion(PERMISSION);
    expect(q.question).toBe("Do you want to proceed?");
    expect(q.options).toHaveLength(3);
    expect(q.cursor).toBe(1);
  });

  test("checkbox options are a multi-select; no numbered options is null", () => {
    expect(parseQuestion("Pick some\n❯ 1. [ ] a\n  2. [x] b\n").multi).toBe(true);
    expect(parseQuestion("just a shell prompt\n$ ")).toBeNull();
  });

  test("the last option block on the screen wins (older output above is ignored)", () => {
    const q = parseQuestion("Old question?\n❯ 1. old\n  2. older\n\nNew question?\n  1. new\n❯ 2. newer\n");
    expect(q.question).toBe("New question?");
    expect(q.options.map((o) => o.label)).toEqual(["new", "newer"]);
  });

  test("one of several questions: the tabs above say which are answered (the Todo above the line is not a tab)", () => {
    const q = parseQuestion(STEP2);
    expect(q.question).toBe("どの言語で書きますか？");
    expect(q.steps).toEqual([{ label: "進め方", done: true }, { label: "言語", done: false }, { label: "テスト", done: false }]);
    expect(q.options.map((o) => o.label)).toEqual(["TypeScript", "Rust", "Python", "Type something.", "Chat about this"]);
    expect(q.review).toBeNull();
  });

  test("a single question has no tabs (one chip, no Submit)", () => {
    expect(parseQuestion(ASK).steps).toEqual([]);
    expect(parseQuestion("☐ 進め方\n\n次は？\n\n❯ 1. a\n  2. b\n").steps).toEqual([]);
    expect(parseQuestion(PERMISSION).steps).toEqual([]);
  });

  test("the review at the end: Submit answers or Cancel, with the answers above", () => {
    const q = parseQuestion(REVIEW);
    expect(q.question).toBe("Ready to submit your answers?");
    expect(q.options.map((o) => o.label)).toEqual(["Submit answers", "Cancel"]);
    expect(q.cursor).toBe(1);
    expect(q.review).toEqual([
      "● 次の作業はどれにしますか？", "→ 調べる", "● どの言語で書きますか？", "→ TypeScript", "● テストはどこまで書きますか？", "→ 結合テストまで",
    ]);
    expect(q.steps.every((s) => s.done)).toBe(true);
  });
});

describe("answering", () => {
  test("keys move from the cursor to the choice, then Enter", () => {
    const q = parseQuestion(ASK); // cursor 2
    expect(keysFor(q, 2)).toEqual(["enter"]);
    expect(keysFor(q, 4)).toEqual(["down", "down", "enter"]);
    expect(keysFor(q, 1)).toEqual(["up", "enter"]);
  });

  test("typed answers are recognised, and a changed screen is not the same question", () => {
    const q = parseQuestion(ASK);
    expect(typesAnswer(q.options[3])).toBe(true);
    expect(typesAnswer(q.options[0])).toBe(false);
    expect(sameQuestion(q, parseQuestion(ASK.replace("❯ 2.", "  2.").replace("  3. 調べる", "❯ 3. 調べる")))).toBe(true);
    expect(sameQuestion(q, parseQuestion(PERMISSION))).toBe(false);
  });

  test("the same words asked again after an answer are a new question (one more tab is answered)", () => {
    const q2 = parseQuestion(STEP2);
    expect(sameQuestion(q2, parseQuestion(STEP2.replace("☐ 言語", "☒ 言語")))).toBe(false);
  });
});

describe("after an answer", () => {
  const q1 = parseQuestion(ASK);
  const q2 = parseQuestion(STEP2);

  test("next question while it still asks, done once it stops asking, wait while the old one shows", () => {
    expect(afterAnswer(q1, q2, true)).toBe("next");
    expect(afterAnswer(q1, q1, true)).toBe("wait");
    expect(afterAnswer(q1, null, true)).toBe("wait");
    // 答え待ちでなくなったら、画面に番号付きの行（前の会話）が残っていても次の質問とはみなさない
    expect(afterAnswer(q1, q2, false)).toBe("done");
  });

  test("a step is sure only when two reads in a row agree", () => {
    const first = nextRead(null, q1, q2, true);
    expect(first).toMatchObject({ step: "next", sure: false });
    expect(nextRead(first, q1, q2, true).sure).toBe(true);
    expect(nextRead(first, q1, parseQuestion(REVIEW), true).sure).toBe(false); // 2 回で違う質問
    const gone = nextRead(nextRead(null, q1, q1, true), q1, q1, false);
    expect(gone).toMatchObject({ step: "done", sure: false }); // 一瞬だけ答え待ちでないかもしれない
    expect(nextRead(gone, q1, null, false).sure).toBe(true);
  });
});
