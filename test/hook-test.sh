#!/bin/bash
# hooks/claude-office-act.sh を、Claude Code と同じ形（sh -c "<コマンド>"、標準入力にフックの JSON）で試す。
# Herdr のラベルを付けない使い捨てのターミナル（herdr-app には出ない）を作り、ラベルの変わり方と、
# フックがすぐ終わる（hc を待たない）ことを確かめる。終わったらターミナルを消す。
set -uo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd)
# HOOK で、置き換える前の写しを試せる（式 md-writes.jq は、フックと同じフォルダのもの）
hook=${HOOK:-$repo/hooks/claude-office-act.sh}
md_jq="$(dirname "$hook")/md-writes.jq"
tmp=$(mktemp -d)
# 本物の .md を書くプロジェクトのフォルダ（一時フォルダの外。tmp/ は git に入らない）
proj="$repo/tmp/hook-test-$$"
mkdir -p "$proj"
term=$(hc run --bg --json -- sleep 300 | jq -r .address)
trap 'hc kill "$term" >/dev/null 2>&1; hc rm "$term" >/dev/null 2>&1; rm -r "${tmp:?}" "${proj:?}"' EXIT

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

# 使い捨てのターミナルを作った直後の 1 回目は、フックに関係なく 300ms を超えることがあるので、先に 1 回空打ちする
printf '%s' '{"hook_event_name":"Notification"}' | HC_TERMINAL_ID="$term" TMPDIR="$tmp" sh -c "$hook" >/dev/null 2>&1
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

# 書いた .md: プラン以外の .md を書く Write / Edit / MultiEdit は office.docs（新しい順に 8 本、改行で区切る）。
# ~/.claude/ の中は入れない。セッションが変われば新しい一覧。SessionEnd で消える
# doc_check <説明> <JSON> <期待する office.docs（改行で区切る）>
doc_check() {
  local name=$1 json=$2 want=$3 start end ok=yes
  start=$(now)
  printf '%s' "$json" | HC_TERMINAL_ID="$term" TMPDIR="$tmp" sh -c "$hook" >"$tmp/out" 2>&1
  end=$(now)
  sleep 0.4
  [ "$(label office.docs)" = "$want" ] && [ ! -s "$tmp/out" ] && [ $((end - start)) -lt 300 ] || ok=no
  [ "$ok" = yes ] || fails=$((fails + 1))
  printf '%-4s %-40s docs=%-44s %4sms\n' "$ok" "$name" "'$(label office.docs | tr '\n' ',')'" $((end - start))
}
nl='
'
# Bash で .md を書く: PreToolUse（フック）→ コマンドを本当に流す → 次のフック（Stop）。コマンドの前後でファイルが変わった .md が
# office.docs に入る（コマンドに出てくる .md は書いたかもしれないものとして覚え、あとのフックで確かめる）
# run_bash <説明> <cwd> <コマンド> <期待する office.docs> [セッション]
run_bash() {
  local name=$1 cwd=$2 cmd=$3 want=$4 sess=${5:-s3} start end ok=yes
  start=$(now)
  pre Bash ",\"session_id\":\"$sess\",\"cwd\":\"$cwd\"" "$(jq -cn --arg c "$cmd" '{command: $c}')" \
    | HC_TERMINAL_ID="$term" TMPDIR="$tmp" sh -c "$hook" >"$tmp/out" 2>&1
  end=$(now)
  (cd "$cwd" && sh -c "$cmd") >/dev/null 2>&1
  event Stop | jq -c --arg s "$sess" '.session_id = $s' | HC_TERMINAL_ID="$term" TMPDIR="$tmp" sh -c "$hook" >>"$tmp/out" 2>&1
  sleep 0.4
  [ "$(label office.docs)" = "$want" ] && [ ! -s "$tmp/out" ] && [ $((end - start)) -lt 300 ] || ok=no
  [ "$ok" = yes ] || fails=$((fails + 1))
  printf '%-4s %-40s %4sms docs=%s\n' "$ok" "$name" $((end - start)) "'$(label office.docs | sed "s#$proj#P#g; s#$tmp#T#g" | tr '\n' ',')'"
}

