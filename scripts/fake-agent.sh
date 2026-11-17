#!/bin/sh
# テスト用の偽エージェント。AI は使わず、herdr-core に状態（OSC 7501）を報告するだけ。
# 使い方: fake-agent.sh [working|read|skill:<名前>|skills:<名前>|talks:<タブ>[:<秒>]|plan:<ファイル>|docs:<ファイル>[,...]|
#                        blocked|ask|done|idle|cycle] [app]
#   read:  working と報告して、ターミナルに office.act=read のラベルを付ける（オフィスでは本棚へ行く）
#   skill:<名前>: read に加えて office.skill=<名前>（本棚でその skill の本を読み、名前の札が出る）
#   skills:<名前>: working（タイピング）のまま、20 秒ごとにその skill を使う（office.skill_at を変える。
#                  フックが本物の Skill ツールで書くのと同じ出来事で、資料室へ取りに行って読み、戻ってくる）
#   talks:<タブ>[:<秒>]: working（タイピング）のまま、<秒>（既定 8）たってから 30 秒ごとに、見本のスペース（office-test で
#                  始まる名前）の中のその名前のタブのエージェントへ（ほかのスペースの本物のエージェントには送らない）
#                  hc send で話しかける。フック（hooks/claude-office-act.sh）が書くのと同じラベル（office.talk・office.talk_at・
#                  office.talk_text）を先に書くので、オフィスでは相手のところへ行って話し、戻ってくる
#   plan:<ファイル>: working（タイピング）のまま、office.plan=<ファイル>（フックがプランモードのプランで書くのと同じラベル。
#                  オフィスでは部屋の壁にホワイトボードが掛かり、クリックでそのファイルをマークダウンで出す）
#   docs:<ファイル>[,<ファイル>...]: working（タイピング）のまま、office.docs=<ファイル>（改行で区切る。フックが Claude の
#                  書いた .md で書くのと同じラベル。オフィスではホワイトボードに、その人の書いた .md として並ぶ）
#   ask:   質問（選択肢の画面を出して、答えを受け取る。scripts/fake-question.py）、blocked: 許可待ち
#   cycle: working → skill:herdr → read → ask → done → idle を 8 秒ずつ繰り返す
#   app:   報告するエージェントの名前（オフィスの服の色: claude を含むと橙、codex を含むと青緑）
# 状態は前に出ているプログラムの報告だけが残るので、Ctrl-C まで前で待ち続ける。
mode=${1:-cycle}
app=${2:-fake}
shift 2 2>/dev/null || shift $#

# 質問役（ask）は、Claude の選択式に似た画面を出して ↑↓・Enter で答えを受け取る（scripts/fake-question.py）。
# 残りの引数（--model など）もそのまま渡す（オフィスは起動引数から model と effort を読む）
if [ "$mode" = ask ]; then
  exec python3 "$(dirname "$0")/fake-question.py" "$app" "$@"
fi

report() { printf '\033]7501;state=%s:app=%s%s\033\\' "$1" "$app" "$2"; }
# office.act と office.skill（フック hooks/claude-office-act.sh と同じラベル）
labels() { [ -n "${HC_TERMINAL_ID:-}" ] && hc label "$HC_TERMINAL_ID" "office.act=$1" "office.skill=${2:-}" >/dev/null 2>&1; }

show() {
  case "$1" in
    working) labels ""; report working ;;
    read) labels read; report working ;;
    skill:*) labels read "${1#skill:}"; report working ;;
    skills:* | talks:* | plan:* | docs:*) labels ""; report working ;;
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
  plan:*)
    [ -n "${HC_TERMINAL_ID:-}" ] && hc label "$HC_TERMINAL_ID" "office.plan=${mode#plan:}" >/dev/null 2>&1
    ;;
  docs:*)
    [ -n "${HC_TERMINAL_ID:-}" ] && hc label "$HC_TERMINAL_ID" "office.docs=$(printf '%s' "${mode#docs:}" | tr ',' '\n')" >/dev/null 2>&1
    ;;
  skills:*)
    n=0
    while :; do
      n=$((n + 1))
      [ -n "${HC_TERMINAL_ID:-}" ] && hc label "$HC_TERMINAL_ID" "office.act=" "office.skill=${mode#skills:}" \
        "office.skill_at=$n" >/dev/null 2>&1
      sleep 20
    done
    ;;
  talks:*)
    spec=${mode#talks:}
    tab=${spec%%:*}
    first=8
    [ "$spec" != "$tab" ] && first=${spec#*:}
    sleep "$first"
    n=0
    while :; do
      n=$((n + 1))
      case $((n % 4)) in
        1) text="レビューお願いします: src/x.rs" ;;
        2) text="テストが通りました" ;;
        3) text="この仕様で合っていますか？" ;;
        0) text="直したので見てください" ;;
      esac
      # 相手のアドレス（見本のスペースの中の、タブの名前から）
      to=$(herdr-app ls 2>/dev/null | jq -r --arg t "$tab" \
        '[.spaces[] | select(.name | startswith("office-test")) | .tabs[] | select(.name == $t) | .terminals[0].terminal] | first // empty')
      if [ -n "$to" ] && [ -n "${HC_TERMINAL_ID:-}" ]; then
        hc label "$HC_TERMINAL_ID" "office.talk=$to" "office.talk_at=$n-$$" "office.talk_text=$text" >/dev/null 2>&1
        hc send "$to" "$text" >/dev/null 2>&1 &
      fi
      sleep 30
    done
    ;;
esac
while :; do sleep 60; done
