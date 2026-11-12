#!/bin/sh
# Claude Code のフック: これから何をするかを、herdr-core のターミナルのラベルに書く。
#   office.act:   read（調べ物。AI Office ではキャラクターが本棚へ行く）/ edit / run / 空
#   office.skill: このターンで使った skill（本棚でその本を読み、頭の上に名前の札が出る）
#   office.skill_at: skill を使うたびに変わる値（秒-プロセス番号）。AI Office はこれが変わった出来事で、
#                    キャラクターを資料室へ取りに行かせる（エージェントがすぐ次のツールに移っても、読んで戻ってくる）
#   office.talk / office.talk_at / office.talk_text: hc send でほかのエージェントに話しかけた（相手・出来事の値・文の始め）。
#                    AI Office は、話しかけた人を相手のところへ行かせて話させる
#   office.heard / office.heard_at / office.heard_text: hc send で話しかけられた（送った人のアドレス・出来事の値・文の始め）。
#                    送った人にフックがない（Codex など）ときも、AI Office は送った人を行かせる
# イベントごとに:
#   PreToolUse: Skill → read と、その skill。Read / Grep / Glob / LS / WebSearch / WebFetch / NotebookRead → read、
#               Edit / Write / MultiEdit / NotebookEdit → edit、Bash → run（コマンドに hc send があれば話しかけ）、
#               ほかのツール → act を消す（skill はそのまま）
#   UserPromptSubmit: hc から届いた `<hc from="t3 名前">文</hc>` は話しかけられた出来事。/名前 で始まる依頼は、
#               その skill を読む（read と skill）。ほかの依頼は act と skill を消す
#   Stop / SessionEnd: act と skill を消す
# herdr-app のターミナルの中（HC_TERMINAL_ID がある）だけで動く。サブエージェント（agent_id がある）は無視する。
# PreToolUse はフックが終わるまでツールを待たせるので、hc は裏で走らせ、入出力をすべて閉じる
# （閉じないと、hc が終わるまでフックが終わらない）。何も出力しない（出力は Claude Code への返事になる）。
# 同じ値を続けて書かないよう、最後に書いた値（act|skill）を $TMPDIR に覚えておく。
[ -n "${HC_TERMINAL_ID:-}" ] || exit 0
command -v jq >/dev/null 2>&1 && command -v hc >/dev/null 2>&1 || exit 0

input=$(cat)
field() { printf '%s' "$input" | jq -r "$1 // empty" 2>/dev/null; }
[ -z "$(field .agent_id)" ] || exit 0

# Bash のコマンドの最初の `hc send [オプション] <相手> <文>` から「相手<TAB>文の始め（40 文字）」。
# 文は引用符の中（"$(cat <<EOF" ならその次の行）。相手が $変数 だと分からないので、何も出さない
SEND_JQ='
def clean: gsub("\\s+"; " ") | sub("^ "; "") | .[0:40];
def body:
  if startswith("\"") then .[1:] | capture("^(?<t>(?:[^\"\\\\]|\\\\.)*)").t | gsub("\\\\(?<c>.)"; "\(.c)")
  elif startswith("\u0027") then .[1:] | split("\u0027")[0]
  else split("\n")[0] | split(";")[0] | split("&&")[0] | split("|")[0]
  end;
(capture("(?:^|[\\s;&|(])hc\\s+send\\s+(?:(?:--(?:if|timeout)(?:\\s+|=)\\S+|--[a-z-]+)\\s+)*(?<to>[^\\s;&|]+)\\s*(?<rest>.*)"; "p") // empty)
| (.to | gsub("^[\"\u0027]|[\"\u0027]$"; "")) as $to
| select($to != "" and ($to | startswith("$") | not))
| (.rest | body) as $b
| (if ($b | test("^\\$\\(cat\\s*<<")) then (.rest | split("\n")[1] // "") else $b end) as $text
| "\($to)\t\($text | clean)"'
# hc から届いた話しかけ（依頼の先頭が `<hc from="t3 名前" ...>文`）から「送った人のアドレス<TAB>文の始め」
HEARD_JQ='(capture("^\\s*<hc\\s+from=\"(?<from>[^\"\\s]+)[^\"]*\"[^>]*>(?<text>[^\\n<]*)") // empty)
| "\(.from)\t\(.text | gsub("\\s+"; " ") | sub("^ "; "") | .[0:40])"'
tab=$(printf '\t')

memo="${TMPDIR:-/tmp}/herdr-office-act-$(printf '%s' "$HC_TERMINAL_ID" | tr '/' '_')"
prev=$(cat "$memo" 2>/dev/null)
case "$prev" in
  *"|"*) skill=${prev#*|} ;; # ほかのツールでは、使っている skill はそのまま
  *) skill= ;;               # 前の版のメモ（act だけ）
esac

event= # skill を使った出来事なら、その値（office.skill_at）
talk=  # 話しかけた（相手<TAB>文）
heard= # 話しかけられた（送った人<TAB>文）
case "$(field .hook_event_name)" in
  PreToolUse)
    case "$(field .tool_name)" in
      Skill)
        act=read
        skill=$(field .tool_input.skill)
        event="$(date +%s)-$$"
        ;;
      Read | Grep | Glob | LS | WebSearch | WebFetch | NotebookRead) act=read ;;
      Edit | Write | MultiEdit | NotebookEdit) act=edit ;;
      Bash)
        act=run
        cmd=$(field .tool_input.command)
        case "$cmd" in *"hc send"*) talk=$(printf '%s' "$cmd" | jq -Rrs "$SEND_JQ" 2>/dev/null) ;; esac
        ;;
      *) act= ;;
    esac
    ;;
  UserPromptSubmit)
    prompt=$(field .prompt)
    act=
    skill=
    case "$prompt" in
      /*)
        skill=$(printf '%s' "$prompt" | sed -n '1s#^/\([A-Za-z0-9:_.-][A-Za-z0-9:_.-]*\).*#\1#p')
        if [ -n "$skill" ]; then
          act=read
          event="$(date +%s)-$$"
        fi
        ;;
      *"<hc from="*) heard=$(printf '%s' "$prompt" | jq -Rrs "$HEARD_JQ" 2>/dev/null) ;;
    esac
    ;;
  Stop | SessionEnd)
    act=
    skill=
    ;;
  *) exit 0 ;;
esac

next="$act|$skill"
if [ -z "$event$talk$heard" ] && [ -f "$memo" ] && [ "$prev" = "$next" ]; then
  exit 0 # 同じ値で、出来事でもない
fi
printf '%s' "$next" >"$memo"
set -- "office.act=$act" "office.skill=$skill"
[ -n "$event" ] && set -- "$@" "office.skill_at=$event"
if [ -n "$talk" ]; then
  set -- "$@" "office.talk=${talk%%"$tab"*}" "office.talk_at=$(date +%s)-$$" "office.talk_text=${talk#*"$tab"}"
fi
if [ -n "$heard" ]; then
  set -- "$@" "office.heard=${heard%%"$tab"*}" "office.heard_at=$(date +%s)-$$" "office.heard_text=${heard#*"$tab"}"
fi
hc label "$HC_TERMINAL_ID" "$@" </dev/null >/dev/null 2>&1 &
exit 0
