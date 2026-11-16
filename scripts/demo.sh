#!/bin/bash
# オフィスの見本: 偽エージェントのスペース「office-test」（7 人）と「office-test-2」（3 人）を作る / 消す（AI は使わない）。
# 使い方: scripts/demo.sh start | stop
#   office-test: タイピング（opus・max で炎）・完了（✓、fable）・作業中に 20 秒ごとに herdr の skill を使い、資料室へ取りに行く（haiku）・
#   質問（?、Codex。3 問を続けて聞き、最後に答えの確認）・うろうろ（タブ idle、sonnet）・全部を順に（cycle、ほかの AI）・
#   30 秒ごとに office-test-2 の reviewer へ hc send で話しかけに行く（talks、Codex）の 7 人。
#   office-test-2: 30 秒ごとに office-test の idle へ話しかけに行く（lead、opus）・プランを書いてタイピング（タブ reviewer、sonnet。
#   壁にプランのホワイトボード、中身は scripts/sample-plan.md）・
#   30 秒ごとに同じ部屋の reviewer へ話しかけに行く（タブ designer、haiku）の 3 人。
#   質問や完了を報告するので、herdr-app の通知音とトーストが出る（cycle は 40 秒ごとに質問する）。
# herdr-app は作ったスペースとタブをすぐ見せるので、start の間（1〜2 秒）は画面が見本へ動き、その間に打ったキーは見本の
# ターミナルに入る。終わったら（途中で失敗しても）元のスペース・タブ・ペインに戻し、戻ったかを確かめる。
# 人がほかのエージェントに書いている最中に動かさない（AI が確かめに使うときは、先に聞く。README の「開発」）。
set -euo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd)
fa="$repo/scripts/fake-agent.sh"
name=office-test
name2=office-test-2

spaces_named() {
  herdr-app ls | jq -r --arg n "$name" --arg n2 "$name2" '.spaces[] | select(.name == $n or .name == $n2) | .id'
}

# start の前に見ていたスペース・タブ・ペイン（view）に戻す。戻ったかを確かめ、違っていればもう一度
restore() {
  local space tab pane
  space=$(printf '%s' "$view" | jq -r '.space // empty')
  tab=$(printf '%s' "$view" | jq -r '.tab // empty')
  pane=$(printf '%s' "$view" | jq -r '.pane // empty')
  [ -n "$space" ] || return 0
  for _ in 1 2; do
    herdr-app do space.select --id "$space" >/dev/null || true
    [ -z "$tab" ] || herdr-app do tab.select --id "$tab" >/dev/null || true
    [ -z "$pane" ] || herdr-app do pane.focus --pane "$pane" >/dev/null || true
    sleep 0.3
    [ "$(herdr-app status | jq -r '"\(.space) \(.tab)"')" = "$space $tab" ] && return 0
  done
  echo "demo.sh: 元のスペース（${space}）に戻せませんでした" >&2
}

case "${1:-}" in
  start)
    if [ -n "$(spaces_named)" ]; then
      echo "demo.sh: もう「${name}」か「${name2}」があります（scripts/demo.sh stop で消せます）" >&2
      exit 1
    fi
    # 今見ているところ。作り終えたら（途中で失敗しても）ここへ戻す（見本のタブを見たままだと、「見た」扱いで done がすぐ idle に戻る）
    view=$(herdr-app status | jq -c '{space, tab, pane: .focused_pane}')
    trap restore EXIT
    # fake-agent.sh は 3 つ目からの引数を使わないが、オフィスは起動引数から model と effort を読むので、見た目が変わる
    argv() { printf '%s\n' "$fa" "$@" | jq -R . | jq -sc .; } # 引数を 1 行ずつ JSON の配列に（- で始まる引数も）
    sp=$(herdr-app do space.new --name "$name" --folder "$repo" \
      --argv "$(argv working fake-claude --model claude-opus-5-5 --effort max)" | jq -r .space)
    while read -r mode app rest; do
      # shellcheck disable=SC2086 # rest は model・effort・質問の数などの引数（空白で分ける）
      herdr-app do tab.new --space "$sp" --name "$mode" --argv "$(argv "$mode" "$app" $rest)" >/dev/null
    done <<'TABS'
done fake-claude --model claude-fable-5-2 --effort high
skills:herdr fake-claude --model claude-haiku-5-5 --effort medium
ask fake-codex -c model_reasoning_effort=xhigh --questions 3
idle fake-claude --model claude-sonnet-5-5 --effort low
cycle fake
talks:reviewer:20 fake-codex -c model_reasoning_effort=high
TABS
    # 2 つ目の部屋: idle（ほかの部屋）へ話しかけに行く lead、話しかけられる reviewer、reviewer（同じ部屋）へ話しかけに行く designer。
    # reviewer へは designer（4 秒後から）と office-test の Codex（20 秒後から）が 30 秒ごとに行くので、重ならない
    sp2=$(herdr-app do space.new --name "$name2" --folder "$repo" \
      --argv "$(argv talks:idle:8 fake-claude --model claude-opus-5-5 --effort high)" | jq -r .space)
    herdr-app do tab.new --space "$sp2" --name reviewer \
      --argv "$(argv "plan:$repo/scripts/sample-plan.md" fake-claude --model claude-sonnet-5-5 --effort medium)" >/dev/null
    herdr-app do tab.new --space "$sp2" --name designer \
      --argv "$(argv talks:reviewer:4 fake-claude --model claude-haiku-5-5 --effort low)" >/dev/null
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
