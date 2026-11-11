#!/bin/sh
# テスト用の偽エージェント。AI は使わず、herdr-core に状態（OSC 7501）を報告するだけ。
# 使い方: fake-agent.sh [working|read|skill:<名前>|blocked|ask|done|idle|cycle] [app]
#   read:  working と報告して、ターミナルに office.act=read のラベルを付ける（オフィスでは本棚へ行く）
#   skill:<名前>: read に加えて office.skill=<名前>（本棚でその skill の本を読み、名前の札が出る）
#   skills:<名前>: working（タイピング）のまま、20 秒ごとにその skill を使う（office.skill_at を変える。
#                  フックが本物の Skill ツールで書くのと同じ出来事で、資料室へ取りに行って読み、戻ってくる）
#   ask:   blocked（質問）、blocked: blocked（許可待ち）
#   cycle: working → skill:herdr → read → ask → done → idle を 8 秒ずつ繰り返す
#   app:   報告するエージェントの名前（オフィスの服の色: claude を含むと橙、codex を含むと青緑）
# 状態は前に出ているプログラムの報告だけが残るので、Ctrl-C まで前で待ち続ける。
mode=${1:-cycle}
app=${2:-fake}

report() { printf '\033]7501;state=%s:app=%s%s\033\\' "$1" "$app" "$2"; }
# office.act と office.skill（フック hooks/claude-office-act.sh と同じラベル）
labels() { [ -n "${HC_TERMINAL_ID:-}" ] && hc label "$HC_TERMINAL_ID" "office.act=$1" "office.skill=${2:-}" >/dev/null 2>&1; }

show() {
  case "$1" in
    working) labels ""; report working ;;
    read) labels read; report working ;;
    skill:*) labels read "${1#skill:}"; report working ;;
    skills:*) labels ""; report working ;;
    blocked) labels ""; report blocked ":kind=permission" ;;
    ask) labels ""; report blocked ":kind=question" ;;
    done) labels ""; report done ;;
    idle) labels ""; report idle ;;
    *) echo "fake-agent.sh: 知らない状態です: $1" >&2; exit 2 ;;
  esac
  printf '%s: %s\n' "$app" "$1"
}

trap 'labels ""; report idle; exit 0' INT TERM
if [ "$mode" = cycle ]; then
  while :; do
    for s in working skill:herdr read ask done idle; do
      show "$s"
      sleep 8
    done
  done
fi
show "$mode"
case "$mode" in
  skills:*)
    n=0
    while :; do
      n=$((n + 1))
      [ -n "${HC_TERMINAL_ID:-}" ] && hc label "$HC_TERMINAL_ID" "office.act=" "office.skill=${mode#skills:}" \
        "office.skill_at=$n" >/dev/null 2>&1
      sleep 20
    done
    ;;
esac
while :; do sleep 60; done
