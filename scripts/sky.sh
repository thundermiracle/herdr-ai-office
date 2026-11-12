#!/bin/bash
# 窓の外を試す（herdr-app do ai-office.sky-<なに> を送る。オフィスが見えているときだけ届く）:
#   sky.sh rain            天気: clear / cloudy / overcast / fog / rain / snow / thunder
#   sky.sh 19:30           東京の時刻（HH:MM）。または時間帯: night / twilight / dawn / day / dusk
#   sky.sh snow night      天気と時刻の両方
#   sky.sh lapse [天気]    東京の 1 日を 30 秒ほどで早送りして、最後に本物に戻す
#   sky.sh auto            本物（今の東京の時刻と天気）に戻す
set -euo pipefail

# 届かなければ（オフィスが閉じていると herdr-app は unknown command を返す）、開き方を言って止まる
send() {
  local out
  if ! out=$(herdr-app do "ai-office.sky-$1" 2>&1); then
    case "$out" in
      *"need the mod loaded"*) echo "オフィスが見えていないので届きません。右上の「Office」ボタン（herdr-app do layout.toggle --id office）で開いてから" >&2 ;;
      *) echo "$out" >&2 ;;
    esac
    exit 1
  fi
}

case "${1:-}" in
  "" | -h | --help) sed -n '2,7p' "$0" ;;
  lapse)
    trap 'send auto' EXIT
    [ -n "${2:-}" ] && send "$2"
    for ((m = 0; m < 1440; m += 20)); do
      send "$(printf '%02d%02d' $((m / 60)) $((m % 60)))"
      sleep 0.4
    done
    ;;
  *) for word in "$@"; do send "${word//:/}"; done ;;
esac
