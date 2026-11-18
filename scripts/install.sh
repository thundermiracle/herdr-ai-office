#!/bin/bash
# AI Office を入れる・更新する（これ 1 つで）: mod とレイアウトを ~/.config/herdr-app にコピー（scripts/sync.sh）、
# Claude Code のフックを登録（hooks/register.sh add。もう登録してあれば何もしない）、用意がそろっているか調べる（scripts/doctor.sh）。
# 更新は git pull のあとに、もう一度これを流す。フックを新しく登録したときは、動いている Claude を起動し直す（起動したときの
# フックを使うので）。レイアウトは切り替えない（画面が動くので。切り替え方は README の「別の PC で試す」）。
# 使い方: scripts/install.sh [--no-hook]（--no-hook: フックを登録しない。ホワイトボード・資料室・話しかけは動かない）
set -euo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd)
hook=yes
for a in "$@"; do
  case "$a" in
    --no-hook) hook=no ;;
    -h | --help) sed -n '2,6p' "$0"; exit 0 ;;
    *) echo "install.sh: 知らない引数です: ${a}（--no-hook だけ）" >&2; exit 2 ;;
  esac
done

echo "== mod をコピー（scripts/sync.sh）"
mods=()
for d in "$repo"/mods/*/; do mods+=("$(basename "$d")"); done
"$repo/scripts/sync.sh" "${mods[@]}"

# レイアウトは、ないか中身が違うときだけコピーする（同じ中身で上書きして、Herdr に読み直させない。Office の列の開け閉めは
# layouts/.state/ に覚えられているので、コピーしても消えない）
echo "== レイアウト"
app=${HERDR_APP_HOME:-$HOME/.config/herdr-app}
mkdir -p "$app/layouts"
for f in "$repo"/layouts/*.json; do
  name=$(basename "$f")
  if cmp -s "$f" "$app/layouts/$name"; then
    echo "同じ: $name"
  else
    cp "$f" "$app/layouts/"
    echo "コピーした: $name"
  fi
done

if [ "$hook" = yes ]; then
  echo "== Claude Code のフックを登録（hooks/register.sh add）"
  before=$("$repo/hooks/register.sh" status 2>/dev/null || true)
  "$repo/hooks/register.sh" add
  after=$("$repo/hooks/register.sh" status 2>/dev/null || true)
  if [ "$before" != "$after" ]; then
    echo "フックを新しく登録しました。動いている Claude は、起動し直すと効きます（終了して起動するか、claude --resume）"
  fi
else
  echo "== フックは登録しない（--no-hook）。ホワイトボード・資料室・話しかけは動かない"
fi

echo "== 用意がそろっているか調べる（scripts/doctor.sh）"
"$repo/scripts/doctor.sh"