doc_check "Write .md (default mode) -> docs" "$(write Write /repo/README.md)" /repo/README.md
doc_check "another .md comes first" "$(write Write /repo/docs/a.md)" "/repo/docs/a.md$nl/repo/README.md"
doc_check "editing an older one moves it up" "$(write Edit /repo/README.md)" "/repo/README.md$nl/repo/docs/a.md"
doc_check "Claude's memory is not a doc" "$(write Write /u/.claude/projects/x/memory/m.md)" "/repo/README.md$nl/repo/docs/a.md"
doc_check "a plan-mode .md is a plan, not a doc" "$(write Write /repo/docs/plans/p2.md "$in_plan")" "/repo/README.md$nl/repo/docs/a.md"
doc_check "sub-agent writes are ignored" "$(write Write /repo/sub.md ',"agent_id":"a1"')" "/repo/README.md$nl/repo/docs/a.md"
doc_check "a Write in the scratchpad (/tmp) is a doc" "$(write Write /private/tmp/claude-1/scratchpad/report.md)" \
  "/private/tmp/claude-1/scratchpad/report.md$nl/repo/README.md$nl/repo/docs/a.md"
for i in 1 2 3 4 5 6 7 8 9; do
  printf '%s' "$(write Write "/repo/n$i.md")" | HC_TERMINAL_ID="$term" TMPDIR="$tmp" sh -c "$hook"
done
sleep 0.4
got=$(label office.docs)
# プロジェクトの .md は新しい順に 8 本。一時フォルダの .md は別に数えるので、押し出されない
projects=$(printf '%s\n' "$got" | grep -v '^/private/tmp/')
if [ "$(printf '%s\n' "$projects" | wc -l | tr -d ' ')" = 8 ] && [ "$(printf '%s\n' "$projects" | head -n 1)" = /repo/n9.md ] \
  && [ "$(printf '%s\n' "$projects" | tail -n 1)" = /repo/n2.md ] \
  && printf '%s\n' "$got" | grep -qx /private/tmp/claude-1/scratchpad/report.md; then
  echo "yes  nine new files keep the newest eight         docs=$(printf '%s' "$got" | tr '\n' ',')"
else
  echo "no   nine new files keep the newest eight         docs=$(printf '%s' "$got" | tr '\n' ',')"
  fails=$((fails + 1))
fi
doc_check "a new session starts a new list" "$(write Write /repo/fresh.md ',"session_id":"s2"')" /repo/fresh.md
# Claude Code のワークツリー（<リポジトリ>/.claude/worktrees/<名前>/）はプロジェクトなので入れる。その中の .claude/ は入れない
wt="$proj/.claude/worktrees/feat"
mkdir -p "$wt/notes"
doc_check "a .md in a Claude Code worktree is a doc" "$(write Write "$wt/docs/wt.md" ',"session_id":"s2"')" "$wt/docs/wt.md$nl/repo/fresh.md"
doc_check "a worktree's own .claude/ is not a doc" "$(write Write "$wt/.claude/agents/x.md" ',"session_id":"s2"')" \
  "$wt/docs/wt.md$nl/repo/fresh.md"
run_bash "Bash in a worktree -> docs" "$wt" "cat > notes/wt2.md <<'EOF'
# wt2
EOF" "$wt/notes/wt2.md$nl$wt/docs/wt.md$nl/repo/fresh.md" s2
doc_check "SessionEnd clears the docs" "$(event SessionEnd)" ""
plan_check "SessionEnd clears a plan made meanwhile" "$(pre Read)" ""

