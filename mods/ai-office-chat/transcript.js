// Claude Code の会話の記録（~/.claude/projects/<フォルダ>/<セッション>.jsonl。1 行が 1 つの JSON）から、会話のポップアップに
// 出すものを取り出す。計算だけ（herdr を import しない。bun test で確かめる）。
// 出すもの:
// - あなたの発言: type が user で、記録のためだけの行（isMeta・isCompactSummary・ツールの結果）でないもの。作業の途中に
//   送った発言は attachment の queued_command（origin.kind が human のもの。サブエージェントの報告や通知は出さない）
// - AI の返事: type が assistant の text。考えている途中（thinking）は出さず、ツールの呼び出しは名前だけ覚えて数える
// サブエージェントの行（isSidechain）は出さない。記録は末尾だけを読むので、最初の行は途中から始まっていることがある
// （読めない行は飛ばす）。

// 記録の末尾を読むコマンド（sh -c READ_SH sh <記録> <どこから> <窓>）。1 行目にファイルの大きさ、そのあとに
// <どこから>（バイト。負なら末尾の <窓> バイト）から終わりまでの行。会話に出さない大きな行（API の要求・ツールの結果・
// 考えている途中）は、ここで捨てる（記録は画像の結果などで 100MB を超えることがあり、mod の exec は出力が 8 MiB まで）。
// 記録がなければ終わりの値 3
export const READ_SH = [
  'f=$1; [ -f "$f" ] || exit 3',
  'size=$(wc -c < "$f" | tr -d " "); from=$2',
  '[ "$from" -ge 0 ] || from=$((size > $3 ? size - $3 : 0))',
  'echo "$size"',
  '[ "$from" -lt "$size" ] || exit 0',
  'tail -c +$((from + 1)) -- "$f" | head -c $((size - from)) | LC_ALL=C grep -aFv -e \'{"type":"api-request\' ' +
    '-e \'"type":"tool_result"\' -e \'"type":"thinking"\' -e \'"type":"redacted_thinking"\' | tail -c 7000000',
].join("\n");

// あなたの発言から、Claude Code が足した札を除く: スラッシュコマンドは名前と引数だけ、コマンドの出力・system-reminder は
// 消す。hc から届いたもの（<hc from="t3 名前">文</hc>）は「（t3 名前 から）文」、貼り付け（<pasted_content>）は中身だけ
export function cleanUserText(text) {
  return String(text ?? "")
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<local-command-(stdout|stderr|caveat)>[\s\S]*?<\/local-command-\1>/g, "")
    .replace(/<command-message>[\s\S]*?<\/command-message>/g, "")
    .replace(/<command-name>([\s\S]*?)<\/command-name>/g, "$1")
    .replace(/<command-args>([\s\S]*?)<\/command-args>/g, (_m, args) => (args.trim() ? ` ${args.trim()}` : ""))
    .replace(/<hc\s+from="([^"]*)"[^>]*>/g, "（$1 から）")
    .replace(/<\/?hc>/g, "")
    .replace(/<\/?pasted_content[^>]*>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// 発言の中身（文字列か、text・image のかたまりの列）を文に。ツールの結果を含むものは null（発言ではない）
function contentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  if (content.some((b) => b?.type === "tool_result")) return null;
  return content.map((b) => (b?.type === "text" ? b.text : b?.type === "image" ? "[画像]" : "")).filter(Boolean).join("\n");
}

// 作業の途中に送った発言（queued_command の prompt）。画像があると、かたまりの列を JSON にした文字列になっている
function queuedText(prompt) {
  if (typeof prompt !== "string") return contentText(prompt);
  if (prompt.startsWith("[{")) {
    try {
      return contentText(JSON.parse(prompt)) ?? prompt;
    } catch {
      return prompt;
    }
  }
  return prompt;
}

