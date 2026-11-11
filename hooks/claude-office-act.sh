#!/bin/sh
# Claude Code のフック: これから何をするかを、herdr-core のターミナルのラベルに書く。
#   office.act:   read（調べ物。AI Office ではキャラクターが本棚へ行く）/ edit / run / 空
#   office.skill: このターンで使った skill（本棚でその本を読み、頭の上に名前の札が出る）
# イベントごとに:
#   PreToolUse: Skill → read と、その skill。Read / Grep / Glob / LS / WebSearch / WebFetch / NotebookRead → read、
#               Edit / Write / MultiEdit / NotebookEdit → edit、Bash → run、ほかのツール → act を消す（skill はそのまま）
#   UserPromptSubmit: /名前 で始まる依頼は、その skill を読む（read と skill）。ほかの依頼は両方消す
#   Stop / SessionEnd: 両方消す
# herdr-app のターミナルの中（HC_TERMINAL_ID がある）だけで動く。サブエージェント（agent_id がある）は無視する。
# PreToolUse はフックが終わるまでツールを待たせるので、hc は裏で走らせ、入出力をすべて閉じる
# （閉じないと、hc が終わるまでフックが終わらない）。何も出力しない（出力は Claude Code への返事になる）。
# 同じ値を続けて書かないよう、最後に書いた値（act|skill）を $TMPDIR に覚えておく。
[ -n "${HC_TERMINAL_ID:-}" ] || exit 0
command -v jq >/dev/null 2>&1 && command -v hc >/dev/null 2>&1 || exit 0

input=$(cat)
field() { printf '%s' "$input" | jq -r "$1 // empty" 2>/dev/null; }
[ -z "$(field .agent_id)" ] || exit 0

memo="${TMPDIR:-/tmp}/herdr-office-act-$(printf '%s' "$HC_TERMINAL_ID" | tr '/' '_')"
prev=$(cat "$memo" 2>/dev/null)
case "$prev" in
  *"|"*) skill=${prev#*|} ;; # ほかのツールでは、使っている skill はそのまま
  *) skill= ;;               # 前の版のメモ（act だけ）
esac

case "$(field .hook_event_name)" in
  PreToolUse)
    case "$(field .tool_name)" in
      Skill)
        act=read
        skill=$(field .tool_input.skill)
        ;;
      Read | Grep | Glob | LS | WebSearch | WebFetch | NotebookRead) act=read ;;
      Edit | Write | MultiEdit | NotebookEdit) act=edit ;;
      Bash) act=run ;;
      *) act= ;;
    esac
    ;;
  UserPromptSubmit)
    skill=$(field .prompt | sed -n '1s#^/\([A-Za-z0-9:_.-][A-Za-z0-9:_.-]*\).*#\1#p')
    act=
    [ -n "$skill" ] && act=read
    ;;
  Stop | SessionEnd)
    act=
    skill=
    ;;
  *) exit 0 ;;
esac

next="$act|$skill"
if [ -f "$memo" ] && [ "$prev" = "$next" ]; then
  exit 0
fi
printf '%s' "$next" >"$memo"
hc label "$HC_TERMINAL_ID" "office.act=$act" "office.skill=$skill" </dev/null >/dev/null 2>&1 &
exit 0
