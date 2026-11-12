#!/bin/bash
# オフィスの見本: 偽エージェントのスペース「office-test」（7 人）と「office-test-2」（2 人）を作る / 消す（AI は使わない）。
# 使い方: scripts/demo.sh start | stop
#   office-test: タイピング（opus・max で炎）・完了（✓、fable）・作業中に 20 秒ごとに herdr の skill を使い、資料室へ取りに行く（haiku）・
#   質問（?、Codex）・うろうろ（タブ idle、sonnet）・全部を順に（cycle、ほかの AI）・
#   30 秒ごとに office-test-2 の reviewer へ hc send で話しかけに行く（talks、Codex）の 7 人。
#   office-test-2: 30 秒ごとに office-test の idle へ話しかけに行く（lead、opus）と、タイピング（タブ reviewer、sonnet）の 2 人。
#   質問や完了を報告するので、herdr-app の通知音とトーストが出る（cycle は 40 秒ごとに質問する）。
set -euo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd)
fa="$repo/scripts/fake-agent.sh"
name=office-test
name2=office-test-2

spaces_named() {
  herdr-app ls | jq -r --arg n "$name" --arg n2 "$name2" '.spaces[] | select(.name == $n or .name == $n2) | .id'
}

case "${1:-}" in
  start)
    if [ -n "$(spaces_named)" ]; then
      echo "demo.sh: もう「${name}」か「${name2}」があります（scripts/demo.sh stop で消せます）" >&2
      exit 1
    fi
    orig=$(herdr-app status | jq -r .space)
    # fake-agent.sh は 3 つ目からの引数を使わないが、オフィスは起動引数から model と effort を読むので、見た目が変わる
    argv() { printf '%s\n' "$fa" "$@" | jq -R . | jq -sc .; } # 引数を 1 行ずつ JSON の配列に（- で始まる引数も）
    sp=$(herdr-app do space.new --name "$name" --folder "$repo" \
      --argv "$(argv working fake-claude --model claude-opus-5-5 --effort max)" | jq -r .space)
    while read -r mode app rest; do
      # shellcheck disable=SC2086 # rest は model と effort の引数（空白で分ける）
      herdr-app do tab.new --space "$sp" --name "$mode" --argv "$(argv "$mode" "$app" $rest)" >/dev/null
    done <<'TABS'
done fake-claude --model claude-fable-5-2 --effort high
skills:herdr fake-claude --model claude-haiku-5-5 --effort medium
ask fake-codex -c model_reasoning_effort=xhigh
idle fake-claude --model claude-sonnet-5-5 --effort low
cycle fake
talks:reviewer:20 fake-codex -c model_reasoning_effort=high
TABS
    # 2 つ目の部屋: idle へ話しかけに行く lead と、話しかけられる reviewer
    sp2=$(herdr-app do space.new --name "$name2" --folder "$repo" \
      --argv "$(argv talks:idle:8 fake-claude --model claude-opus-5-5 --effort high)" | jq -r .space)
    herdr-app do tab.new --space "$sp2" --name reviewer \
      --argv "$(argv working fake-claude --model claude-sonnet-5-5 --effort medium)" >/dev/null
    # 作ったタブは「見た」扱いになって done がすぐ idle に戻るので、元のスペースに戻しておく
    [ -n "$orig" ] && [ "$orig" != null ] && herdr-app do space.select --id "$orig" >/dev/null
    echo "「${name}」（${sp}）と「${name2}」（${sp2}）を作りました"
    ;;
  stop)
    for id in $(spaces_named); do
      herdr-app do space.close --id "$id" --confirmed true >/dev/null
      echo "見本のスペースを消しました（${id}）"
    done
    ;;
  *)
    echo "使い方: scripts/demo.sh start | stop" >&2
    exit 2
    ;;
esac
