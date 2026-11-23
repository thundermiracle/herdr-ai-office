import { describe, expect, test } from "bun:test";
import { spawnSync } from "child_process";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { READ_SH, chatBubbles, cleanUserText, delivered, mergeEntries, readEntries } from "../mods/ai-office-chat/transcript.js";

// 記録の行（Claude Code の JSONL と同じ形の、作った行）
let n = 0;
const at = (s) => `2026-11-23T10:00:${String(s).padStart(2, "0")}.000Z`;
const line = (fields) => JSON.stringify({ parentUuid: null, isSidechain: false, uuid: `u${++n}`, timestamp: at(n), ...fields });
const user = (content, extra = {}) => line({ type: "user", message: { role: "user", content }, ...extra });
const assistant = (content, extra = {}) => line({ type: "assistant", message: { role: "assistant", content }, ...extra });
const queued = (prompt, origin = { kind: "human" }) =>
  line({ type: "attachment", attachment: { type: "queued_command", prompt, origin, humanTurn: origin.kind === "human" || null } });
const meta = (type) => JSON.stringify({ type, sessionId: "s1" });

describe("reading the conversation record", () => {
  test("your messages and the AI's text, without records-only lines, tool results, thinking or subagents", () => {
    const text = [
      meta("ai-title"),
      user("README を直して"),
      user("[Image: original 100x100]", { isMeta: true }),
      assistant([{ type: "thinking", thinking: "まず読む" }]),
      assistant([{ type: "tool_use", id: "x1", name: "Read", input: { file_path: "/a/README.md" } }]),
      user([{ type: "tool_result", tool_use_id: "x1", content: "…" }]),
      assistant([{ type: "tool_use", id: "x2", name: "Bash", input: { command: "ls", description: "List files" } }]),
      assistant([{ type: "text", text: "直しました。" }]),
      assistant([{ type: "text", text: "サブエージェントの返事" }], { isSidechain: true }),
      user("Summary of the earlier conversation…", { isCompactSummary: true }),
    ].join("\n");
    const entries = readEntries(text);
    expect(entries.map((e) => [e.kind, e.text ?? e.name])).toEqual([
      ["user", "README を直して"], ["tool", "Read"], ["tool", "Bash"], ["assistant", "直しました。"],
    ]);
    expect(entries[2].about).toBe("List files");
    expect(entries[0].at).toMatch(/^2026-11-23T/);
  });

  test("the first line read from the middle of the record, and broken lines, are skipped", () => {
    const whole = user("前の発言");
    const text = [whole.slice(20), "{broken", user("次の発言")].join("\n");
    expect(readEntries(text).map((e) => e.text)).toEqual(["次の発言"]);
  });

  test("a line with two blocks gets one entry per block; API errors are marked", () => {
    const entries = readEntries([
      assistant([{ type: "text", text: "調べます" }, { type: "tool_use", id: "x", name: "Grep", input: {} }]),
      assistant([{ type: "text", text: "API Error: overloaded" }], { isApiErrorMessage: true }),
    ].join("\n"));
    expect(entries.map((e) => e.id)).toEqual([`u${n - 1}#0`, `u${n - 1}#1`, `u${n}`]);
    expect(entries[2]).toMatchObject({ kind: "assistant", error: true });
  });

  test("messages sent while the AI works come as queued commands; only the person's count", () => {
    const entries = readEntries([
      queued("途中で送った発言"),
      queued("<agent-message from=\"a1\">サブエージェントの報告</agent-message>", { kind: "peer", from: "a1" }),
      queued("<task-notification>…</task-notification>", { kind: "task-notification" }),
      queued(JSON.stringify([{ type: "text", text: "これです" }, { type: "image", source: {} }])),
    ].join("\n"));
    expect(entries.map((e) => e.text)).toEqual(["途中で送った発言", "これです\n[画像]"]);
  });

  test("Claude Code's tags in your messages are tidied", () => {
    expect(cleanUserText("<command-name>/login</command-name>\n<command-message>login</command-message>\n<command-args></command-args>"))
      .toBe("/login");
    expect(cleanUserText("<command-name>/review</command-name><command-args>src/x.rs</command-args>")).toBe("/review src/x.rs");
    expect(cleanUserText("<local-command-stdout>Login successful</local-command-stdout>")).toBe("");
    expect(cleanUserText("直して<system-reminder>内部のメモ</system-reminder>")).toBe("直して");
    expect(cleanUserText('<hc from="t3 lead" reach="hc send t3">x.rs を見て</hc>')).toBe("（t3 lead から）x.rs を見て");
    expect(cleanUserText('<pasted_content id="c1">\n貼った文\n</pasted_content>')).toBe("貼った文");
    // 中身が札だけの発言は出さない
    expect(readEntries(user("<local-command-stdout>ok</local-command-stdout>"))).toEqual([]);
  });
});

