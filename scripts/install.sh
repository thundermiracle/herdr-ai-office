#!/bin/bash
# AI Office を入れる・更新する（これ 1 つで）: mod とレイアウトを ~/.config/herdr-app にコピー（scripts/sync.sh）、
# Claude Code のフックを登録（コピーした mods/ai-office/hook/register.sh add。前の場所の登録は付け替える）、
# herdr の keys.json にオフィスのキー（⌘. と ⌘⇧.）を足す（scripts/keys.sh add）、用意がそろっているか調べる（scripts/doctor.sh）。
# 更新は git pull のあとに、もう一度これを流す。フックを新しく登録したときは、動いている Claude を起動し直す（起動したときの
# フックを使うので）。レイアウトは切り替えない（画面が動くので。切り替え方は README の「入れる」）。
# 使い方: scripts/install.sh [--no-hook] [--no-keys]（--no-hook: フックを登録しない。ホワイトボード・資料室・話しかけは動かない。
#   --no-keys: keys.json を書き換えない。⌘. と ⌘⇧. は効かない）
set -euo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd)
app=${HERDR_APP_HOME:-$HOME/.config/herdr-app}
hook=yes
keys=yes
for a in "$@"; do
  case "$a" in
    --no-hook) hook=no ;;
    --no-keys) keys=no ;;
    -h | --help) sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "install.sh: 知らない引数です: ${a}（--no-hook と --no-keys だけ）" >&2; exit 2 ;;
  esac
done

echo "== mod をコピー（scripts/sync.sh）"
mods=()
for d in "$repo"/mods/*/; do mods+=("$(basename "$d")"); done
"$repo/scripts/sync.sh" "${mods[@]}"

# レイアウトは、ないか中身が違うときだけコピーする（同じ中身で上書きして、Herdr に読み直させない。Office の列の開け閉めは
# layouts/.state/ に覚えられているので、コピーしても消えない）
echo "== レイアウト"
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
  # 登録するのはコピーした mod の中のフック（リポジトリを動かしても消しても効く）
  echo "== Claude Code のフックを登録（mods/ai-office/hook/register.sh add）"
  reg="$app/mods/ai-office/hook/register.sh"
  before=$(bash "$reg" status 2>/dev/null || true)
  bash "$reg" add
  after=$(bash "$reg" status 2>/dev/null || true)
  if [ "$before" != "$after" ]; then
    echo "フックを新しく登録しました。動いている Claude は、起動し直すと効きます（終了して起動するか、claude --resume）"
  fi
else
  echo "== フックは登録しない（--no-hook）。ホワイトボード・資料室・話しかけは動かない"
fi

# keys.json はパソコンごとなので、ここで足さないと、ほかのパソコンでは ⌘. と ⌘⇧. が効かない
if [ "$keys" = yes ]; then
  echo "== キー（scripts/keys.sh add: ⌘. で重ねたターミナルを閉じる・⌘⇧. で最後に開いた人をもう一度開く）"
  "$repo/scripts/keys.sh" add || echo "キーは足せなかった（上のエラー）。scripts/keys.sh status で見る"
else
  echo "== キーは足さない（--no-keys）。⌘. と ⌘⇧. は効かない（重ねたターミナルを閉じるのは ✕）"
fi

echo "== 用意がそろっているか調べる（scripts/doctor.sh）"
"$repo/scripts/doctor.sh"
