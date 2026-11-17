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
#   office.plan: プランのファイル（Claude Code のプランモードで書く ~/.claude/plans/<名前>.md。設定 plansDirectory なら
#                そこ）。AI Office は、その部屋の壁にホワイトボードを掛け、クリックで中身を出す。セッションの終わりまで残す
#   office.docs: このセッションで書いた .md（プラン以外。新しい順に 8 本まで、改行で区切る）。ホワイトボードで読める。
#                Write / Edit / MultiEdit と、Bash の `> x.md`・`>> x.md`・`tee x.md`（hooks/md-writes.jq で読む）。
#                ~/.claude/ の中（メモリや設定）と一時フォルダ（/tmp・/var/folders）は入れない。セッションの終わりまで残す
# イベントごとに:
#   PreToolUse: Skill → read と、その skill。Read / Grep / Glob / LS / WebSearch / WebFetch / NotebookRead → read、
#               Edit / Write / MultiEdit / NotebookEdit → edit、Bash → run（コマンドに hc send があれば話しかけ）、
#               ほかのツール → act を消す（skill はそのまま）。
#               プランモードで書く .md（プランモードで書けるのはプランのファイルだけ）と、~/.claude/plans/ の .md を書く
#               Edit / Write / MultiEdit、ExitPlanMode の planFilePath → プラン。ほかの .md を書く Edit / Write / MultiEdit →
#               書いた .md の一覧の先頭に（一覧はセッションごとに $TMPDIR に覚え、変わったときだけ書く）
#   UserPromptSubmit: hc から届いた `<hc from="t3 名前">文</hc>` は話しかけられた出来事。/名前 で始まる依頼は、
#               その skill を読む（read と skill）。ほかの依頼は act と skill を消す
#   Stop: act と skill を消す。SessionEnd（終了・/clear）: act と skill とプランと書いた .md の一覧を消す
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
plan=  # プランのファイル（office.plan）
doc=   # 書いた .md（office.docs の一覧の先頭に足す）
ended= # セッションが終わった（プランと書いた .md も消す）
case "$(field .hook_event_name)" in
  PreToolUse)
    case "$(field .tool_name)" in
      Skill)
        act=read
        skill=$(field .tool_input.skill)
        event="$(date +%s)-$$"
        ;;
      Read | Grep | Glob | LS | WebSearch | WebFetch | NotebookRead) act=read ;;
      Edit | Write | MultiEdit | NotebookEdit)
        act=edit
        file=$(field .tool_input.file_path)
        case "$file" in
          *.md | *.markdown)
            if [ "$(field .permission_mode)" = plan ]; then
              plan=$file
            else
              case "$file" in
                */.claude/plans/*) plan=$file ;;
                */.claude/*) ;; # Claude のメモリや設定
                /tmp/* | /private/tmp/* | /var/folders/* | /private/var/folders/*) ;; # 一時フォルダの作業メモ
                *) doc=$file ;;
              esac
            fi
            ;;
        esac
        ;;
      ExitPlanMode)
        act=
        plan=$(field .tool_input.planFilePath)
        ;;
      Bash)
        act=run
        cmd=$(field .tool_input.command)
        case "$cmd" in *"hc send"*) talk=$(printf '%s' "$cmd" | jq -Rrs "$SEND_JQ" 2>/dev/null) ;; esac
        # .md へ書き込む Bash（> x.md・>> x.md・tee x.md）は、書いた .md（式は hooks/md-writes.jq。読めなくても止まらない）
        case "$cmd" in
          *.md* | *.markdown* | *.MD*)
            doc=$(printf '%s' "$cmd" | jq -Rrs -f "$(dirname "$0")/md-writes.jq" --arg cwd "$(field .cwd)" --arg home "$HOME" 2>/dev/null)
            ;;
        esac
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
  Stop)
    act=
    skill=
    ;;
  SessionEnd)
    act=
    skill=
    ended=1
    ;;
  *) exit 0 ;;
esac

# 書いた .md の一覧（$memo.docs の 1 行目はセッション、そのあと新しい順）。前のセッションの一覧は捨てる
# （落ちて SessionEnd が来なかったとき）。先頭に足して（Bash なら何本も）重なりを除き、8 本まで。変わったときだけ office.docs に書く
docs_memo="$memo.docs"
docs=
if [ -n "$doc" ]; then
  session=$(field .session_id)
  old=$(cat "$docs_memo" 2>/dev/null)
  [ "$(printf '%s\n' "$old" | sed -n 1p)" = "$session" ] || old=
  old_list=$(printf '%s\n' "$old" | sed 1d)
  new_list=$(printf '%s\n%s\n' "$doc" "$old_list" | awk 'NF && !seen[$0]++' | head -n 8)
  if [ "$new_list" != "$old_list" ]; then
    printf '%s\n%s\n' "$session" "$new_list" >"$docs_memo"
    docs=$new_list
  fi
fi
[ -n "$ended" ] && rm -f "$docs_memo"

next="$act|$skill"
if [ -z "$event$talk$heard$plan$docs$ended" ] && [ -f "$memo" ] && [ "$prev" = "$next" ]; then
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
[ -n "$plan" ] && set -- "$@" "office.plan=$plan"
[ -n "$docs" ] && set -- "$@" "office.docs=$docs"
[ -n "$ended" ] && set -- "$@" "office.plan=" "office.docs="
hc label "$HC_TERMINAL_ID" "$@" </dev/null >/dev/null 2>&1 &
exit 0