/**
 * 記録の行（JSONL の文字列）から、会話に出すものを記録の順に:
 * { id, kind: "user" | "assistant" | "tool", text, at, error? }。tool は { name, about }（ツールの名前と説明）。
 * id は記録の uuid（1 行にかたまりが 2 つ以上あれば「uuid#番号」）。読み直した記録と重ねるときに使う（mergeEntries）。
 */
export function readEntries(text) {
  const out = [];
  for (const line of String(text ?? "").split("\n")) {
    // 先に文字で選ぶ（会話に出す行だけ JSON として読む）
    if (!line.includes('"type":"user"') && !line.includes('"type":"assistant"') && !line.includes('"queued_command"')) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue; // 途中から読んだ最初の行など
    }
    if (!e || typeof e !== "object" || e.isSidechain || !e.uuid) continue;
    const at = e.timestamp ?? null;
    if (e.type === "user") {
      if (e.isMeta || e.isCompactSummary || e.isVisibleInTranscriptOnly) continue;
      const said = contentText(e.message?.content);
      const clean = said === null ? "" : cleanUserText(said);
      if (clean) out.push({ id: e.uuid, kind: "user", text: clean, at });
    } else if (e.type === "assistant") {
      const blocks = Array.isArray(e.message?.content) ? e.message.content : [];
      blocks.forEach((b, i) => {
        const id = blocks.length > 1 ? `${e.uuid}#${i}` : e.uuid;
        if (b?.type === "text" && b.text?.trim()) {
          out.push({ id, kind: "assistant", text: b.text.trim(), at, ...(e.isApiErrorMessage ? { error: true } : {}) });
        } else if (b?.type === "tool_use") {
          out.push({ id, kind: "tool", name: String(b.name ?? ""), about: String(b.input?.description ?? ""), at });
        }
      });
    } else if (e.type === "attachment" && e.attachment?.type === "queued_command") {
      const a = e.attachment;
      if (a.origin?.kind !== "human" && a.humanTurn !== true) continue;
      const clean = cleanUserText(queuedText(a.prompt));
      if (clean) out.push({ id: e.uuid, kind: "user", text: clean, at });
    }
  }
  return out;
}

/** 前に読んだもの known に、読み直したもの fresh のうち新しいものを足す（id で重なりを除く。記録の順のまま）。 */
export function mergeEntries(known, fresh) {
  const ids = new Set(known.map((e) => e.id));
  return [...known, ...fresh.filter((e) => !ids.has(e.id))];
}

/**
 * ポップアップに出す吹き出し（古い順、最後の limit 個）: あなたの発言は 1 つずつ、AI は次の発言までをまとめて 1 つ
 * （文章をつなぎ、ツールは回数と最後の 1 つ）。{ id, role: "user" | "assistant", text, tools, lastTool, error }
 */
export function chatBubbles(entries, limit = 30) {
  const out = [];
  let ai = null;
  for (const e of entries) {
    if (e.kind === "user") {
      ai = null;
      out.push({ id: e.id, role: "user", text: e.text, tools: 0, lastTool: null, error: false });
      continue;
    }
    if (!ai) {
      ai = { id: e.id, role: "assistant", text: "", tools: 0, lastTool: null, error: false };
      out.push(ai);
    }
    if (e.kind === "tool") {
      ai.tools++;
      ai.lastTool = e.about ? `${e.name}: ${e.about}` : e.name;
    } else {
      ai.text = ai.text ? `${ai.text}\n\n${e.text}` : e.text;
      if (e.error) ai.error = true;
    }
  }
  return out.slice(-limit);
}

/**
 * 送った文 sent（{ text, at: 送った時刻のミリ秒 }）が、もう記録に出ているか（出るまでは「送信済み」として出す）。
 * 同じ文を前にも送っていることがあるので、送った時刻より後（時計のずれを 10 秒みる）の発言だけを見る。空白の違いは見ない。
 */
export function delivered(sent, entries) {
  const norm = (s) => String(s).replace(/\s+/g, " ").trim();
  const want = norm(sent.text);
  return entries.some((e) => e.kind === "user" && norm(e.text) === want && !(Date.parse(e.at) < sent.at - 10000));
}
