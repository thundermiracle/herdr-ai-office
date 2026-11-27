#!/bin/bash
# 同じフォルダの claude-office-act.sh を、Claude Code のフックとして ~/.claude/settings.json に登録する / 外す。
# 入れた mod のもの（~/.config/herdr-app/mods/ai-office/hook/）を登録する。scripts/install.sh もそうする。
# 使い方: bash ~/.config/herdr-app/mods/ai-office/hook/register.sh add | remove | status
#   add:    PreToolUse（matcher "*"）・UserPromptSubmit・Stop・SessionEnd に足す（もうあれば何もしない）。ほかの場所の
#           claude-office-act.sh（前にリポジトリの hooks/ から登録したものなど）は外して、こちらに付け替える
#   remove: claude-office-act.sh のフックを、どこのものでもすべて外す（ほかのフックはそのまま。空になったイベントも消す）
# コマンドは sh "<道>" で登録する（コピーで実行の権限が落ちても動くように）。
# Claude Code は起動したときのフックを使うので、変えたあとに起動した Claude から効く。
set -euo pipefail

cmd="sh \"$(cd "$(dirname "$0")" && pwd)/claude-office-act.sh\""
settings="$HOME/.claude/settings.json"
[ -f "$settings" ] || { echo "register.sh: $settings がありません（echo '{}' > $settings で作れる）" >&2; exit 1; }

# このフックかどうかは、コマンドに claude-office-act.sh が入っているかで見る（前の場所のものも外せるように）。
# prune(keep): このフックのうち keep でないものを外し、空になったグループとイベントも消す
prune='def office: (.command // "") | test("claude-office-act\\.sh");
  def prune(keep): if .hooks == null then . else
    .hooks |= (with_entries(.value |= map(.hooks |= ((. // []) | map(select((office | not) or keep))) | select(.hooks | length > 0)))
               | with_entries(select(.value | length > 0))) end;'

case "${1:-}" in
  add)
    filter="$prune"'
      def add(event; group):
        if any(.hooks[event][]?; any(.hooks[]?; .command == $cmd)) then .
        else .hooks[event] = ((.hooks[event] // []) + [group]) end;
      prune(.command == $cmd)
      | add("PreToolUse"; {matcher: "*", hooks: [{type: "command", command: $cmd}]})
      | add("UserPromptSubmit"; {hooks: [{type: "command", command: $cmd}]})
      | add("Stop"; {hooks: [{type: "command", command: $cmd}]})
      | add("SessionEnd"; {hooks: [{type: "command", command: $cmd}]})'
    ;;
  remove)
    filter="$prune"' prune(false)'
    ;;
  status)
    jq -r --arg cmd "$cmd" '
      [.hooks // {} | to_entries[] | select(any(.value[]; any(.hooks[]?; .command == $cmd))) | .key] as $mine
      | [.hooks // {} | .[][] | .hooks[]? | .command // "" | select(test("claude-office-act\\.sh") and . != $cmd)] | unique as $others
      | (if ($mine | length) > 0 then "登録済み: " + ($mine | join(", ")) else "登録されていません" end)
        + (if ($others | length) > 0 then "（ほかの場所のフックも登録されている: " + ($others | join(" / ")) + "。add で付け替える）"
           else "" end)' "$settings"
    exit 0
    ;;
  *)
    echo "使い方: bash register.sh add | remove | status" >&2
    exit 2
    ;;
esac

tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
jq --arg cmd "$cmd" "$filter" "$settings" >"$tmp"
jq -e . "$tmp" >/dev/null
cat "$tmp" >"$settings" # 上書きで書く（ファイルの権限はそのまま）
bash "$0" status
