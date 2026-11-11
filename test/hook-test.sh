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

# check <説明> <期待する office.act> <期待する office.skill> <JSON> [HC_TERMINAL_ID を空にするなら none]
check() {
  local name=$1 want=$2 want_skill=$3 json=$4 id=$term
  [ "${5:-}" = none ] && id=""
  local start end got got_skill
  start=$(now)
  printf '%s' "$json" | HC_TERMINAL_ID="$id" TMPDIR="$tmp" sh -c "$hook" >"$tmp/out" 2>&1
  local code=$?
  end=$(now)
  sleep 0.4 # 裏の hc label を待つ
  got=$(hc get "$term" --json | jq -r '.labels["office.act"] // ""')
  got_skill=$(hc get "$term" --json | jq -r '.labels["office.skill"] // ""')
  local ms=$((end - start)) ok=yes
  [ "$got" = "$want" ] && [ "$got_skill" = "$want_skill" ] && [ "$code" -eq 0 ] && [ ! -s "$tmp/out" ] && [ "$ms" -lt 300 ] || ok=no
  [ "$ok" = yes ] || fails=$((fails + 1))
  printf '%-4s %-40s act=%-6s skill=%-14s exit=%s %4sms%s\n' "$ok" "$name" "'$got'" "'$got_skill'" "$code" "$ms" \
    "$([ -s "$tmp/out" ] && printf ' output: %s' "$(head -c 80 "$tmp/out")")"
}

# pre <ツール> [JSON に足すフィールド] [tool_input の JSON]
pre() {
  local input=${3:-}
  [ -n "$input" ] || input='{}'
  printf '{"session_id":"s1","transcript_path":"/tmp/t.jsonl","cwd":"/tmp","permission_mode":"default","hook_event_name":"PreToolUse","tool_name":"%s","tool_input":%s,"tool_use_id":"toolu_1"%s}' "$1" "$input" "${2:-}"
}
event() { printf '{"session_id":"s1","transcript_path":"/tmp/t.jsonl","cwd":"/tmp","hook_event_name":"%s"}' "$1"; }
prompt() { jq -cn --arg p "$1" '{session_id: "s1", transcript_path: "/tmp/t.jsonl", cwd: "/tmp", hook_event_name: "UserPromptSubmit", prompt: $p}'; }

check "PreToolUse Read -> read" read "" "$(pre Read)"
check "PreToolUse Grep (same value, skipped)" read "" "$(pre Grep)"
check "PreToolUse WebSearch" read "" "$(pre WebSearch)"
check "PreToolUse Edit -> edit" edit "" "$(pre Edit)"
check "PreToolUse Bash -> run" run "" "$(pre Bash)"
check "sub-agent Read is ignored" run "" "$(pre Read ',"agent_id":"a1"')"
check "PreToolUse TodoWrite -> act cleared" "" "" "$(pre TodoWrite)"
check "Skill herdr -> read + skill" read herdr "$(pre Skill '' '{"skill":"herdr"}')"
check "Bash after the skill keeps the skill" run herdr "$(pre Bash)"
check "Stop -> both cleared" "" "" "$(event Stop)"
check "/codex:rescue prompt -> read + skill" read codex:rescue "$(prompt '/codex:rescue fix the login bug')"
check "plain prompt -> both cleared" "" "" "$(prompt 'hello there')"
check "outside herdr-app (no HC_TERMINAL_ID)" "" "" "$(pre Read)" none
check "UserPromptSubmit after Read -> cleared" "" "" "$(pre Read >/dev/null; prompt 'next please')"

echo "fails: $fails"
[ "$fails" -eq 0 ]
