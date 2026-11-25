#!/bin/bash
# オフィスが使うキー（リポジトリの keys.json）を、herdr のキーの設定 ~/.config/herdr-app/keys.json に足す / 外す。
# 今は 2 つ: terminal の cmd-.（overlay.close。オフィスの上に重ねたターミナルを閉じる。Esc はエージェントに届くので）と、
# layout:ai-office の cmd-shift-.（ai-office.open-last。最後にオフィスで開いた人をもう一度開く）。
# 使い方: scripts/keys.sh add | remove | status
#   add:    ないキーだけ足す（Herdr の、キーのある mod の入れ方と同じ。同じキーをほかに使っていれば変えずに知らせる）。
#           足すものがなければ書かない
#   remove: このリポジトリのキーのうち、まだ同じ使い方のものだけ消す（空になった欄も消す）
# keys.json は一字でも書き換えると人のものになり、Herdr を更新しても新しい既定のショートカットが自動では入らなくなる。
# 初めて書き換えるときに、元を keys.json.before-ai-office に残す。keys.json がまだない（herdr-app を一度も起動していない）
# ときは何もしない（2 つだけの keys.json を作ると、既定のショートカットが全部なくなるので）。Herdr はすぐ読み直す。
set -euo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd)
app=${HERDR_APP_HOME:-$HOME/.config/herdr-app}
keys="$app/keys.json"
backup="$app/keys.json.before-ai-office"
want=$(jq -c . "$repo/keys.json")

case "${1:-}" in
  add | remove | status) ;;
  *)
    echo "使い方: scripts/keys.sh add | remove | status" >&2
    exit 2
    ;;
esac

if [ ! -f "$keys" ]; then
  echo "keys.json がない（${keys}）。herdr-app を一度起動すると作られるので、そのあとにもう一度流す"
  exit 0
fi

# リポジトリのキー 1 つずつ: 欄・キー・使い方と、人の keys.json でのそのキー（have。なければ null）
rows='(. as $have | $want | to_entries[] | .key as $sec | .value | to_entries[]
  | {sec: $sec, key: .key, action: .value, have: $have[$sec][.key]})'
ask() { jq -r --argjson want "$want" "$rows | $1" "$keys"; }

case "$1" in
  status)
    ask 'if .have == .action then "ある: \(.sec) の \(.key)（\(.action)）"
      elif .have == null then "ない: \(.sec) の \(.key)（\(.action)）。scripts/keys.sh add で足す"
      else "ほかの使い方: \(.sec) の \(.key) は \(.have | tojson)（\(.action) にするなら keys.json を手で直す）" end'
    exit 0
    ;;
  add)
    ask 'select(.have != null and .have != .action)
      | "そのまま: \(.sec) の \(.key) は、もう \(.have | tojson) に使われている（\(.action) にするなら keys.json を手で直す）"'
    change=$(ask 'select(.have == null) | "足した: \(.sec) の \(.key)（\(.action)）"')
    filter="reduce ($rows | select(.have == null)) as \$r (.; .[\$r.sec][\$r.key] = \$r.action)"
    none="足すキーはない"
    ;;
  remove)
    change=$(ask 'select(.have == .action) | "外した: \(.sec) の \(.key)（\(.action)）"')
    filter="reduce ($rows | select(.have == .action)) as \$r (.; del(.[\$r.sec][\$r.key]))
      | reduce (\$want | keys[]) as \$sec (.; if .[\$sec] == {} then del(.[\$sec]) else . end)"
    none="外すキーはない"
    ;;
esac

# 足す・外すものがなければ書かない（書けば、まだ Herdr のままの keys.json が人のものになる）
if [ -z "$change" ]; then
  echo "同じ: keys.json（${none}。書き換えない）"
  exit 0
fi
# 同じフォルダの一時ファイルに書いてから mv（Herdr が書きかけを読まないように）
tmp=$(mktemp "$app/.keys.json.XXXXXX")
trap 'rm -f "$tmp"' EXIT
jq --argjson want "$want" "$filter" "$keys" >"$tmp"
jq -e 'type == "object"' "$tmp" >/dev/null
chmod 644 "$tmp"
[ -e "$backup" ] || cp -p "$keys" "$backup"
mv "$tmp" "$keys"
printf '%s\n' "$change"
echo "keys.json を書き換えた（前のもの: ${backup}）。書き換えた keys.json には、Herdr を更新しても新しい既定のショートカットが自動では入らない"
# 動いている herdr-app が読めたか（起動していなければ何もしない）
if herdr-app status >/dev/null 2>&1; then
  herdr-app status | jq -c '.errors'
fi
