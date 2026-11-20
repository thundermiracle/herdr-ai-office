#!/bin/bash
# この PC で、オフィスが動く用意がそろっているかを調べる（何も変えない。画面も動かさない）。
# ほかの PC で更新したあとにホワイトボードが出ないときなどに流して、NG の行を見る。
# 調べること: 道具（jq・hc・herdr-app と jq の版）、フックの登録（このリポジトリのフックを指しているか、4 つのイベント）と文法、
# Bash の .md の式（hooks/md-writes.jq）がこの jq で動くか、フックを試す（herdr-app に出ない使い捨てのターミナルで、Write は
# .md を書いたことにし、Bash は一時フォルダに本当に書いて（> x.md と cp）、ラベルが付くか）、mod がリポジトリと同じか、
# herdr-app のエラー、今ホワイトボードに載るもの
# （エージェントごとのラベル。読めないものと、ノイズ扱いで載らない .md には印）。
# 使い方: scripts/doctor.sh
set -uo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd)
app=${HERDR_APP_HOME:-$HOME/.config/herdr-app}
hook="$repo/hooks/claude-office-act.sh"
bad=0
ok() { printf '  ok   %s\n' "$*"; }
ng() { printf '  NG   %s\n' "$*"; bad=$((bad + 1)); }
note() { printf '       %s\n' "$*"; }

echo "道具"
for c in jq hc herdr-app; do
  if command -v "$c" >/dev/null 2>&1; then ok "$c: $(command -v "$c")"; else ng "$c がない（フックは jq と hc がないと何もしない）"; fi
done
command -v herdr-app >/dev/null 2>&1 && note "herdr-app $(herdr-app --version 2>/dev/null | head -n 1)"
command -v jq >/dev/null 2>&1 && note "$(jq --version 2>/dev/null)（フックは PATH の最初の jq を使う）"

echo "フックの登録（ホワイトボード・本棚・話しかけは、このフックが書くラベルで動く）"
if sh -n "$hook" 2>/dev/null; then ok "フックの文法（${hook}）"; else ng "フックに文法エラー（Claude のツールが止まる）: $hook"; fi
if [ ! -f "$repo/hooks/md-writes.jq" ]; then
  ng "hooks/md-writes.jq がない（Bash で書いた .md を拾えない）"
else
  # 式がこの jq で読めるか（前は jq 1.6 で式ごと読めず、Bash で書いた .md を 1 つも拾えなかった。フックは黙って続ける）。
  # 式は、コマンドに出てくる .md の道（書いたかもしれないもの）を出す
  got=$(printf '%s' "cat > docs/a.md <<'EOF'" | jq -Rrs -f "$repo/hooks/md-writes.jq" --arg cwd /p --arg home /h 2>&1)
  if [ "$got" = /p/docs/a.md ]; then ok "hooks/md-writes.jq がこの jq で動く（Bash で書いた .md を拾える）"
  else ng "hooks/md-writes.jq がこの jq（$(jq --version 2>/dev/null)）で動かない。Bash で書いた .md を拾えない: $(printf '%s' "$got" | head -n 1)"
  fi
fi
settings="$HOME/.claude/settings.json"
if [ ! -f "$settings" ]; then
  ng "$settings がない（Claude Code の設定）"
