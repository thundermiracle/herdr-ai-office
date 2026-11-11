#!/bin/bash
# リポジトリの mod とレイアウトを ~/.config/herdr-app にコピーし、mod ごとに herdr-app check する。
# herdr-app はコピー先の変更を見て読み直す。シンボリックリンクだと変更を検知できないことがあるのでコピーにしている。
# 使い方: scripts/sync.sh [mod の名前...]
#   省略時は mods/ の全部。spike/ の mod は名前を渡したときだけ（例: scripts/sync.sh ai-office-spike）。
# herdr-app が mod フォルダに書く gpui-kit.d.ts と jsconfig.json は、コピーでも消さない。
set -euo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd)
home=${HERDR_APP_HOME:-$HOME/.config/herdr-app}

if [ $# -gt 0 ]; then
  mods=("$@")
else
  mods=()
  for d in "$repo"/mods/*/; do mods+=("$(basename "$d")"); done
fi

for m in "${mods[@]}"; do
  src="$repo/mods/$m"
  [ -d "$src" ] || src="$repo/spike/$m"
  if [ ! -d "$src" ]; then
    echo "sync.sh: mods/$m も spike/$m もありません" >&2
    exit 1
  fi
  mkdir -p "$home/mods/$m"
  rsync -a --delete --exclude gpui-kit.d.ts --exclude jsconfig.json --exclude .DS_Store "$src/" "$home/mods/$m/"
  herdr-app check "$home/mods/$m"
done

if [ $# -eq 0 ]; then
  for f in "$repo"/layouts/*.json; do
    [ -e "$f" ] && cp "$f" "$home/layouts/"
  done
fi

# check は最初の描画までしか見ないので、動いている herdr-app のエラーも出す（起動していなければ何もしない）
if herdr-app status >/dev/null 2>&1; then
  herdr-app status | jq -c '.errors'
fi
