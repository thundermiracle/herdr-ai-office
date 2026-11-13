#!/usr/bin/env python3
# テスト用の偽の質問役（AI は使わない）。Claude Code の選択式の質問に似た画面を出し、herdr-core に
# 答え待ち（OSC 7501 の blocked、kind=question）を報告する。↑↓ で選んで Enter で答えると、
# 「→ 3. 調べる を選びました」と出して少し作業（working）し、また質問する。Esc で答えずに待機（idle）、Ctrl-C で終わる。
# --questions N（2〜3）: Claude Code の複数の質問のように N 問を続けて聞く。上の区切り線の下にタブ（☐ まだ・☒ 答えた・
# ✔ Submit）が並び、答えるたびに次の質問、最後に答えの確認（Review your answers … Ready to submit your answers? と
# 1. Submit answers / 2. Cancel）。Submit answers で「→ 答えを送りました: …」と出して作業する。そのあいだずっと答え待ち。
# 使い方: fake-question.py [app] [--questions N]（app は報告するエージェントの名前。オフィスの服の色に使う。ほかの引数は無視）
import os
import sys
import termios
import time
import tty

args = sys.argv[1:]
app = args[0] if args and not args[0].startswith("--questions") else "fake"
CLEAR = "\033[2J\033[H"
RULE = "─" * 48
# 見出し（タブ）・質問・選択肢（ラベルと説明）。1 問だけのときは最初の質問
QUESTIONS = [
    ("進め方", "次の作業はどれにしますか？", [
        ("テストを書く", "まず失敗するテストから"),
        ("実装する", "すぐにコードを書く"),
        ("調べる", "関連するコードを読む"),
        ("Type something.", ""),
    ]),
    ("言語", "どの言語で書きますか？", [
        ("TypeScript", "型を付けて書く"),
        ("Rust", ""),
        ("Python", "すぐに試せる"),
        ("Type something.", ""),
    ]),
    ("テスト", "テストはどこまで書きますか？", [
        ("単体テストだけ", ""),
        ("結合テストまで", "herdr を動かして確かめる"),
        ("書かない", ""),
        ("Type something.", ""),
    ]),
]


def questions():
    """--questions N（--questions=N も）。なければ 1。"""
    for i, a in enumerate(args):
        value = a.split("=", 1)[1] if a.startswith("--questions=") else args[i + 1] if a == "--questions" and i + 1 < len(args) else None
        if value is not None:
            return max(1, min(len(QUESTIONS), int(value)))
    return 1


def write(text):
    sys.stdout.write(text)
    sys.stdout.flush()


def report(state, extra=""):
    write(f"\033]7501;state={state}:app={app}{extra}\033\\")


def options_lines(options, cursor):
    lines = []
    for i, (label, desc) in enumerate(options, 1):
        lines.append(f"{'❯' if i == cursor else ' '} {i}. {label}")
        if desc:
            lines.append(f"     {desc}")
    return lines


def draw(cursor):
    """1 問だけのときの画面"""
    header, question, options = QUESTIONS[0]
    lines = [f" ☐ {header}", "", question, ""] + options_lines(options, cursor)
    lines += ["", "Enter to select · ↑/↓ to navigate · Esc to cancel"]
    write(CLEAR + "\r\n".join(lines))


def tabs(n, answers):
    chips = "  ".join(f"{'☒' if k in answers else '☐'} {QUESTIONS[k][0]}" for k in range(n))
    return f"←  {chips}  ✔ Submit  →"


def draw_step(n, i, cursor, answers):
    """続けて聞くときの i 問目（最後に区切り線と Chat about this）"""
    _, question, options = QUESTIONS[i]
    chat = len(options) + 1
    lines = [RULE, tabs(n, answers), "", question, ""] + options_lines(options, cursor)
    lines += [RULE, f"{'❯' if cursor == chat else ' '} {chat}. Chat about this", "",
              "Enter to select · Tab/Arrow keys to navigate · Esc to cancel"]
    write(CLEAR + "\r\n".join(lines))


def draw_review(n, cursor, answers):
    """答えの確認"""
    lines = [RULE, tabs(n, answers), "", "Review your answers", ""]
    for k in range(n):
        lines += [f" ● {QUESTIONS[k][1]}", f"   → {answers[k]}"]
    lines += ["", "Ready to submit your answers?", ""] + options_lines([("Submit answers", ""), ("Cancel", "")], cursor)
    write(CLEAR + "\r\n".join(lines))


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


def pick(fd, count, redraw):
    """↑↓ で 1..count を選んで Enter。返すもの: 選んだ番号、0（Esc）、-1（Ctrl-C）"""
    cursor = 1
    redraw(cursor)
    for key in keys(fd):
        if key == "up":
            cursor = max(1, cursor - 1)
        elif key == "down":
            cursor = min(count, cursor + 1)
        elif key == "enter":
            return cursor
        elif key == "esc":
            return 0
        elif key == "ctrl-c":
            return -1
        redraw(cursor)
    return -1


def ask_one(fd):
    """1 問。返すもの: 答えの文、None（答えずに閉じた）、"quit"（Ctrl-C）"""
    options = QUESTIONS[0][2]
    n = pick(fd, len(options), draw)
    if n < 0:
        return "quit"
    return f"{n}. {options[n - 1][0]} を選びました" if n else None


def ask_many(fd, count):
    """count 問を続けて聞いて、最後に確認する。返すものは ask_one と同じ"""
    answers = {}
    for i in range(count):
        options = QUESTIONS[i][2]
        n = pick(fd, len(options) + 1, lambda cursor: draw_step(count, i, cursor, answers))
        if n <= 0:
            return "quit" if n < 0 else None
        if n == len(options) + 1:
            return "Chat about this を選びました"
        answers[i] = options[n - 1][0]
    n = pick(fd, 2, lambda cursor: draw_review(count, cursor, answers))
    if n < 0:
        return "quit"
    return f"答えを送りました: {' / '.join(answers[k] for k in range(count))}" if n == 1 else None


def main():
    count = questions()
    fd = sys.stdin.fileno()
    saved = termios.tcgetattr(fd)
    tty.setraw(fd)
    try:
        while True:
            report("blocked", ":kind=question")
            answer = ask_one(fd) if count == 1 else ask_many(fd, count)
            if answer == "quit":
                return
            if answer is None:
                write(CLEAR + "（答えずに閉じました）\r\n")
                report("idle")
                time.sleep(10)
                continue
            write(f"{CLEAR}→ {answer}\r\n")
            report("working")
            time.sleep(8)
            report("idle")
            time.sleep(6)
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, saved)
        report("idle")


if __name__ == "__main__":
    main()
