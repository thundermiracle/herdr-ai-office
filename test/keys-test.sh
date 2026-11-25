#!/bin/bash
# scripts/keys.sh を、一時フォルダの keys.json（HERDR_APP_HOME）で試す。本物の ~/.config/herdr-app には触らない。
set -uo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -r "${tmp:?}"' EXIT
k="$tmp/keys.json"
fails=0

run() { HERDR_APP_HOME=$tmp "$repo/scripts/keys.sh" "$@"; }
inode() { ls -i "$k" | awk '{print $1}'; }
# expect <説明> <コマンド...>: コマンドが成功すれば yes
expect() {
  local name=$1 ok
  shift
  if "$@" >/dev/null 2>&1; then ok=yes; else ok=no; fails=$((fails + 1)); fi
  printf '%-4s %s\n' "$ok" "$name"
}

out=$(run add)
expect "no keys.json: add does not create one" test ! -e "$k"
expect "no keys.json: says why" grep -q "keys.json がない" <<<"$out"

# Herdr の既定のような keys.json（オフィスのキーはない）
cat >"$k" <<'EOF'
{
  "global": {
    "cmd-q": "app.quit",
    "cmd-w": "tab.close"
  },
  "terminal": {
    "ctrl-shift-c": "terminal.copy",
    "ctrl-left": "send:\u001bb"
  }
}
EOF
cp "$k" "$tmp/original.json"
out=$(run add)
expect "add: terminal cmd-. closes the overlay" jq -e '.terminal["cmd-."] == "overlay.close"' "$k"
expect "add: layout:ai-office cmd-shift-. reopens the last agent" \
  jq -e '.["layout:ai-office"]["cmd-shift-."] == "ai-office.open-last"' "$k"
expect "add: nothing else changes" \
  jq -e --slurpfile o "$tmp/original.json" 'del(.terminal["cmd-."], .["layout:ai-office"]) == $o[0]' "$k"
expect "add: keeps the original as keys.json.before-ai-office" cmp -s "$tmp/original.json" "$tmp/keys.json.before-ai-office"
expect "add: says what it added" grep -q "足した: terminal の cmd-.（overlay.close）" <<<"$out"
expect "add: keys.json stays 644" test "$(stat -f %Lp "$k" 2>/dev/null || stat -c %a "$k")" = 644
expect "add: leaves no temp file" test -z "$(find "$tmp" -name '.keys.json.*')"

cp "$k" "$tmp/added.json"
before=$(inode)
out=$(run add)
expect "add again: does not rewrite keys.json" test "$before" = "$(inode)"
expect "add again: says there is nothing to add" grep -q "同じ" <<<"$out"

out=$(run status)
expect "status: both keys are there" test "$(grep -c '^ある: ' <<<"$out")" = 2

out=$(run remove)
expect "remove: back to the original keys (the empty layout:ai-office goes too)" \
  jq -e --slurpfile o "$tmp/original.json" '. == $o[0]' "$k"
before=$(inode)
out=$(run remove)
expect "remove again: does not rewrite keys.json" test "$before" = "$(inode)"

# 同じキーを、人がほかに使っている
printf '%s\n' '{"terminal": {"cmd-.": "terminal.copy"}, "layout:ai-office": {"cmd-1": "x"}}' >"$k"
out=$(run add)
expect "taken: keeps the person's cmd-." jq -e '.terminal["cmd-."] == "terminal.copy"' "$k"
expect "taken: still adds cmd-shift-. beside the person's keys" \
  jq -e '.["layout:ai-office"] == {"cmd-1": "x", "cmd-shift-.": "ai-office.open-last"}' "$k"
expect "taken: says which key it left" grep -q "そのまま: terminal の cmd-. は、もう \"terminal.copy\"" <<<"$out"
out=$(run status)
expect "taken: status shows the other use" grep -q "ほかの使い方: terminal の cmd-. は \"terminal.copy\"" <<<"$out"
run remove >/dev/null
expect "taken: remove leaves the person's keys" \
  jq -e '.terminal == {"cmd-.": "terminal.copy"} and .["layout:ai-office"] == {"cmd-1": "x"}' "$k"

echo "fails: $fails"
[ "$fails" -eq 0 ]