# Bash で書いた .md・プロジェクトに入れた .md（本物のファイルで）。エージェントは作業フォルダ（一時フォルダ）で書いてから、
# cp・mv・python でプロジェクトに入れることが多い
scratch="$tmp/scratchpad"
mkdir -p "$scratch/rr" "$proj/docs" "$proj/notes"
for f in report final moved old intodir pa pb; do printf '# %s\n' "$f" >"$scratch/$f.md"; done
cp "$scratch/final.md" "$scratch/rr/final.md"
touch -t 202001010000 "$scratch/moved.md" "$scratch/old.md" # mv と cp -p は、古い日時のまま入る
P=$proj S=$scratch
doc_check "a Write in the project is a doc" "$(write Write "$P/keep.md" ',"session_id":"s3"')" "$P/keep.md"
run_bash "Bash heredoc > .md -> docs" "$P" "cat > notes/report.md <<'EOF'
# Report
EOF" "$P/notes/report.md$nl$P/keep.md"
run_bash "cp -n from the scratchpad -> docs" "$P" "cp -n '$S/report.md' '$P/report.md' && cmp '$S/report.md' '$P/report.md'" \
  "$P/report.md$nl$P/notes/report.md$nl$P/keep.md"
run_bash "cd && cp to a relative path -> docs" "$repo" \
  "cd '$P' && [ -e cost.md ] && echo exists || { cp '$S/final.md' cost.md && cmp '$S/final.md' cost.md; }" \
  "$P/cost.md$nl$P/report.md$nl$P/notes/report.md$nl$P/keep.md"
run_bash "OUT=x.md; python3 writes \"\$OUT\" -> docs" "$P" "W='$S/rr'; OUT='$P/basic.md'; if [ -e \"\$OUT\" ]; then echo EXISTS; else python3 -I - \"\$W/final.md\" \"\$OUT\" <<'PY'
import sys
open(sys.argv[2], 'w').write(open(sys.argv[1]).read())
PY
fi" "$P/basic.md$nl$P/cost.md$nl$P/report.md$nl$P/notes/report.md$nl$P/keep.md"
run_bash "mv keeps the old time -> docs" "$P" "mv '$S/moved.md' '$P/moved.md'" \
  "$P/moved.md$nl$P/basic.md$nl$P/cost.md$nl$P/report.md$nl$P/notes/report.md$nl$P/keep.md"
run_bash "cp -p keeps the old time -> docs" "$P" "cp -p '$S/old.md' '$P/old.md'" \
  "$P/old.md$nl$P/moved.md$nl$P/basic.md$nl$P/cost.md$nl$P/report.md$nl$P/notes/report.md$nl$P/keep.md"
run_bash "mv into a folder -> docs" "$P" "mv '$S/intodir.md' docs/" \
  "$P/docs/intodir.md$nl$P/old.md$nl$P/moved.md$nl$P/basic.md$nl$P/cost.md$nl$P/report.md$nl$P/notes/report.md$nl$P/keep.md"
eight="$P/docs/intodir.md$nl$P/old.md$nl$P/moved.md$nl$P/basic.md$nl$P/cost.md$nl$P/report.md$nl$P/notes/report.md$nl$P/keep.md"
run_bash "reading .md in Bash is not writing" "$P" "grep -c x report.md notes/report.md '$P/keep.md'; wc -l *.md" "$eight"
# 変数の入った道（作業ファイルなど）は分からないので入れない。前はそのまま入り、ない道で一覧を埋めていた
for i in 1 2 3 4 5 6 7 8 9; do
  run_bash "\$W/x.md is not a doc ($i)" "$P" "W='$S/rr'; cat > \"\$W/req-$i.md\" <<'EOF'
req $i
EOF" "$eight"
done
# 作業フォルダの .md を 7 本書いても、プロジェクトの .md は押し出されない（一時フォルダの .md は別に 4 本まで）
for i in 1 2 3 4 5 6 7; do
  printf '%s' "$(write Write "$S/w$i.md" ',"session_id":"s3"')" | HC_TERMINAL_ID="$term" TMPDIR="$tmp" sh -c "$hook"
