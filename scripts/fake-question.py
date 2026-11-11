#!/usr/bin/env python3
# テスト用の偽の質問役（AI は使わない）。Claude Code の選択式の質問に似た画面を出し、herdr-core に
# 答え待ち（OSC 7501 の blocked、kind=question）を報告する。↑↓ で選んで Enter で答えると、
# 「→ 3. 調べる を選びました」と出して少し作業（working）し、また質問する。Esc で答えずに待機（idle）、Ctrl-C で終わる。
# 使い方: fake-question.py [app]（報告するエージェントの名前。オフィスの服の色に使う）
import os
import sys
import termios
import time
import tty

app = sys.argv[1] if len(sys.argv) > 1 else "fake"
HEADER = "進め方"
QUESTION = "次の作業はどれにしますか？"
OPTIONS = [
    ("テストを書く", "まず失敗するテストから"),
    ("実装する", "すぐにコードを書く"),
    ("調べる", "関連するコードを読む"),
    ("Type something.", ""),
]


def write(text):
    sys.stdout.write(text)
    sys.stdout.flush()


def report(state, extra=""):
    write(f"\033]7501;state={state}:app={app}{extra}\033\\")


def draw(cursor):
    lines = [f" ☐ {HEADER}", "", QUESTION, ""]
    for i, (label, desc) in enumerate(OPTIONS, 1):
        lines.append(f"{'❯' if i == cursor else ' '} {i}. {label}")
        if desc:
            lines.append(f"     {desc}")
    lines += ["", "Enter to select · ↑/↓ to navigate · Esc to cancel"]
    write("\033[2J\033[H" + "\r\n".join(lines))


def keys(fd):
    """届いたバイトを順に読み解いて、up / down / enter / esc / ctrl-c を返す（矢印は ESC [ と ESC O のどちらも）。"""
    buf = b""
    while True:
        if not buf:
            buf = os.read(fd, 64)
        if buf.startswith((b"\x1b[A", b"\x1bOA")):
            buf = buf[3:]
            yield "up"
        elif buf.startswith((b"\x1b[B", b"\x1bOB")):
            buf = buf[3:]
            yield "down"
        elif buf[:1] in (b"\r", b"\n"):
            buf = buf[1:]
            yield "enter"
        elif buf[:1] == b"\x03":
            yield "ctrl-c"
            return
        elif buf[:1] == b"\x1b" and len(buf) == 1:
            buf = b""
            yield "esc"
        else:
            buf = buf[1:]  # ほかのキーは無視する


def main():
    fd = sys.stdin.fileno()
    saved = termios.tcgetattr(fd)
    tty.setraw(fd)
    try:
        while True:
            cursor = 1
            report("blocked", ":kind=question")
            draw(cursor)
            for key in keys(fd):
                if key == "up":
                    cursor = max(1, cursor - 1)
                elif key == "down":
                    cursor = min(len(OPTIONS), cursor + 1)
                elif key == "enter":
                    break
                elif key == "esc":
                    cursor = 0
                    break
                elif key == "ctrl-c":
                    return
                draw(cursor)
            if cursor == 0:
                write("\033[2J\033[H（答えずに閉じました）\r\n")
                report("idle")
                time.sleep(10)
                continue
            write(f"\033[2J\033[H→ {cursor}. {OPTIONS[cursor - 1][0]} を選びました\r\n")
            report("working")
            time.sleep(8)
            report("idle")
            time.sleep(6)
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, saved)
        report("idle")


if __name__ == "__main__":
    main()
