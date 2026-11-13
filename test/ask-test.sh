#!/bin/bash
# 質問に答える流れを、偽の質問役（scripts/fake-question.py）で通しで試す:
# hc read の画面を parse.js で読み、選択肢 3 を選ぶキーを hc keys で送り、質問役がそれを受け取ったかを見る。
# 続けて 3 問（--questions 3）では、答えるたびに次の質問が出て、最後の答えの確認（Submit answers）まで
# オフィスの「?」のポップアップと同じ関数（parseQuestion・keysFor・nextRead）で答えられるかを見る。
# Herdr のラベルを付けない使い捨てのターミナル（herdr-app には出ない）で動かし、終わったら消す。
set -uo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd)
term=$(hc run --bg --json -- python3 "$repo/scripts/fake-question.py" fake-claude | jq -r .address)
multi=$(hc run --bg --json -- python3 "$repo/scripts/fake-question.py" fake-claude --questions 3 | jq -r .address)
trap 'for t in "$term" "$multi"; do hc kill "$t" >/dev/null 2>&1; hc rm "$t" >/dev/null 2>&1; done' EXIT
sleep 1.5
fails=0
ok() { echo "yes  $1"; }
ng() { echo "no   $1"; fails=$((fails + 1)); }

status=$(hc get "$term" --json | jq -c '.status')
[ "$(printf '%s' "$status" | jq -r '.state + "/" + (.kind // "")')" = "blocked/question" ] && ok "reports blocked/question: $status" || ng "status: $status"

# 画面を読んで、選択肢 3 を選ぶキーを決める（オフィスの「?」から選んだときと同じ関数）
plan=$(hc read "$term" | bun -e '
  import { parseQuestion, keysFor } from "'"$repo"'/mods/ai-office-ask/parse.js";
  const q = parseQuestion(await Bun.stdin.text());
  console.log(JSON.stringify({ question: q?.question, labels: q?.options.map((o) => o.label), cursor: q?.cursor, keys: q && keysFor(q, 3) }));
')
echo "     parsed: $plan"
[ "$(printf '%s' "$plan" | jq -r .question)" = "次の作業はどれにしますか？" ] && ok "question read from the screen" || ng "question"
[ "$(printf '%s' "$plan" | jq -c .keys)" = '["down","down","enter"]' ] && ok "keys to choose option 3 from the cursor" || ng "keys"

# hc keys で送る（hc は、画面が 3 秒ほど静かになってから押す）
# shellcheck disable=SC2207 # キーの名前に空白はない（macOS の bash 3.2 には mapfile がない）
keys=($(printf '%s' "$plan" | jq -r '.keys[]'))
start=$(date +%s)
hc keys "$term" "${keys[@]}" >/dev/null
echo "     hc keys took $(($(date +%s) - start))s"
sleep 1
screen=$(hc read "$term")
case "$screen" in
  *"3. 調べる を選びました"*) ok "the answer arrived: option 3" ;;
  *) ng "the answer did not arrive. screen: $(printf '%s' "$screen" | tr '\n' ' ' | cut -c1-120)" ;;
esac
[ "$(hc get "$term" --json | jq -r '.status.state')" = "working" ] && ok "back to work after the answer" || ng "state after the answer"

# ---- 続けて 3 問 ----

# 選択肢 <番号> を送って、次の画面（next: 次の質問、done: もう質問で待っていない）が決まるまで読み直す。
# ポップアップの follow と同じく、250ms ごとに読み、同じ判定が 2 回続いたら決める
answer() {
  bun -e '
    import { parseQuestion, keysFor, nextRead } from "'"$repo"'/mods/ai-office-ask/parse.js";
    const [term, n] = Bun.argv.slice(-2);
    const hc = (...a) => Bun.spawnSync(["hc", ...a]).stdout.toString();
    const asking = () => {
      const s = JSON.parse(hc("get", term, "--json")).status ?? {};
      return s.state === "blocked" && s.kind === "question";
    };
    const prev = parseQuestion(hc("read", term));
    const keys = keysFor(prev, Number(n));
    Bun.spawnSync(["hc", "keys", term, ...keys]);
    let read = null;
    for (let i = 0; i < 24 && !read?.sure; i++) {
      await Bun.sleep(250);
      read = nextRead(read, prev, parseQuestion(hc("read", term)), asking());
    }
    const q = read.q;
    console.log(JSON.stringify({ chose: prev.options[n - 1]?.label, step: read.step, sure: read.sure, question: q?.question ?? null,
      steps: q ? q.steps.map((s) => (s.done ? "☒" : "☐") + s.label).join(" ") : null, review: q?.review ?? null }));
  ' "$1" "$2"
}
show() { echo "     $(printf '%s' "$1" | jq -c '{chose, step, sure, question, steps}')"; }

first=$(hc read "$multi" | bun -e '
  import { parseQuestion } from "'"$repo"'/mods/ai-office-ask/parse.js";
  const q = parseQuestion(await Bun.stdin.text());
  console.log(JSON.stringify({ question: q?.question, steps: q?.steps.map((s) => (s.done ? "☒" : "☐") + s.label).join(" ") }));
')
echo "     first: $first"
[ "$(printf '%s' "$first" | jq -r '.question + " | " + .steps')" = "次の作業はどれにしますか？ | ☐進め方 ☐言語 ☐テスト" ] \
  && ok "3 questions: the first one, with three tabs" || ng "3 questions: first screen"

r=$(answer "$multi" 3); show "$r"
[ "$(printf '%s' "$r" | jq -r '[.step, (.sure|tostring), .question, .steps] | join(" | ")')" = "next | true | どの言語で書きますか？ | ☒進め方 ☐言語 ☐テスト" ] \
  && ok "after answering the 1st: the 2nd question" || ng "after the 1st"

r=$(answer "$multi" 1); show "$r"
[ "$(printf '%s' "$r" | jq -r '[.step, (.sure|tostring), .question, .steps] | join(" | ")')" = "next | true | テストはどこまで書きますか？ | ☒進め方 ☒言語 ☐テスト" ] \
  && ok "after answering the 2nd: the 3rd question" || ng "after the 2nd"

r=$(answer "$multi" 2); show "$r"
[ "$(printf '%s' "$r" | jq -r '[.step, .question, (.review | join(","))] | join(" | ")')" \
  = "next | Ready to submit your answers? | ● 次の作業はどれにしますか？,→ 調べる,● どの言語で書きますか？,→ TypeScript,● テストはどこまで書きますか？,→ 結合テストまで" ] \
  && ok "after answering the 3rd: the review, with the three answers" || ng "after the 3rd"

r=$(answer "$multi" 1); show "$r"
[ "$(printf '%s' "$r" | jq -r '[.chose, .step, (.sure|tostring)] | join(" | ")')" = "Submit answers | done | true" ] \
  && ok "Submit answers: no longer asking (the popup closes)" || ng "after Submit answers"
case "$(hc read "$multi")" in
  *"答えを送りました: 調べる / TypeScript / 結合テストまで"*) ok "the three answers arrived together" ;;
  *) ng "the answers did not arrive. screen: $(hc read "$multi" | tr '\n' ' ' | cut -c1-120)" ;;
esac
[ "$(hc get "$multi" --json | jq -r '.status.state')" = "working" ] && ok "back to work after submitting" || ng "state after submitting"

echo "fails: $fails"
[ "$fails" -eq 0 ]
