#!/bin/sh
# テスト用の偽エージェント。AI は使わず、herdr-core に状態（OSC 7501）を報告するだけ。
# 使い方: fake-agent.sh [working|read|blocked|ask|done|idle|cycle] [app]
#   read:  working と報告して、ターミナルに office.act=read のラベルを付ける（オフィスでは本棚へ行く）
#   ask:   blocked（質問）、blocked: blocked（許可待ち）
#   cycle: working → read → ask → done → idle を 8 秒ずつ繰り返す
#   app:   報告するエージェントの名前（オフィスの服の色: claude を含むと橙、codex を含むと青緑）
# 状態は前に出ているプログラムの報告だけが残るので、Ctrl-C まで前で待ち続ける。
mode=${1:-cycle}
app=${2:-fake}

report() { printf '\033]7501;state=%s:app=%s%s\033\\' "$1" "$app" "$2"; }
act() { [ -n "${HC_TERMINAL_ID:-}" ] && hc label "$HC_TERMINAL_ID" "office.act=$1" >/dev/null 2>&1; }

show() {
  case "$1" in
    working) act ""; report working ;;
    read) act read; report working ;;
    blocked) act ""; report blocked ":kind=permission" ;;
    ask) act ""; report blocked ":kind=question" ;;
    done) act ""; report done ;;
    idle) act ""; report idle ;;
    *) echo "fake-agent.sh: 知らない状態です: $1" >&2; exit 2 ;;
  esac
  printf '%s: %s\n' "$app" "$1"
}

trap 'act ""; report idle; exit 0' INT TERM
if [ "$mode" = cycle ]; then
  while :; do
    for s in working read ask done idle; do
      show "$s"
      sleep 8
    done
  done
fi
show "$mode"
while :; do sleep 60; done
