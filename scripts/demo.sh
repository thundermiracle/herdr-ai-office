#!/bin/bash
# オフィスの見本: 偽エージェント 6 人のスペース「office-test」を作る / 消す（AI は使わない）。
# 使い方: scripts/demo.sh start | stop
#   タイピング・本棚・質問（?）・完了（✓）・うろうろ・全部を順に（cycle）の 6 人。
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
    argv() { jq -cn --arg f "$fa" --arg m "$1" --arg a "$2" '[$f, $m, $a]'; }
    sp=$(herdr-app do space.new --name "$name" --folder "$repo" --argv "$(argv working fake-claude)" | jq -r .space)
    for spec in "done fake-claude" "read fake-claude" "ask fake-codex" "idle fake-codex" "cycle fake"; do
      read -r mode app <<<"$spec"
      herdr-app do tab.new --space "$sp" --name "$mode" --argv "$(argv "$mode" "$app")" >/dev/null
    done
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
