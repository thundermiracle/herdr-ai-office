#!/bin/bash
# hooks/claude-office-act.sh を、Claude Code と同じ形（sh -c "<コマンド>"、標準入力にフックの JSON）で試す。
# Herdr のラベルを付けない使い捨てのターミナル（herdr-app には出ない）を作り、ラベルの変わり方と、
# フックがすぐ終わる（hc を待たない）ことを確かめる。終わったらターミナルを消す。
set -uo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd)
hook="$repo/hooks/claude-office-act.sh"
tmp=$(mktemp -d)
term=$(hc run --bg --json -- sleep 300 | jq -r .address)
trap 'hc kill "$term" >/dev/null 2>&1; hc rm "$term" >/dev/null 2>&1; rm -r "${tmp:?}"' EXIT

now() { perl -MTime::HiRes=time -e 'printf "%.0f", time * 1000'; }
fails=0

# check <説明> <期待するラベル> <JSON> [HC_TERMINAL_ID を空にするなら none]
check() {
  local name=$1 want=$2 json=$3 id=$term
  [ "${4:-}" = none ] && id=""
  local start end got
  start=$(now)
  printf '%s' "$json" | HC_TERMINAL_ID="$id" TMPDIR="$tmp" sh -c "$hook" >"$tmp/out" 2>&1
  local code=$?
  end=$(now)
  sleep 0.4 # 裏の hc label を待つ
  got=$(hc get "$term" --json | jq -r '.labels["office.act"] // ""')
  local ms=$((end - start)) ok=yes
  [ "$got" = "$want" ] && [ "$code" -eq 0 ] && [ ! -s "$tmp/out" ] && [ "$ms" -lt 300 ] || ok=no
  [ "$ok" = yes ] || fails=$((fails + 1))
  printf '%-4s %-38s label=%-5s want=%-5s exit=%s %4sms%s\n' "$ok" "$name" "'$got'" "'$want'" "$code" "$ms" \
    "$([ -s "$tmp/out" ] && printf ' output: %s' "$(head -c 80 "$tmp/out")")"
}

pre() { printf '{"session_id":"s1","transcript_path":"/tmp/t.jsonl","cwd":"/tmp","permission_mode":"default","hook_event_name":"PreToolUse","tool_name":"%s","tool_input":{},"tool_use_id":"toolu_1"%s}' "$1" "${2:-}"; }
event() { printf '{"session_id":"s1","transcript_path":"/tmp/t.jsonl","cwd":"/tmp","hook_event_name":"%s"}' "$1"; }

check "PreToolUse Read -> read" read "$(pre Read)"
check "PreToolUse Grep (same value, skipped)" read "$(pre Grep)"
check "PreToolUse WebSearch" read "$(pre WebSearch)"
check "PreToolUse Edit -> edit" edit "$(pre Edit)"
check "PreToolUse Bash -> run" run "$(pre Bash)"
check "sub-agent Read is ignored" run "$(pre Read ',"agent_id":"a1"')"
check "PreToolUse TodoWrite -> cleared" "" "$(pre TodoWrite)"
check "PreToolUse WebFetch -> read" read "$(pre WebFetch)"
check "Stop -> cleared" "" "$(event Stop)"
check "outside herdr-app (no HC_TERMINAL_ID)" "" "$(pre Read)" none
check "UserPromptSubmit after Read -> cleared" "" "$(pre Read >/dev/null; event UserPromptSubmit)"

echo "fails: $fails"
[ "$fails" -eq 0 ]
