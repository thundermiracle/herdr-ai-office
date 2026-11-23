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
#   office.transcript: 会話の記録（Claude Code の transcript_path。~/.claude/projects/<フォルダ>/<セッション>.jsonl）。AI Office の
#                会話のポップアップ（キャラのクリック）が、ここからやりとりを読む。セッションが替わったときだけ書き、終わったら消す
#   office.docs: このセッションで書いた .md（プラン以外。改行で区切り、新しい順。プロジェクトの .md は 8 本まで、一時フォルダの
#                .md は別に 4 本まで。作業フォルダの .md をいくら書いても、プロジェクトの .md は押し出されない）。ホワイトボードで読める。
#                Write / Edit / MultiEdit の .md と、Bash で書いた .md: コマンドに出てくる .md の道（hooks/md-writes.jq）の、
#                コマンドの前の状態（inode と ctime）を覚え、あとのフック（次の Bash・.md を書くツール・ターンの終わり）で変わって
#                いたら書いた .md にする（コマンドが始まってから 60 秒までに変わったものだけ。同じフォルダのほかのエージェントが
#                あとで直したものを、自分の書いた .md にしない）。
#                cp・mv・python などでプロジェクトに入れた .md も拾い、読むだけの .md は入らない。変数の入った道（"$W/x.md"）は
#                分からないので入れない。.claude/ の中（~/.claude/ のメモリや設定、プロジェクトの .claude/ の skill など）は入れない。
#                ただし Claude Code のワークツリー（<リポジトリ>/.claude/worktrees/<名前>/）はプロジェクトそのものなので入れる（その中の
#                .claude/ は入れない）。一時フォルダ（Claude Code の作業フォルダ /private/tmp/claude-…）の .md は入れる（頼んだ調査
#                メモや報告が置かれやすい）。セッションの終わりまで残す
# イベントごとに:
#   PreToolUse: Skill → read と、その skill。Read / Grep / Glob / LS / WebSearch / WebFetch / NotebookRead → read、
#               Edit / Write / MultiEdit / NotebookEdit → edit、Bash → run（コマンドに hc send があれば話しかけ）、
#               ほかのツール → act を消す（skill はそのまま）。
#               プランモードで書く .md（プランモードで書けるのはプランのファイルだけ）と、~/.claude/plans/ の .md を書く
#               Edit / Write / MultiEdit、ExitPlanMode の planFilePath → プラン。ほかの .md を書く Edit / Write / MultiEdit →
#               書いた .md の一覧の先頭に（一覧はセッションごとに $TMPDIR に覚え、変わったときだけ書く）。Bash → コマンドに
#               出てくる .md と、その今の状態を「書いたかもしれない .md」として覚える
#   Bash と .md を書くツールの前と、ターンの終わり（Stop・UserPromptSubmit・SessionEnd）: 覚えた「書いたかもしれない .md」の
#               状態が変わっていたら、書いた .md の一覧の先頭に。変わっていないものは、ターンの終わりか、コマンドが始まってから
#               60 秒まで待つ（並んで動いている Bash がまだ書いていないことがある）。読むだけのツールの前では確かめない（待たせないため）
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
cands= # Bash のコマンドに出てくる .md（書いたかもしれないもの。あとのフックで、変わっていたら書いた .md にする）
bash=  # Bash の前（書いたかもしれない .md を確かめる）
turn_end= # ターンの終わり（書いたかもしれない .md のうち、変わっていないものを捨てる）
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
                */.claude/worktrees/*/.claude/*) ;; # ワークツリーの中の .claude（skill や設定）
                */.claude/worktrees/*) doc=$file ;; # Claude Code のワークツリー（プロジェクトそのもの）
                */.claude/*) ;; # Claude のメモリや設定
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
        bash=1
        cmd=$(field .tool_input.command)
        case "$cmd" in *"hc send"*) talk=$(printf '%s' "$cmd" | jq -Rrs "$SEND_JQ" 2>/dev/null) ;; esac
        # コマンドに出てくる .md は、書いたかもしれないもの（式は hooks/md-writes.jq。読めなくても止まらない）
        case "$cmd" in
          *.[mM][dD]* | *.[mM][aA][rR][kK][dD][oO][wW][nN]*)
            cands=$(printf '%s' "$cmd" | jq -Rrs -f "$(dirname "$0")/md-writes.jq" --arg cwd "$(field .cwd)" --arg home "$HOME" 2>/dev/null)
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
    turn_end=1
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
    turn_end=1
    ;;
  SessionEnd)
    act=
    skill=
    turn_end=1
    ended=1
    ;;
  *) exit 0 ;;
esac

# 書いた .md の一覧（$memo.docs の 1 行目はセッション、そのあと新しい順）と、書いたかもしれない .md（$memo.pending の行:
# セッション<TAB>道<TAB>コマンドの前の状態（inode:ctime。なかったら -）<TAB>コマンドの始まり（秒））。並んで動くフック（並んだ
# ツール）があるので、読み書きはロック（mkdir）の中で。ロックを取れなければ（1 秒待っても）何もしない（書いたかもしれない .md は
# 次のフックで）。
# 同じフォルダにほかのエージェントもいるので、書いたとみなすのは、コマンドが始まってから $window 秒（ふだん 60 秒）までに
# 変わったものだけ（ctime で見る）。読むだけのコマンドに出てきた .md を、あとでほかの人が直しても、自分の書いた .md にしない。
# 変わらないまま $window 秒を過ぎたものは捨てる（そのあとで変わっても、もう書いたとはみなさないので）
docs_memo="$memo.docs"
pending="$memo.pending"
lock_dir="$memo.lock"
sep=$(printf '\001--\001') # awk に渡す区切りの行（道にはない）
window=${OFFICE_MD_WINDOW:-60}
docs=
# 道（引数）ごとに「状態<TAB>道」の行を出す。状態は inode:ctime（mv や cp -p は日時が古いまま入るが、inode か ctime が変わる）。
# ないファイルは出さない。macOS（BSD）と GNU の stat の両方で
stat_kind=
states() {
  [ $# -gt 0 ] || return 0
  if [ -z "$stat_kind" ]; then
    if stat -c %i / >/dev/null 2>&1; then stat_kind=gnu; else stat_kind=bsd; fi
  fi
  if [ "$stat_kind" = gnu ]; then stat -c "%i:%Z$tab%n" -- "$@" 2>/dev/null
  else stat -f "%i:%c$tab%N" -- "$@" 2>/dev/null
  fi
}
take_lock() {
  n=0
  until mkdir "$lock_dir" 2>/dev/null; do
    n=$((n + 1))
    if [ "$n" -ge 100 ]; then # 落ちたフックが残したロック（ふつうは数十ミリ秒で外れる）なら外して、もう一度だけ
      rmdir "$lock_dir" 2>/dev/null
      mkdir "$lock_dir" 2>/dev/null
      return
    fi
    sleep 0.01
  done
}
# 書いたかもしれない .md を確かめるのは、Bash と .md を書くツールの前と、ターンの終わりだけ（読むだけのツールが続くあいだは
# 待たせない。一覧に入るのが少し遅れるだけ）
if [ -n "$doc$cands$ended" ] || { [ -n "$bash$turn_end" ] && [ -s "$pending" ]; }; then
  if take_lock; then
    trap 'rmdir "$lock_dir" 2>/dev/null' EXIT
    # セッション（UUID）。jq を起こすより速いので sed で取る
    session=$(printf '%s' "$input" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
    [ -n "$session" ] || session=$(field .session_id)
    confirmed= # 書いたと分かった .md（新しい順）
    if [ -s "$pending" ]; then
      # 覚えた道の今の状態と比べる。変わった（今あって、前と違う）ものは書いた .md。変わっていないものはターンの終わりまで待つ。
      # ほかのセッションの行は捨てる
      set --
      while IFS="$tab" read -r s p _; do [ "$s" = "$session" ] && set -- "$@" "$p"; done <"$pending"
      keep=1
      [ -n "$turn_end" ] && keep=0
      # awk には「今の状態<TAB>道」の行、区切りの行、覚えた行の順に 1 本で渡す。書いたと分かった道を新しい順に出し、
      # まだ待つ行は $pending.new に。前の版の行（コマンドの始まりがない）は、始まりを 0 として捨てる
      : >"$pending.new"
      confirmed=$({ states "$@"; echo "$sep"; cat "$pending"; } \
        | awk -F "$tab" -v s="$session" -v keep="$keep" -v sep="$sep" -v out="$pending.new" \
            -v t="$(date +%s)" -v win="$window" '
          !past { if ($0 == sep) past = 1; else now[$2] = $1; next }
          $1 != s { next }
          ($2 in now) && now[$2] != $3 && substr(now[$2], index(now[$2], ":") + 1) + 0 <= $4 + win { hit[++n] = $2; next }
          keep == 1 && t - $4 <= win && !kept[$2 FS $3]++ { print > out }
          END { for (i = n; i > 0; i--) print hit[i] }')
      mv -f "$pending.new" "$pending"
    fi
    if [ -n "$cands" ] && [ -z "$turn_end" ]; then
      # このコマンドの .md の、今（コマンドの前）の状態を覚える
      set --
      while IFS= read -r p; do [ -n "$p" ] && set -- "$@" "$p"; done <<EOF
$cands
EOF
      { states "$@"; echo "$sep"; printf '%s\n' "$cands"; } | awk -F "$tab" -v s="$session" -v sep="$sep" -v t="$(date +%s)" '
        !past { if ($0 == sep) past = 1; else now[$2] = $1; next }
        NF { print s FS $0 FS (($0 in now) ? now[$0] : "-") FS t }' >>"$pending"
    fi
    if [ -n "$doc$confirmed" ]; then
      # 先頭に足して重なりを除き、プロジェクトの .md は 8 本、一時フォルダの .md は 4 本まで。前の版のフックが入れた、変数の
      # 入った道（ない道）は消す。前のセッションの一覧は捨てる（落ちて SessionEnd が来なかったとき）。変わったときだけ書く
      old=$(cat "$docs_memo" 2>/dev/null)
      [ "$(printf '%s\n' "$old" | sed -n 1p)" = "$session" ] || old=
      old_list=$(printf '%s\n' "$old" | sed 1d)
      new_list=$(printf '%s\n%s\n%s\n' "$doc" "$confirmed" "$old_list" | awk '
        NF && index($0, "$") == 0 && !seen[$0]++ {
          if ($0 ~ /^\/(private\/)?(tmp|var\/folders)\//) { if (t++ < 4) print } else if (p++ < 8) print
        }')
      if [ "$new_list" != "$old_list" ]; then
        printf '%s\n%s\n' "$session" "$new_list" >"$docs_memo"
        docs=$new_list
      fi
    fi
    [ -n "$ended" ] && rm -f "$docs_memo" "$pending"
    rmdir "$lock_dir" 2>/dev/null
    trap - EXIT
  fi
fi

# 会話の記録の道（書いた道を $TMPDIR に覚え、替わったときだけ書く）。最初に出てくる transcript_path（コマンドの文の中の
# 同じ名前を拾わないよう、行の終わりからではなく、はじめから探す）
tmemo="$memo.transcript"
new_transcript=
if [ -z "$ended" ]; then
  transcript=$(printf '%s' "$input" | grep -o '"transcript_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n 1 | sed 's/.*"\([^"]*\)"$/\1/')
  [ -n "$transcript" ] && [ "$transcript" != "$(cat "$tmemo" 2>/dev/null)" ] && new_transcript=$transcript
fi

next="$act|$skill"
if [ -z "$event$talk$heard$plan$docs$ended$new_transcript" ] && [ -f "$memo" ] && [ "$prev" = "$next" ]; then
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
if [ -n "$new_transcript" ]; then
  printf '%s' "$new_transcript" >"$tmemo"
  set -- "$@" "office.transcript=$new_transcript"
fi
[ -n "$ended" ] && { set -- "$@" "office.plan=" "office.docs=" "office.transcript="; rm -f "$tmemo"; }
hc label "$HC_TERMINAL_ID" "$@" </dev/null >/dev/null 2>&1 &
exit 0
