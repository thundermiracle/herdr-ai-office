#!/bin/bash
# hooks/claude-office-act.sh を ~/.claude/settings.json に登録する / 外す（PoC 用。あとで chezmoi に移すかもしれない）。
# 使い方: hooks/register.sh add | remove | status
#   add:    PreToolUse（matcher "*"）・UserPromptSubmit・Stop・SessionEnd に足す（もうあれば何もしない）
#   remove: このスクリプトのコマンドを持つフックだけ消す（ほかのフックはそのまま。空になったイベントも消す）
# Claude Code は起動したときのフックを使うので、変えたあとに起動した Claude から効く。
set -euo pipefail

cmd="$(cd "$(dirname "$0")" && pwd)/claude-office-act.sh"
settings="$HOME/.claude/settings.json"
[ -f "$settings" ] || { echo "register.sh: $settings がありません" >&2; exit 1; }

case "${1:-}" in
  add)
    filter='
      def add(event; group):
        if any(.hooks[event][]?; any(.hooks[]?; .command == $cmd)) then .
        else .hooks[event] = ((.hooks[event] // []) + [group]) end;
      add("PreToolUse"; {matcher: "*", hooks: [{type: "command", command: $cmd}]})
      | add("UserPromptSubmit"; {hooks: [{type: "command", command: $cmd}]})
      | add("Stop"; {hooks: [{type: "command", command: $cmd}]})
      | add("SessionEnd"; {hooks: [{type: "command", command: $cmd}]})'
    ;;
  remove)
    filter='
      .hooks |= (with_entries(.value |= map(.hooks |= map(select(.command != $cmd)) | select(.hooks | length > 0)))
                 | with_entries(select(.value | length > 0)))'
    ;;
  status)
    jq -r --arg cmd "$cmd" '[.hooks // {} | to_entries[] | select(any(.value[]; any(.hooks[]; .command == $cmd))) | .key]
      | if length > 0 then "登録済み: " + join(", ") else "登録されていません" end' "$settings"
    exit 0
    ;;
  *)
    echo "使い方: hooks/register.sh add | remove | status" >&2
    exit 2
    ;;
esac

tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
jq --arg cmd "$cmd" "$filter" "$settings" >"$tmp"
jq -e . "$tmp" >/dev/null
cat "$tmp" >"$settings" # 上書きで書く（ファイルの権限はそのまま）
"$0" status
