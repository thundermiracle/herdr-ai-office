import { describe, expect, test } from "bun:test";
import { keysFor, parseQuestion, sameQuestion, typesAnswer } from "../mods/ai-office-ask/parse.js";

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
});
