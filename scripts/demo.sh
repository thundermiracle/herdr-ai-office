#!/bin/bash
# オフィスの見本: 偽エージェント 6 人のスペース「office-test」を作る / 消す（AI は使わない）。
# 使い方: scripts/demo.sh start | stop
#   タイピング（opus・max で炎）・完了（✓、fable）・作業中に 20 秒ごとに herdr の skill を使い、資料室へ取りに行く（haiku）・
#   質問（?、Codex）・うろうろ（sonnet）・
#   全部を順に（cycle、ほかの AI）の 6 人。
#   質問や完了を報告するので、herdr-app の通知音とトーストが出る（cycle は 40 秒ごとに質問する）。
set -euo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd)
fa="$repo/scripts/fake-agent.sh"
name=office-test

spaces_named() {
  herdr-app ls | jq -r --arg n "$name" '.spaces[] | select(.name == $n) | .id'
}

case "${1:-}" in
  start)
    if [ -n "$(spaces_named)" ]; then
      echo "demo.sh: もう「${name}」があります（scripts/demo.sh stop で消せます）" >&2
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
TABS
    # 作ったタブは「見た」扱いになって done がすぐ idle に戻るので、元のスペースに戻しておく
    [ -n "$orig" ] && [ "$orig" != null ] && herdr-app do space.select --id "$orig" >/dev/null
    echo "「${name}」を作りました（${sp}）"
    ;;
  stop)
    for id in $(spaces_named); do
      herdr-app do space.close --id "$id" --confirmed true >/dev/null
      echo "「${name}」を消しました（${id}）"
    done
    ;;
  *)
    echo "使い方: scripts/demo.sh start | stop" >&2
    exit 2
    ;;
esac
