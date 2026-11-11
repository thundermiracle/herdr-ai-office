#!/bin/sh
# Claude Code のフック: これから使うツールから「何をしているか」を、herdr-core のターミナルのラベル
# office.act に書く。AI Office（mods/ai-office）は read のとき、キャラクターを本棚へ行かせる。
#   PreToolUse: Read / Grep / Glob / LS / WebSearch / WebFetch / NotebookRead → read、
#               Edit / Write / MultiEdit / NotebookEdit → edit、Bash → run、ほかのツール → 消す
#   UserPromptSubmit / Stop / SessionEnd: 消す
# herdr-app のターミナルの中（HC_TERMINAL_ID がある）だけで動く。サブエージェント（agent_id がある）は無視する。
# PreToolUse はフックが終わるまでツールを待たせるので、hc は裏で走らせ、入出力をすべて閉じる
# （閉じないと、hc が終わるまでフックが終わらない）。何も出力しない（出力は Claude Code への返事になる）。
# 同じ値を続けて書かないよう、最後に書いた値を $TMPDIR に覚えておく。
[ -n "${HC_TERMINAL_ID:-}" ] || exit 0
command -v jq >/dev/null 2>&1 && command -v hc >/dev/null 2>&1 || exit 0

input=$(cat)
field() { printf '%s' "$input" | jq -r --arg k "$1" '.[$k] // empty' 2>/dev/null; }
[ -z "$(field agent_id)" ] || exit 0

case "$(field hook_event_name)" in
  PreToolUse)
    case "$(field tool_name)" in
      Read | Grep | Glob | LS | WebSearch | WebFetch | NotebookRead) act=read ;;
      Edit | Write | MultiEdit | NotebookEdit) act=edit ;;
      Bash) act=run ;;
      *) act= ;;
    esac
    ;;
  UserPromptSubmit | Stop | SessionEnd) act= ;;
  *) exit 0 ;;
esac

memo="${TMPDIR:-/tmp}/herdr-office-act-$(printf '%s' "$HC_TERMINAL_ID" | tr '/' '_')"
if [ -f "$memo" ] && [ "$(cat "$memo")" = "$act" ]; then
  exit 0
fi
printf '%s' "$act" >"$memo"
hc label "$HC_TERMINAL_ID" "office.act=$act" </dev/null >/dev/null 2>&1 &
exit 0
