#!/bin/bash
# 質問に答える流れを、偽の質問役（scripts/fake-question.py）で通しで試す:
# hc read の画面を parse.js で読み、選択肢 3 を選ぶキーを hc keys で送り、質問役がそれを受け取ったかを見る。
# Herdr のラベルを付けない使い捨てのターミナル（herdr-app には出ない）で動かし、終わったら消す。
set -uo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd)
term=$(hc run --bg --json -- python3 "$repo/scripts/fake-question.py" fake-claude | jq -r .address)
trap 'hc kill "$term" >/dev/null 2>&1; hc rm "$term" >/dev/null 2>&1' EXIT
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

echo "fails: $fails"
[ "$fails" -eq 0 ]