else
  registered=$(jq -r '.hooks // {} | to_entries[] | .key as $e | .value[] | .hooks[]?
    | select((.command // "") | test("claude-office-act\\.sh")) | "\($e)\t\(.command)"' "$settings" 2>/dev/null)
  if [ -z "$registered" ]; then
    ng "フックが登録されていない。このリポジトリで hooks/register.sh add し、そのあと Claude を起動し直す"
  else
    while IFS=$'\t' read -r event cmd; do
      if [ "$cmd" = "$hook" ]; then ok "$event: このリポジトリのフック"
      elif [ -f "$cmd" ]; then ng "$event: 別の場所のフックを指している（${cmd}）。hooks/register.sh remove してから、このリポジトリで add"
      else ng "$event: ないファイルを指している（${cmd}）。このリポジトリで hooks/register.sh add し直す"
      fi
    done <<<"$registered"
    for e in PreToolUse UserPromptSubmit Stop SessionEnd; do
      printf '%s\n' "$registered" | grep -q "^$e"$'\t' || ng "$e に登録されていない（hooks/register.sh add）"
    done
  fi
  note "Claude は起動したときのフックを使う。登録より前から動いている Claude は、起動し直すまでラベルを書かない"
fi

echo "フックを試す（herdr-app に出ない使い捨てのターミナルで。Write は .md を書いたことにし、Bash は一時フォルダに本当に書く）"
term=$(hc run --bg --json -- sleep 60 2>/dev/null | jq -r '.address // empty' 2>/dev/null)
if [ -z "$term" ]; then
  ng "hc run --bg で使い捨てのターミナルを作れない（herdr-core が動いているか）"
else
  tmp=$(mktemp -d)
  printf '%s' '{"session_id":"doctor","cwd":"/tmp","permission_mode":"default","hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"/doctor/check.md","content":"x"}}' \
    | HC_TERMINAL_ID="$term" TMPDIR="$tmp" sh -c "$hook" >/dev/null 2>&1
  sleep 0.6
  got=$(hc get "$term" --json 2>/dev/null | jq -r '.labels["office.docs"] // ""')
  if [ "$got" = /doctor/check.md ]; then ok "Write の .md で office.docs が付いた"; else ng "office.docs が付かない（付いたもの: '$got'）"; fi
  # Bash で書いた .md は、コマンドの前の状態を覚え、あとのフック（ここでは Stop）で変わっていたら付く。本物のファイルで試す
  # bash_md <コマンド> <書く道>: フックの PreToolUse → コマンドを流す → Stop のあと、office.docs の先頭
  bash_md() {
    printf '%s' "$(jq -cn --arg cwd "$tmp/proj" --arg c "$1" '{session_id: "doctor", cwd: $cwd, permission_mode: "default",
      hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: {command: $c}}')" | HC_TERMINAL_ID="$term" TMPDIR="$tmp" sh -c "$hook" >/dev/null 2>&1
    (cd "$tmp/proj" && sh -c "$1") >/dev/null 2>&1
    printf '%s' '{"session_id":"doctor","hook_event_name":"Stop"}' | HC_TERMINAL_ID="$term" TMPDIR="$tmp" sh -c "$hook" >/dev/null 2>&1
    sleep 0.6
    hc get "$term" --json 2>/dev/null | jq -r '.labels["office.docs"] // ""' | head -n 1
  }
  mkdir -p "$tmp/proj"
  got=$(bash_md "echo x > notes.md")
  if [ "$got" = "$tmp/proj/notes.md" ]; then ok "Bash の > x.md で office.docs が付いた"; else ng "Bash で書いた .md が office.docs に付かない（先頭: '$got'）"; fi
  got=$(bash_md "cp notes.md copied.md")
  if [ "$got" = "$tmp/proj/copied.md" ]; then ok "cp で入れた .md で office.docs が付いた"; else ng "cp で入れた .md が office.docs に付かない（先頭: '$got'）"; fi
  hc label "$term" "office.docs=$(printf 'a.md\nb.md')" >/dev/null 2>&1
  got=$(hc get "$term" --json 2>/dev/null | jq -r '.labels["office.docs"] // ""')
  if [ "$got" = "$(printf 'a.md\nb.md')" ]; then ok "改行の入ったラベルが使える"; else ng "改行の入ったラベルが使えない（herdr-core が古い？ 付いたもの: '$got'）"; fi
  hc kill "$term" >/dev/null 2>&1
  hc rm "$term" >/dev/null 2>&1
  rm -r "$tmp"
fi

echo "mod（scripts/sync.sh で $app/mods にコピーしたもの）"
for dir in "$repo"/mods/*/; do
  m=$(basename "$dir")
  if [ ! -d "$app/mods/$m" ]; then ng "$m がコピーされていない（scripts/sync.sh）"
  elif diff -rq -x gpui-kit.d.ts -x jsconfig.json -x .DS_Store "$dir" "$app/mods/$m" >/dev/null 2>&1; then ok "$m はリポジトリと同じ"
  else ng "$m がリポジトリと違う（scripts/sync.sh）"
  fi
done
for old in ai-office-plan ai-office-theme; do
  [ -d "$app/mods/$old" ] && note "使わなくなった $old が残っている（消してよい: rm -r \"$app/mods/$old\"）"
done
if herdr-app status >/dev/null 2>&1; then
  errors=$(herdr-app status | jq -c '.errors // []')
  if [ "$errors" = "[]" ]; then ok "herdr-app のエラーなし"; else ng "herdr-app のエラー: $errors"; fi
fi

echo "今ホワイトボードに載るもの（エージェントごとのラベル。プランと書いた .md。読めないものと、ノイズ扱いの .md は載らない）"
# ノイズ扱い（CLAUDE.md や node_modules/ の中など）は、オフィスと同じ scene.js の isNoiseDoc で調べる（node がなければ調べない）
noise() {
  command -v node >/dev/null 2>&1 || return 1
  node --input-type=module -e 'const { isNoiseDoc } = await import(process.argv[1]); process.exit(isNoiseDoc(process.argv[2]) ? 0 : 1)' \
    "$repo/mods/ai-office/scene.js" "$1" 2>/dev/null
}
command -v node >/dev/null 2>&1 || note "node がないので、ノイズ扱いかは調べない"
found=0
for t in $(hc ls --json 2>/dev/null | jq -r '.terminals[]?.address'); do
  line=""
  while IFS=$'\t' read -r kind f; do
    [ -n "$f" ] || continue
    if [ ! -r "$f" ]; then f="${f}（ない。載らない）"
    elif [ "$kind" = doc ] && noise "$f"; then f="${f}（ノイズ扱い。載らない）" # プランはノイズにしない
    fi
    line="${line:+$line, }$f"
  done < <(hc get "$t" --json 2>/dev/null \
    | jq -r '(.labels["office.plan"] // empty | "plan\t\(.)"), ((.labels["office.docs"] // "") | split("\n")[] | select(. != "") | "doc\t\(.)")')
  if [ -n "$line" ]; then
    note "${t}: $line"
    found=1
  fi
done
[ "$found" = 1 ] || note "どのターミナルにもない。ホワイトボードは、フックが効いている Claude が .md を書くと（プランモードのプランも）その部屋に出る"

echo "NG: $bad"
[ "$bad" -eq 0 ]
