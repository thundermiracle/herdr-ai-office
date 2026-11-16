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

# 同じ skill をもう一度使うと、office.skill_at が変わる（AI Office はこれを出来事として資料室へ行く）
at1=$(hc get "$term" --json | jq -r '.labels["office.skill_at"] // ""')
printf '%s' "$(pre Skill '' '{"skill":"herdr"}')" | HC_TERMINAL_ID="$term" TMPDIR="$tmp" sh -c "$hook"
sleep 0.4
at2=$(hc get "$term" --json | jq -r '.labels["office.skill_at"] // ""')
printf '%s' "$(pre Skill '' '{"skill":"herdr"}')" | HC_TERMINAL_ID="$term" TMPDIR="$tmp" sh -c "$hook"
sleep 0.4
at3=$(hc get "$term" --json | jq -r '.labels["office.skill_at"] // ""')
if [ -n "$at2" ] && [ "$at2" != "$at1" ] && [ "$at3" != "$at2" ]; then
  echo "yes  the same skill used twice is two events     skill_at: '$at1' -> '$at2' -> '$at3'"
else
  echo "no   the same skill used twice is two events     skill_at: '$at1' -> '$at2' -> '$at3'"
  fails=$((fails + 1))
fi

# 話しかけ: Bash の hc send は office.talk・office.talk_text と、変わる office.talk_at。届いた <hc from> は office.heard...
# talk_check <説明> <JSON> <ラベルの頭（talk か heard）> <期待する相手> <期待する文>（相手が空なら、出来事にならないこと）
label() { hc get "$term" --json | jq -r --arg k "$1" '.labels[$k] // ""'; }
talk_check() {
  local name=$1 json=$2 key=$3 want_to=$4 want_text=$5 before after start end ok=yes
  before=$(label "office.${key}_at")
  start=$(now)
  printf '%s' "$json" | HC_TERMINAL_ID="$term" TMPDIR="$tmp" sh -c "$hook" >"$tmp/out" 2>&1
  end=$(now)
  sleep 0.4
  after=$(label "office.${key}_at")
  if [ -n "$want_to" ]; then
    [ "$(label "office.$key")" = "$want_to" ] && [ "$(label "office.${key}_text")" = "$want_text" ] && [ "$after" != "$before" ] || ok=no
  else
    [ "$after" = "$before" ] || ok=no
  fi
  [ ! -s "$tmp/out" ] && [ $((end - start)) -lt 300 ] || ok=no
  [ "$ok" = yes ] || fails=$((fails + 1))
  printf '%-4s %-40s %s=%-8s text=%-26s %4sms\n' "$ok" "$name" "$key" "'$(label "office.$key")'" "'$(label "office.${key}_text")'" $((end - start))
}
bash_cmd() { pre Bash '' "$(jq -cn --arg c "$1" '{command: $c}')"; }

talk_check "hc send t7 -> talk" "$(bash_cmd 'hc send t7 "Please review src/x.rs only"')" talk t7 "Please review src/x.rs only"
talk_check "same send again is a new event" "$(bash_cmd 'hc send t7 "Please review src/x.rs only"')" talk t7 "Please review src/x.rs only"
talk_check "options and a heredoc" "$(bash_cmd "cd /x && hc send --wait --timeout 60 review \"\$(cat <<'EOF'
Two bugs in x.rs
details in findings.md
EOF
)\"")" talk review "Two bugs in x.rs"
talk_check "hc send \$VAR is not known" "$(bash_cmd 'hc send "$PARENT" "done"')" talk "" ""
talk_check "plain Bash is not a talk" "$(bash_cmd 'git status')" talk "" ""
talk_check "<hc from> prompt -> heard" "$(prompt '<hc from="t6m office-test-a" reach="hc send t6m when done">please review x.rs</hc>')" heard t6m "please review x.rs"
check "the <hc from> prompt clears act" "" "" "$(prompt '<hc from="t6m office-test-a">again</hc>')"

# プラン: プランモードで書く .md と ~/.claude/plans/ の .md、ExitPlanMode の planFilePath は office.plan。
# ほかのツールや Stop では残り、SessionEnd で消える
# plan_check <説明> <JSON> <期待する office.plan>
plan_check() {
  local name=$1 json=$2 want=$3 start end ok=yes
  start=$(now)
  printf '%s' "$json" | HC_TERMINAL_ID="$term" TMPDIR="$tmp" sh -c "$hook" >"$tmp/out" 2>&1
  end=$(now)
  sleep 0.4
  [ "$(label office.plan)" = "$want" ] && [ ! -s "$tmp/out" ] && [ $((end - start)) -lt 300 ] || ok=no
  [ "$ok" = yes ] || fails=$((fails + 1))
  printf '%-4s %-40s plan=%-34s %4sms\n' "$ok" "$name" "'$(label office.plan)'" $((end - start))
}
# write <ツール> <file_path> [JSON に足すフィールド]（後ろに足した permission_mode が勝つ）
write() { pre "$1" "${3:-}" "$(jq -cn --arg f "$2" '{file_path: $f, content: "x"}')"; }
in_plan=',"permission_mode":"plan"'

plan_check "Write .md outside plan mode: no plan" "$(write Write /repo/notes.md)" ""
plan_check "Write a non-.md in plan mode: no plan" "$(write Write /repo/x.txt "$in_plan")" ""
plan_check "Write .md in plan mode -> plan" "$(write Write /repo/docs/plans/p1.md "$in_plan")" /repo/docs/plans/p1.md
plan_check "Read keeps the plan" "$(pre Read)" /repo/docs/plans/p1.md
plan_check "Stop keeps the plan" "$(event Stop)" /repo/docs/plans/p1.md
plan_check "Edit under ~/.claude/plans -> plan" "$(write Edit /u/.claude/plans/quiet-fox.md)" /u/.claude/plans/quiet-fox.md
plan_check "ExitPlanMode planFilePath -> plan" "$(pre ExitPlanMode '' '{"plan":"# P","planFilePath":"/u/.claude/plans/b.md"}')" \
  /u/.claude/plans/b.md
plan_check "sub-agent plan write is ignored" "$(write Write /repo/sub.md "$in_plan,\"agent_id\":\"a1\"")" /u/.claude/plans/b.md
plan_check "SessionEnd clears the plan" "$(event SessionEnd)" ""

echo "fails: $fails"
[ "$fails" -eq 0 ]