done
sleep 0.4
got=$(label office.docs)
if [ "$(printf '%s\n' "$got" | grep -c "^$P/")" = 8 ] && printf '%s\n' "$got" | grep -qx "$P/keep.md" \
  && [ "$(printf '%s\n' "$got" | grep -c "^$S/")" = 4 ] && [ "$(printf '%s\n' "$got" | head -n 1)" = "$S/w7.md" ]; then
  echo "yes  7 scratchpad docs keep the 8 project docs   docs=$(printf '%s' "$got" | sed "s#$proj#P#g; s#$tmp#T#g" | tr '\n' ',')"
else
  echo "no   7 scratchpad docs keep the 8 project docs   docs=$(printf '%s' "$got" | sed "s#$proj#P#g; s#$tmp#T#g" | tr '\n' ',')"
  fails=$((fails + 1))
fi
# 並んだコマンド: 2 つの Bash の PreToolUse が先に来て、あいだに別の Bash のフック（書いたかもしれない .md を確かめる）が
# 来ても、まだ書いていないほうを捨てずに、両方とも拾う
bash_pre() { pre Bash ',"session_id":"s3","cwd":"'"$P"'"' "$(jq -cn --arg c "$1" '{command: $c}')" | HC_TERMINAL_ID="$term" TMPDIR="$tmp" sh -c "$hook"; }
bash_pre "cp '$S/pa.md' '$P/pa.md'"
bash_pre "cp '$S/pb.md' '$P/pb.md'"
cp "$S/pa.md" "$P/pa.md"
bash_pre "git status"
cp "$S/pb.md" "$P/pb.md"
event Stop | jq -c '.session_id = "s3"' | HC_TERMINAL_ID="$term" TMPDIR="$tmp" sh -c "$hook"
sleep 0.4
got=$(label office.docs)
if printf '%s\n' "$got" | grep -qx "$P/pa.md" && printf '%s\n' "$got" | grep -qx "$P/pb.md"; then
  echo "yes  two Bash calls in flight are both caught     docs=$(printf '%s' "$got" | sed "s#$proj#P#g; s#$tmp#T#g" | tr '\n' ',')"
else
  echo "no   two Bash calls in flight are both caught     docs=$(printf '%s' "$got" | sed "s#$proj#P#g; s#$tmp#T#g" | tr '\n' ',')"
  fails=$((fails + 1))
fi
# 前の版のフックが入れた、変数の入った道（ない道）は、次に一覧が変わるときに消える
printf 's4\n%s\n%s\n%s\n' "$P/\$W/review-1.md" "$P/old4.md" "$P/\$S/x.md" >"$tmp/herdr-office-act-$term.docs"
doc_check "old \$W entries are dropped on update" "$(write Write "$P/new4.md" ',"session_id":"s4"')" "$P/new4.md$nl$P/old4.md"
doc_check "SessionEnd clears the docs (s4)" "$(event SessionEnd | jq -c '.session_id = "s4"')" ""
# ほかのエージェントが書いたものを、自分が書いたことにしない（同じフォルダに何人もいる）: 読むだけのコマンドに出てきた .md を、
# そのコマンドが始まってから一定の時間（ふだんは 60 秒。ここでは OFFICE_MD_WINDOW=2 で 2 秒）より後にほかの人が直しても、
# 次のフックで自分の書いた .md にはしない。その時間の中で書いたもの（少しかかるコマンド）は、今までどおり拾う
win() { OFFICE_MD_WINDOW=2 HC_TERMINAL_ID="$term" TMPDIR="$tmp" sh -c "$hook"; }
s5() { pre Bash ',"session_id":"s5","cwd":"'"$P"'"' "$(jq -cn --arg c "$1" '{command: $c}')"; }
printf '# shared\n' >"$P/shared.md"
s5 "grep -c x '$P/shared.md'" | win
sleep 3
printf 'edited by another agent\n' >>"$P/shared.md"
s5 "git status" | win
event Stop | jq -c '.session_id = "s5"' | win
sleep 0.4
got=$(label office.docs)
if printf '%s\n' "$got" | grep -qx "$P/shared.md"; then
  echo "no   another agent's later edit is not mine      docs=$(printf '%s' "$got" | sed "s#$proj#P#g" | tr '\n' ',')"
  fails=$((fails + 1))