describe("bubbles, merging and delivery", () => {
  test("each message is a bubble; the AI's replies up to the next message are one bubble with its tool count", () => {
    const entries = readEntries([
      user("一つ目"),
      assistant([{ type: "text", text: "見ます" }]),
      assistant([{ type: "tool_use", id: "a", name: "Read", input: {} }]),
      assistant([{ type: "tool_use", id: "b", name: "Bash", input: { description: "Run tests" } }]),
      assistant([{ type: "text", text: "通りました" }]),
      user("二つ目"),
      assistant([{ type: "tool_use", id: "c", name: "Edit", input: {} }]),
    ].join("\n"));
    const bubbles = chatBubbles(entries);
    expect(bubbles.map((b) => [b.role, b.text, b.tools, b.lastTool])).toEqual([
      ["user", "一つ目", 0, null],
      ["assistant", "見ます\n\n通りました", 2, "Bash: Run tests"],
      ["user", "二つ目", 0, null],
      ["assistant", "", 1, "Edit"], // まだ文章がない（作業中）
    ]);
    expect(chatBubbles(entries, 2).map((b) => b.text)).toEqual(["二つ目", ""]);
  });

  test("re-reading the end of the record adds only what is new, in order", () => {
    const a = readEntries([user("一"), assistant([{ type: "text", text: "二" }])].join("\n"));
    const lines = [user("三"), assistant([{ type: "text", text: "四" }])];
    const b = readEntries(lines.join("\n"));
    const merged = mergeEntries(a, [...a.slice(1), ...b]); // 読み直しは少し前から（重なりがある）
    expect(merged.map((e) => e.text)).toEqual(["一", "二", "三", "四"]);
    expect(mergeEntries(merged, b)).toEqual(merged);
  });

  test("a sent message counts as delivered once the record has it after the send", () => {
    const entries = readEntries([user("OK"), assistant([{ type: "text", text: "はい" }])].join("\n"));
    const sentAt = Date.parse(entries[0].at);
    expect(delivered({ text: "OK", at: sentAt }, entries)).toBe(true);
    expect(delivered({ text: " OK\n", at: sentAt }, entries)).toBe(true);
    expect(delivered({ text: "OK", at: sentAt + 60000 }, entries)).toBe(false); // 前に送った同じ文
    expect(delivered({ text: "NG", at: sentAt }, entries)).toBe(false);
  });
});

describe("the read command", () => {
  const dir = mkdtempSync(join(tmpdir(), "office-chat-"));
  const file = join(dir, "s.jsonl");
  const read = (from, window = 1000000, path = file) =>
    spawnSync("sh", ["-c", READ_SH, "sh", path, String(from), String(window)], { encoding: "utf8" });

  test("prints the size, then the lines the chat needs (no API requests, tool results or thinking)", () => {
    const text = [
      JSON.stringify({ type: "api-request", sessionId: "s1", body: { messages: [{ type: "user" }] } }),
      user("発言"),
      user([{ type: "tool_result", tool_use_id: "x", content: "x".repeat(5000) }]),
      assistant([{ type: "thinking", thinking: "…" }]),
      assistant([{ type: "text", text: "返事" }]),
    ].join("\n") + "\n";
    writeFileSync(file, text);
    const r = read(-1);
    expect(r.status).toBe(0);
    const [size, ...rest] = r.stdout.split("\n");
    expect(Number(size)).toBe(Buffer.byteLength(text));
    expect(rest.filter(Boolean)).toHaveLength(2);
    expect(readEntries(rest.join("\n")).map((e) => e.text)).toEqual(["発言", "返事"]);
  });

  test("from a byte offset, or only the last window; nothing new prints just the size; no record exits 3", () => {
    const first = user("最初");
    const text = `${first}\n${user("あと")}\n`;
    writeFileSync(file, text);
    const size = Buffer.byteLength(text);
    expect(readEntries(read(Buffer.byteLength(first) + 1).stdout).map((e) => e.text)).toEqual(["あと"]);
    expect(readEntries(read(-1, size - Buffer.byteLength(first) - 1).stdout).map((e) => e.text)).toEqual(["あと"]);
    expect(read(size).stdout).toBe(`${size}\n`);
    expect(read(-1, 1000, join(dir, "none.jsonl")).status).toBe(3);
  });
});