else
  echo "yes  another agent's later edit is not mine      docs=$(printf '%s' "$got" | sed "s#$proj#P#g" | tr '\n' ',')"
fi
s5 "sleep 1; cp '$P/shared.md' '$P/slow.md'" | win
sleep 1
cp "$P/shared.md" "$P/slow.md"
event Stop | jq -c '.session_id = "s5"' | win
sleep 0.4
got=$(label office.docs)
if printf '%s\n' "$got" | grep -qx "$P/slow.md"; then ok=yes; else ok=no; fails=$((fails + 1)); fi
echo "$ok  a write within the window is still mine        docs=$(printf '%s' "$got" | sed "s#$proj#P#g" | tr '\n' ',')"
doc_check "SessionEnd clears the docs (s5)" "$(event SessionEnd | jq -c '.session_id = "s5"')" ""

# 会話の記録の道（office.transcript）: セッションが替わったときだけ書く（コマンドの文の中の同じ名前は拾わない）。
# SessionEnd で消え、次のセッションでまた書く
tr_check() { # tr_check <説明> <JSON> <期待する office.transcript>
  local name=$1 json=$2 want=$3 got ok
  printf '%s' "$json" | HC_TERMINAL_ID="$term" TMPDIR="$tmp" sh -c "$hook"
  sleep 0.4
  got=$(label office.transcript)
  if [ "$got" = "$want" ]; then ok=yes; else ok=no; fails=$((fails + 1)); fi
  printf '%-4s %-40s transcript=%s\n' "$ok" "$name" "'$got'"
}
tr_check "the session's record is labelled" "$(prompt 'hi')" /tmp/t.jsonl
hc label "$term" office.transcript=/kept >/dev/null
tr_check "the same record is not written again" "$(pre Read)" /kept
tr_check "a new session's record replaces it" \
  "$(pre Bash '' '{"command":"echo \"transcript_path\": \"/evil.jsonl\""}' | jq -c '.transcript_path = "/tmp/t2.jsonl"')" /tmp/t2.jsonl
tr_check "SessionEnd clears the record" "$(event SessionEnd)" ""
tr_check "the next session labels it again" "$(prompt 'again')" /tmp/t.jsonl

# Bash の .md の式（hooks/md-writes.jq）は、この PC のどの jq でも同じ答え（jq 1.6 には flags を渡す scan がなく、
# 前は式ごと読めずに Bash の .md を 1 つも拾えなかった。フックは PATH の最初の jq を使う）
md_case() { # md_case <コマンド> <期待する道（改行で区切る）>
  local cmd=$1 want=$2 j got ok
  for j in $(which -a jq | awk '!seen[$0]++'); do
    got=$(printf '%s' "$cmd" | "$j" -Rrs -f "$md_jq" --arg cwd /repo --arg home /u 2>&1)
    if [ "$got" = "$want" ]; then ok=yes; else ok=no; fails=$((fails + 1)); fi
    printf '%-4s %-40s %s\n' "$ok" "md-writes.jq with $("$j" --version 2>&1)" "'$(printf '%s' "$got" | tr '\n' ',')'"
  done
}
md_case "cat > docs/r.md <<'EOF' && echo x | tee -a /tmp/s.md" "$(printf '%s\n' /repo/docs/r.md /tmp/s.md)"
# cd の先からの相対の道・代入した値（OUT=）・フォルダへの mv。$W の入った道は出さない
md_case 'cd /p && cp "$W/a.md" b.md; OUT=/q/c.md python3 x.py "$OUT"; mv d.md docs/' \
  "$(printf '%s\n' /p/b.md /p/d.md /p/docs/d.md /q/c.md /repo/b.md /repo/d.md /repo/docs/d.md)"

echo "fails: $fails"
[ "$fails" -eq 0 ]
