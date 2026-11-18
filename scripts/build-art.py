# ドット絵を作る: uv run --with pillow scripts/build-art.py
# 絵は文字の格子で描き、外側の輪郭は自動で付ける。書き出すときに 4 倍に拡大する
# （mod では絵の 1 ピクセル = 2 論理 px で描くので、Retina では物理 1:1 になり、にじまない）。
# 出力: mods/ai-office/img/（mod が使う PNG）、mods/ai-office/themes/modern/ と classic/（テーマの絵）、
#       tmp/art-preview.png（確認用の一覧と部屋の見本）
import random
from pathlib import Path
from PIL import Image

SCALE = 4
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "mods" / "ai-office" / "img"
THEMES = ROOT / "mods" / "ai-office" / "themes"  # テーマごとの絵（themes/<名前>/。theme.json の images が指す）
PREVIEW = ROOT / "tmp" / "art-preview.png"


def rgb(s):
    s = s.lstrip("#")
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4)) + (255,)


# 全員に共通の色。h/H/j（髪）と c/C（服）は見た目（LOOKS）ごとに、d/f（鉢巻き）は色ごとに差し替える
BASE = {
    "o": "#3b2a2a",  # 輪郭
    "e": "#3b2a2a",  # 目
    "l": "#3b2a2a",  # 眼鏡のふち
    "s": "#ffdbb8",  # 肌
    "S": "#f0b890",  # 肌の影
    "r": "#ff9c90",  # ほっぺ
    "m": "#c8564c",  # 口
    "w": "#ffffff",
    "p": "#4b5878",  # ズボン
    "P": "#38425c",
    "b": "#5b3a2c",  # 靴
    "k": "#c0504a",  # 本の表紙
    "K": "#8f3530",
    "y": "#f3d36b",  # 本の帯、星のピン
    "i": "#34407a",  # ネクタイ
    "I": "#232c58",
    "E": "#4a4f5c",  # ヘッドホン
    "M": "#6fd6cf",  # ヘッドホンの光
}
# 見た目: 服は AI の種類ごと、髪の色と小物は model ごと（scene.js の lookOf と合わせる）
CLAUDE = ("#e8804e", "#bf5f37")  # Claude Code のオレンジ
LOOKS = {
    "claude-opus": {"hair": ("#4a3426", "#33231a", "#6b4c38"), "shirt": CLAUDE, "acc": "glasses", "tie": True},
    "claude-sonnet": {"hair": ("#8a5634", "#673d22", "#b27a4c"), "shirt": CLAUDE, "acc": None},
    "claude-haiku": {"hair": ("#e5b94f", "#c08f2e", "#f7dc8a"), "shirt": CLAUDE, "acc": "sprout"},
    "claude-fable": {"hair": ("#a98bd6", "#8468b4", "#cbb5ef"), "shirt": CLAUDE, "acc": "star"},
    "codex": {"hair": ("#3a3346", "#28222f", "#5d5572"), "shirt": ("#3fa7a3", "#2b7d7a"), "acc": "headphones"},
    "other": {"hair": ("#c3c4d2", "#9c9db0", "#e7e8f2"), "shirt": ("#8d6cc9", "#6a4fa6"), "acc": None},
}
# effort の鉢巻き（キャラに重ねる絵）。medium 青・high 白・xhigh と max 赤（max は作業中に炎も出す。scene.js の bandOf）
BANDS = {"blue": ("#4a7fd0", "#33609f"), "white": ("#ffffff", "#d3d9e3"), "red": ("#e04545", "#a83232")}


class Sprite:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.px = [[None] * w for _ in range(h)]

    def put(self, x, y, key):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.px[y][x] = key

    def blit(self, grid, x0, y0):
        widths = {len(row) for row in grid}
        assert len(widths) == 1, f"rows differ in width: {grid}"
        for y, row in enumerate(grid):
            for x, ch in enumerate(row):
                if ch != ".":
                    self.put(x0 + x, y0 + y, ch)
        return self

    def outline(self, key="o", bottom=True):
        """形の外側（上下左右で隣り合う透明なところ）を輪郭にする。bottom=False なら下の端には付けない。"""
        add = []
        for y in range(self.h):
            for x in range(self.w):
                if self.px[y][x] is not None:
                    continue
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if not bottom and dy == -1:
                        continue
                    if 0 <= nx < self.w and 0 <= ny < self.h and self.px[ny][nx] not in (None, key):
                        add.append((x, y))
                        break
        for x, y in add:
            self.px[y][x] = key
        return self

    def flipped(self):
        s = Sprite(self.w, self.h)
        s.px = [list(reversed(row)) for row in self.px]
        return s

    def image(self, pal):
        im = Image.new("RGBA", (self.w, self.h), (0, 0, 0, 0))
        for y in range(self.h):
            for x in range(self.w):
                k = self.px[y][x]
                if k is not None:
                    im.putpixel((x, y), pal[k] if isinstance(pal[k], tuple) else rgb(pal[k]))
        return im


def grid(text):
    rows = [r for r in text.strip("\n").split("\n")]
    return [r.strip() for r in rows]


# ---- キャラクター（18x22。足の輪郭の下端が y=20。scene.js では左上を (x-9, 足-21) に置く） ----
CHAR_W = 18
HEAD_FRONT = grid("""
..hhhhhhhh..
.hhhhhhjjhh.
hhhhhhhhhjhh
hhhhhhhhhhhh
hssssssssssh
hssssssssssh
hss.ssss.ssh
sss.ssss.sss
srsssmmsssrs
.ssssssssss.
""")
HEAD_SIDE = grid("""
..hhhhhhhh..
.hhhhhhhjhh.
hhhhhhhhhhjh
hhhhhhhhhhhh
hhhhhhssssss
hhhhhsssssss
hhhhhssss.ss
hhhhsssss.ss
.hhhssssrssm
..hsssssss..
""")
TORSO_FRONT = grid("""
CcccwwcccC
CccccccccC
CccccccccC
sccccccccs
.pppppppp.
""")
LEGS_FRONT = grid("""
.ppp..ppp.
.ppp..ppp.
.bbb..bbb.
""")
TORSO_READ = grid("""
CcccwwcccC
CcskkkkscC
CcskyykscC
.ckkkkkkc.
.pppppppp.
""")
TORSO_RAISE = grid("""
CcccwwcccC
CccccccccC
CccccccccC
scccccccc.
.pppppppp.
""")
# 横向き（右向き）の体。腕を前に振ったコマと後ろに振ったコマ
TORSO_SIDE_A = grid("""
.cccccc.
.ccccCCs
.cccccc.
.cccccc.
.pppppp.
""")
TORSO_SIDE_B = grid("""
.cccccc.
sCCcccc.
.cccccc.
.cccccc.
.pppppp.
""")
LEGS_STRIDE = grid("""
.pp..pp.
pp....pp
bb....bb
""")
LEGS_PASS = grid("""
..pppp..
...pp...
...bbb..
""")
# 座ったときの体（机の奥の縁で切れる。下の端には輪郭を付けない）
TORSO_SIT = grid("""
CcccwwcccC
CccccccccC
CccccccccC
CccccccccC
""")

def eyes(sprite, x0, y0, kind, side=False):
    """目を描く。open は縦 2 ドット、blink は横線、happy は ^ の形。顔の格子の左上が (x0, y0)。"""
    cols = [9] if side else [3, 8]
    for c in cols:
        if kind == "open":
            sprite.put(x0 + c, y0 + 6, "e")
            sprite.put(x0 + c, y0 + 7, "e")
        elif kind == "blink":
            sprite.put(x0 + c, y0 + 6, "s")
            sprite.put(x0 + c, y0 + 7, "e")
            sprite.put(x0 + c + 1 if not side else x0 + c - 1, y0 + 7, "e")
        elif kind == "happy":
            sprite.put(x0 + c, y0 + 6, "e")
            sprite.put(x0 + c - 1, y0 + 7, "e")
            sprite.put(x0 + c + 1, y0 + 7, "e")
            sprite.put(x0 + c, y0 + 7, "s")


def accessory(s, x0, y0, acc, side):
    """model の小物。opus: 眼鏡、haiku: 若葉（頭のてっぺん）、fable: 星のピン、codex: ヘッドホン。"""
    if acc == "glasses":
        for c in [9] if side else [3, 8]:
            for x in (c - 1, c, c + 1):
                s.put(x0 + x, y0 + 5, "l")
            for x in (c - 1, c + 1):
                if x < 12:
                    s.put(x0 + x, y0 + 6, "Q")
                    s.put(x0 + x, y0 + 7, "Q")
        if side:
            for x in (5, 6, 7):  # つる
                s.put(x0 + x, y0 + 6, "l")
        else:
            s.put(x0 + 5, y0 + 6, "l")  # ブリッジ
            s.put(x0 + 6, y0 + 6, "l")
    elif acc == "sprout":
        cx = x0 + (5 if side else 6)
        s.put(cx, y0 - 1, "V")
        s.put(cx - 1, y0 - 2, "v")
        s.put(cx + 1, y0 - 2, "u")
    elif acc == "star":
        cx, cy = (x0 + 3, y0 + 2) if side else (x0 + 2, y0 + 1)
        for dx, dy in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)):
            s.put(cx + dx, cy + dy, "y")
    elif acc == "headphones":
        if side:
            for x in range(3, 9):
                s.put(x0 + x, y0 - 1, "E")
            for y in range(5, 8):
                s.put(x0 + 4, y0 + y, "E")
                s.put(x0 + 5, y0 + y, "M" if y == 6 else "E")
        else:
            for x in range(2, 10):
                s.put(x0 + x, y0 - 1, "E")
            s.put(x0 + 1, y0, "E")
            s.put(x0 + 10, y0, "E")
            for y in range(5, 8):
                for x in (-1, 0, 11, 12):
                    s.put(x0 + x, y0 + y, "M" if y == 6 and x in (-1, 12) else "E")


def head(sprite, x0, y0, look, eye="open", side=False, mouth=None):
    sprite.blit(HEAD_SIDE if side else HEAD_FRONT, x0, y0)
    # 格子の "." の目の場所は肌で埋めてから目を描く
    for c in ([9] if side else [3, 8]):
        sprite.put(x0 + c, y0 + 6, "s")
        sprite.put(x0 + c, y0 + 7, "s")
    eyes(sprite, x0, y0, eye, side)
    if mouth == "open":  # 口を開けて呼んでいる
        sprite.put(x0 + 5, y0 + 8, "m")
        sprite.put(x0 + 6, y0 + 8, "m")
        sprite.put(x0 + 5, y0 + 9, "m")
        sprite.put(x0 + 6, y0 + 9, "m")
    accessory(sprite, x0, y0, look.get("acc"), side)


def tie(s, tx, ty, look):
    """opus のネクタイ（正面の胴。胴の格子の左上が (tx, ty)）。"""
    if not look.get("tie"):
        return
    for dy, (a, b) in enumerate((("i", "i"), ("i", "I"), ("I", "I"))):
        s.put(tx + 4, ty + 1 + dy, a)
        s.put(tx + 5, ty + 1 + dy, b)


# 立ち・歩き（18x24）は頭の格子の左上が y=4、足の輪郭の下端が y=22。座り（18x18）は頭が y=3。
# どの関数も (絵, 頭の位置 (x0, y0, 横向きか)) を返す。頭の位置は鉢巻きの重ね絵に使う。
CHAR_W, CHAR_H, SIT_H = 18, 24, 18


def stand(look, eye="open"):
    s = Sprite(CHAR_W, CHAR_H)
    head(s, 3, 4, look, eye)
    s.blit(TORSO_FRONT, 4, 14).blit(LEGS_FRONT, 4, 19)
    tie(s, 4, 14, look)
    return s.outline(), (3, 4, False)


def walk(look, frame):
    """右向きの歩き。0: 足を開いたコマ、1: 足をそろえて 1 ドット浮いたコマ。"""
    s = Sprite(CHAR_W, CHAR_H)
    up = 0 if frame == 0 else -1
    head(s, 3, 4 + up, look, side=True)
    s.blit(TORSO_SIDE_A if frame == 0 else TORSO_SIDE_B, 5, 14 + up)
    s.blit(LEGS_STRIDE if frame == 0 else LEGS_PASS, 5, 19 + up)
    return s.outline(), (3, 4 + up, True)


def read(look, frame):
    s = Sprite(CHAR_W, CHAR_H)
    head(s, 3, 4 + frame, look, "blink" if frame else "open")
    s.blit(TORSO_READ, 4, 14).blit(LEGS_FRONT, 4, 19)
    return s.outline(), (3, 4 + frame, False)


def raise_hand(look, frame):
    s = Sprite(CHAR_W, CHAR_H)
    head(s, 3, 4, look, mouth="open")
    s.blit(TORSO_RAISE, 4, 14).blit(LEGS_FRONT, 4, 19)
    tie(s, 4, 14, look)
    # 右手（見て右）を頭の横に上げる。frame 1 は少し外に振る
    x = 15 if frame == 0 else 16
    s.put(14, 14, "C")
    s.put(15, 13, "C")
    for y in range(7, 13):
        s.put(x, y, "C")
    s.put(x, 6, "s")
    s.put(x, 5, "s")
    return s.outline(), (3, 4, False)


def sit(look, frame, eye="open"):
    """机の奥に座っている上半身。frame 1 はうなずく（頭が 1 ドット下がる）。下の端は机に隠れるので輪郭なし。"""
    s = Sprite(CHAR_W, SIT_H)
    head(s, 3, 3 + frame, look, eye)
    s.blit(TORSO_SIT, 4, 14)
    tie(s, 4, 14, look)
    return s.outline(bottom=False), (3, 3 + frame, False)


POSES = {
    "stand": lambda L: stand(L),
    "blink": lambda L: stand(L, "blink"),
    "walk-r-0": lambda L: walk(L, 0),
    "walk-r-1": lambda L: walk(L, 1),
    "read-0": lambda L: read(L, 0),
    "read-1": lambda L: read(L, 1),
    "raise-0": lambda L: raise_hand(L, 0),
    "raise-1": lambda L: raise_hand(L, 1),
    "sit-0": lambda L: sit(L, 0),
    "sit-1": lambda L: sit(L, 1),
    "sit-happy": lambda L: sit(L, 0, "happy"),
}
MIRRORED = {"walk-l-0": "walk-r-0", "walk-l-1": "walk-r-1"}  # 左向きは右向きを裏返す


def headband(body, head_pos):
    """鉢巻きだけの重ね絵（body と同じ大きさ）。額の上に 1 行、結び目の端は頭の後ろ（横向き）か右に出る。
    輪郭は、体からはみ出した端のまわりにだけ付ける。"""
    x0, y0, side = head_pos
    s = Sprite(body.w, body.h)
    for x in range(12):
        s.put(x0 + x, y0 + 3, "f" if x in (0, 11) else "d")
    tails = [(-1, 3, "d"), (-2, 2, "d"), (-2, 4, "f")] if side else [(12, 3, "d"), (13, 2, "d"), (13, 4, "f")]
    for dx, dy, k in tails:
        s.put(x0 + dx, y0 + dy, k)
    add = []
    for y in range(s.h):
        for x in range(s.w):
            if s.px[y][x] is not None or body.px[y][x] is not None:
                continue
            if any(0 <= x + dx < s.w and 0 <= y + dy < s.h and s.px[y + dy][x + dx] in ("d", "f")
                   for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                add.append((x, y))
    for x, y in add:
        s.px[y][x] = "o"
    return s


# 作業中の炎（effort max）。座った人の左右に 2 つ、2 コマ
FLAME = [grid("""
..y...
..y...
.yy...
.yYy..
.yYy..
yYtYy.
yYttYy
yjttjy
.jjjj.
..jj..
"""), grid("""
...y..
..yy..
..yy..
.yYy..
.yYYy.
.yYtYy
yYttYy
yjttjy
.jjjj.
..jj..
""")]


def flame(frame):
    s = Sprite(28, 10).blit(FLAME[frame], 0, 0)
    right = Sprite(6, 10).blit(FLAME[1 - frame], 0, 0).flipped()
    for y in range(10):
        for x in range(6):
            if right.px[y][x] is not None:
                s.put(22 + x, y, right.px[y][x])
    return s


# ---- 家具 ----
FURN = {
    "L": "#f3d3a2", "W": "#e3b47a", "g": "#d6a56b", "F": "#b97d4b", "D": "#93603a",
    "G": "#b9c2cf", "q": "#9aa4b4", "Q": "#dfe5ee", "n": "#6e7a8c",
    "x": "#59688a", "X": "#46536f", "z": "#7686a8",
    "t": "#c8774a", "T": "#a05a34", "v": "#5fae5a", "V": "#3f8a44", "u": "#8fd07a",
    "a": "#fffaf0", "A": "#9fd4f2", "B": "#d9f1ff", "C": "#7fc0e6",
    "j": "#e04545", "J": "#3aa050", "Y": "#e8b84a", "U": "#4a7fd0",
}


def pal(*extra):
    p = {**BASE, **FURN}
    for e in extra:
        p.update(e)
    return p


# 机のまんなか（1 席ぶん、幅 24）。行の並びは desk_end と同じ
DESK_M = grid("""
oooooooooooooooooooooooo
LLLLLLLLLLLLLLLLLLLLLLLL
WWWWWWWWWWWWWWWWWWWgWWWW
WWgWWWWWWWWWWWWWWWWWWWWW
WWWWWWWWWWWWWWWWWWWWWWgW
WWWWWWWWWWWWWWWWWWWWWWWW
WWWWWWWWWWWWWgWWWWWWWWWW
WWWWgWWWWWWWWWWWWWWWWWWW
WWWWWWWWWWWWWWWWWWgWWWWW
LLLLLLLLLLLLLLLLLLLLLLLL
oooooooooooooooooooooooo
FFFFFFFFFFFFFFFFFFFFFFFF
FFFFFFFFFFFFFFFFFFFFFFFF
FFFFFFFFFFFFFFFFFFFFFFFF
DDDDDDDDDDDDDDDDDDDDDDDD
oooooooooooooooooooooooo
""")
# ノート PC のふたの裏（幅 10）。座った人の胴の前に重ねる
LAPTOP = grid("""
.oooooooo.
oGGGGGGGGo
oGGGGGGGGo
oGGGQQGGGo
oGGGGGGGGo
oGGGGGGGGo
oqqqqqqqqo
onnnnnnnno
.oooooooo.
""")


def desk_end(right):
    rows = grid("""
ooooooo.
LLLLLLLo
WWWWWWWo
WWWWgWWo
WWWWWWWo
WWWWWWWo
WWgWWWWo
WWWWWWWo
WWWWWWWo
LLLLLLLo
oooooooo
FFFFFFFo
FFFFFFFo
FFFFFFFo
DDDDDDDo
oooooooo
.oDDo...
.oDDo...
.oDDo...
.oDDo...
.oooo...
""")
    s = Sprite(8, len(rows)).blit(rows, 0, 0)
    return s.flipped() if not right else s


def desk_mid():
    return Sprite(24, 21).blit(DESK_M, 0, 0)


# 机の上の手（キーボードを打つ）。幅 24 で、席の机（desk-m）と同じ x に重ねる。
# a は左手、b は右手が 1 ドット上がったコマ、rest は両手を置いたまま
def hands(kind):
    s = Sprite(24, 6)
    ly = 2 if kind in ("rest", "b") else 1
    ry = 2 if kind in ("rest", "a") else 1
    for x in (5, 6):
        s.put(x, ly, "s")
        s.put(x, ly + 1, "s")
    for x in (17, 18):
        s.put(x, ry, "s")
        s.put(x, ry + 1, "s")
    return s.outline()


CHAIR = grid("""
..xxxxxxxxxx..
.xxxxxxxxxxxx.
.xzxxxxxxxxxx.
.xzxxxxxxxxxx.
.xxxxxxxxxxxx.
.xxxxxxxxxxxx.
..XXXXXXXXXX..
xxxxxxxxxxxxxx
XXXXXXXXXXXXXX
""")

PLANT = grid("""
....v..u....
..vvvvuvv...
.uvVvvvvVvv.
vvvVvuvVvvvv
.vVvvvVvvVv.
vvvvVvvvvvvv
.vvVvvVvvVv.
..vvvVvvvv..
...VvvvVv...
....VvVV....
...tttttt...
..tttttttt..
..TTTTTTTT..
..tttttttt..
..tttttttt..
...tttttt...
...TTTTTT...
""")

# 時計の文字盤（13x13、中心は (6, 6)。輪郭は自動にすると斜めが途切れるので、格子に描く）。
# 針は別の絵（clock_hand）を重ねる。12・3・6・9 時に目盛り
CLOCK_FACE = grid("""
....ooooo....
..ooaanaaoo..
.oaaaaaaaaao.
.oaaaaaaaaao.
oaaaaaaaaaaao
oaaaaaaaaaaao
onaaaaaaaaano
oaaaaaaaaaaao
oaaaaaaaaaaao
.oaaaaaaaaao.
.oaaaaaaaaao.
..ooaanaaoo..
....ooooo....
""")


def clock_hand(index, length):
    """12 方向のうち index 番目（0 が 12 時、時計回り）の針。中心から length ドットの線と、中心の軸。"""
    import math
    s = Sprite(13, 13)
    a = math.radians(index * 30)
    ex, ey = 6 + length * math.sin(a), 6 - length * math.cos(a)
    steps = max(abs(round(ex) - 6), abs(round(ey) - 6), 1)
    for k in range(steps + 1):
        s.put(round(6 + (ex - 6) * k / steps), round(6 + (ey - 6) * k / steps), "o")
    return s

DOOR = grid("""
DDDDDDDDDDDDDDDD
DFFFFFFFFFFFFFFD
DFWWWWWWWWWWWWFD
DFWgWWWWWWWWgWFD
DFWWWWWWWWWWWWFD
DFWWWWWWWWWWWWFD
DFWWWWWWWWWWWWFD
DFWWWWWWWWWWWWFD
DFFFFFFFFFFFFFFD
DFWWWWWWWWWWWWFD
DFWWWWWWWWWWYYFD
DFWWWWWWWWWWYYFD
DFWWWWWWWWWWWWFD
DFWgWWWWWWWWWWFD
DFWWWWWWWWWWWWFD
DFWWWWWWWWWWWWFD
DFWWWWWWWWWWgWFD
DFWWWWWWWWWWWWFD
DFFFFFFFFFFFFFFD
DDDDDDDDDDDDDDDD
""")

# 空いた席の上に浮かぶ「＋」の札（輪郭は格子に描く）
HIRE_SIGN = grid("""
...ooooo...
.ooJJJJJoo.
.oJJJJJJJo.
oJJJJaJJJJo
oJJJJaJJJJo
oJJaaaaaJJo
oJJJJaJJJJo
oJJJJaJJJJo
.oJJJJJJJo.
.ooJJJJJoo.
...ooooo...
""")

BUBBLE = grid("""
.aaaaaaaaa.
aaaaaaaaaaa
aaaaaaaaaaa
aaaaaaaaaaa
aaaaaaaaaaa
aaaaaaaaaaa
aaaaaaaaaaa
aaaaaaaaaaa
.aaaaaaaaa.
...aaa.....
...aa......
...a.......
""")
MARKS = {
    "alert": (["..jj..", "..jj..", "..jj..", "..jj..", "......", "..jj.."], "j"),
    "ask": ([".jjjj.", "jj..jj", "...jj.", "..jj..", "......", "..jj.."], "j"),
    "done": (["......", ".....J", "....JJ", "J..JJ.", "JJJJ..", ".JJ..."], "J"),
    "talk": (["......", "......", ".o.o.o", "......", "......", "......"], "o"),  # 話す（…）
}


def bubble(kind):
    s = Sprite(13, 14).blit(BUBBLE, 1, 1)
    rows, _ = MARKS[kind]
    s.blit(rows, 3, 2)
    return s.outline()


def bookshelf(books=True):
    """幅 32・高さ 42 の本棚。本の色と幅は毎回同じになるよう種を決めて散らす。
    books=False は棚だけ（オフィスでは本 = 使える skill を mod が上に描く。scene.js の shelfBooks と寸法を合わせる）。"""
    rng = random.Random(7)
    s = Sprite(32, 42)
    for y in range(42):
        for x in range(32):
            s.put(x, y, "D" if x in (0, 1, 30, 31) or y in (0, 1, 41) else "F")
    colors = ["j", "U", "J", "Y", "k", "z", "t", "n"]
    for shelf in range(3):
        top = 3 + shelf * 13
        for x in range(2, 30):
            s.put(x, top + 11, "D")  # 棚板
            s.put(x, top + 12, "W")
        x = 3
        while books and x < 29:
            w = rng.choice([2, 2, 3, 3, 4])
            h = rng.choice([7, 8, 9, 10])
            c = rng.choice(colors)
            if x + w > 29:
                break
            for bx in range(x, x + w):
                for by in range(top + 11 - h, top + 11):
                    s.put(bx, by, c)
                s.put(bx, top + 11 - h + 2, "a")  # 背表紙の帯
            x += w + (1 if rng.random() < 0.25 else 0)
    return s.outline()


def whiteboard():
    s = Sprite(30, 18)
    for y in range(18):
        for x in range(30):
            s.put(x, y, "q" if x in (0, 29) or y in (0, 15) else "a")
    for x in range(4, 18):
        s.put(x, 4, "U")
    for x in range(4, 24):
        s.put(x, 7, "U" if x < 14 else "j")
    for x in range(4, 12):
        s.put(x, 10, "J")
    for x in range(3, 27):  # ペン置き
        s.put(x, 16, "n")
    s.put(8, 15, "j")
    s.put(9, 15, "j")
    return s.outline()


def whiteboard_plan():
    """プランのホワイトボード（whiteboard と同じ大きさ）: 橙の見出しと、チェックボックスの行（上は済み）、赤いマグネット"""
    s = Sprite(30, 18)
    for y in range(18):
        for x in range(30):
            s.put(x, y, "q" if x in (0, 29) or y in (0, 15) else "a")
    for x in range(4, 19):  # 見出し
        s.put(x, 2, "t")
        s.put(x, 3, "t")
    for x in (25, 26):  # マグネット
        s.put(x, 2, "j")
        s.put(x, 3, "j")
    for y, done, length in ((7, True, 16), (11, False, 12)):
        for dx in range(3):
            for dy in range(3):
                s.put(4 + dx, y - 1 + dy, "n" if dx != 1 or dy != 1 else "J" if done else "a")
        for x in range(9, 9 + length):
            s.put(x, y, "U")
    for x in range(3, 27):  # ペン置き
        s.put(x, 16, "n")
    s.put(20, 15, "U")
    s.put(21, 15, "U")
    return s.outline()


def floor_texture(w_tiles=32, h_tiles=10):
    """床（木の板）。板は高さ 8、長さ 32 で、段ごとに継ぎ目をずらす。"""
    W, H = w_tiles * 16, h_tiles * 16
    im = Image.new("RGBA", (W, H), rgb("#e6c48f"))
    rng = random.Random(3)
    for row in range(H // 8):
        y0 = row * 8
        shift = (row * 13) % 32
        for x in range(W):
            im.putpixel((x, y0), rgb("#f0d4a6"))
            im.putpixel((x, y0 + 7), rgb("#c99d63"))
            if (x + shift) % 32 == 0:
                for y in range(y0, y0 + 8):
                    im.putpixel((x, y), rgb("#c99d63"))
        for _ in range(W // 12):
            gx, gy = rng.randrange(W), y0 + rng.randrange(2, 6)
            for k in range(rng.choice([2, 3, 4])):
                if gx + k < W:
                    im.putpixel((gx + k, gy), rgb("#d9b47c"))
    return im


def hall_texture(w=48, h=560):
    """廊下の床（灰色の石のタイル 16x16、目地あり）。オフィスでは縦に並べて使う。"""
    im = Image.new("RGBA", (w, h), rgb("#d9d5cc"))
    rng = random.Random(5)
    for ty in range(0, h, 16):
        for tx in range(0, w, 16):
            shade = rng.choice(["#d9d5cc", "#d4d0c6", "#dedad2"])
            for y in range(ty, min(ty + 16, h)):
                for x in range(tx, min(tx + 16, w)):
                    if x == tx or y == ty:
                        c = "#c3beb3"  # 目地
                    elif x == tx + 1 or y == ty + 1:
                        c = "#e6e2da"  # 明るい縁
                    else:
                        c = shade
                    im.putpixel((x, y), rgb(c))
    return im


def wall_texture(w_tiles=32, h=36):
    """壁紙（縦じま）と、上の飾り縁、下の幅木（下の 5 行）。高さ 36（classic）か 30（modern）。"""
    W, H = w_tiles * 16, h
    im = Image.new("RGBA", (W, H), rgb("#f6ead2"))
    for x in range(W):
        for y in range(H):
            if y < 3:
                c = "#d8c09a" if y < 2 else "#c4a87e"
            elif y >= H - 5:
                c = ["#8a6040", "#c08a5a", "#b07a4c", "#b07a4c", "#8a6040"][y - (H - 5)]
            elif x % 8 in (0, 1):
                c = "#efe0c2"
            else:
                continue
            im.putpixel((x, y), rgb(c))
    return im


# ---- modern のテーマの部屋の手前（themes/modern/theme.json の glass: 高さ 14） ----
GLASS_H = 14


def glass_tile():
    """ガラスの壁の 1 枚（幅 24、横に並べる）: 上の枠、透けたガラス（斜めの光の筋）、左端の縦の桟、下の枠。"""
    im = Image.new("RGBA", (24, GLASS_H), (0, 0, 0, 0))
    for x in range(24):
        im.putpixel((x, 0), rgb("#eef3f8"))
        im.putpixel((x, 1), rgb("#8592a6"))
        for y in range(2, GLASS_H - 2):
            im.putpixel((x, y), (175, 222, 246, 80))
        im.putpixel((x, GLASS_H - 2), rgb("#6e7a8c"))
        im.putpixel((x, GLASS_H - 1), rgb("#46536f"))
    for k in range(GLASS_H - 4):  # 斜めの光（太い筋と細い筋）
        for t, a in ((0, 130), (1, 130), (4, 80)):
            if 8 + k + t < 24:
                im.putpixel((8 + k + t, GLASS_H - 3 - k), (255, 255, 255, a))
    for y in range(2, GLASS_H - 2):  # 縦の桟
        im.putpixel((0, y), rgb("#8592a6"))
        im.putpixel((1, y), (238, 243, 248, 200))
    return im


def glass_door():
    """扉の枠（幅 20、高さ 16。ガラスの壁より 2 上に出る）: 両側の柱だけ（あいだの 16 が戸口）。戸は glass_door_panel で、
    閉まっていると柱のあいだ、人が通るときは右のガラスの手前へ滑る（scene.js の drawables と Office の doors）。"""
    im = Image.new("RGBA", (20, GLASS_H + 2), (0, 0, 0, 0))
    for px in (0, 18):
        for y in range(GLASS_H + 2):
            im.putpixel((px, y), rgb("#7686a8"))
            im.putpixel((px + 1, y), rgb("#46536f"))
    return im


def glass_door_panel():
    """自動ドアの戸（幅 16 = 戸口、高さ 14 = ガラスの壁）: 上下の枠はガラスの壁とそろえ、左右の縦の框、少し濃いガラス、
    ぶつからないための白い帯、左の取っ手。"""
    im = Image.new("RGBA", (16, GLASS_H), (0, 0, 0, 0))
    for x in range(16):
        im.putpixel((x, 0), rgb("#eef3f8"))
        im.putpixel((x, 1), rgb("#8592a6"))
        for y in range(2, GLASS_H - 2):
            im.putpixel((x, y), (150, 205, 238, 120))
        im.putpixel((x, GLASS_H - 2), rgb("#6e7a8c"))
        im.putpixel((x, GLASS_H - 1), rgb("#46536f"))
    for x in range(1, 15):  # 白い帯
        im.putpixel((x, 6), (255, 255, 255, 170))
    for y in range(2, GLASS_H - 2):  # 縦の框
        im.putpixel((0, y), rgb("#8592a6"))
        im.putpixel((15, y), rgb("#8592a6"))
    for y in range(5, 9):  # 取っ手
        im.putpixel((2, y), rgb("#46536f"))
    return im


def corridor_texture(w=512, h=16):
    """modern の横の廊下の床: 縦の廊下と同じ石のタイル。いちばん上の行はガラスの壁の影で少し暗い。"""
    im = hall_texture(w=w, h=h)
    for x in range(w):
        im.putpixel((x, 0), rgb("#b9b4a9"))
    return im


# ---- classic（和風）のテーマの絵（themes/classic/theme.json。部屋の寸法は modern と同じで、障子の壁も高さ 14） ----
WOOD = ["#9a6a40", "#7a5030", "#5a3a20", "#3e2614"]  # 柱・長押・敷居の濃い木（明るい面から影へ）
SHIRAKI = ["#f0dcb4", "#dcbd8a", "#c29c68", "#9a7446"]  # 障子の枠と組子の白木
BOARD = {"base": "#a8743f", "edge": "#bf8a52", "gap": "#86582f", "grain": "#9a6838"}  # 縁側と廊下の板
PAPER = (248, 243, 230, 235)  # 障子紙（少しだけ透ける）


def plaster_wall(w=512, h=30):
    """和室の奥の壁: 上に長押（濃い木）、土壁（砂色に細かな粒）、下に畳寄せ（下の 4 行）。"""
    im = Image.new("RGBA", (w, h), rgb("#e0cfa6"))
    rng = random.Random(11)
    for _ in range(w * h // 12):  # 土壁の粒
        im.putpixel((rng.randrange(w), rng.randrange(4, h - 4)), rgb(rng.choice(["#d5c398", "#e9dab8", "#d9c79e"])))
    for x in range(w):
        for y, c in ((0, WOOD[2]), (1, WOOD[0]), (2, WOOD[1]), (3, "#c9b588"),
                     (h - 4, "#c9b588"), (h - 3, WOOD[0]), (h - 2, WOOD[1]), (h - 1, WOOD[3])):
            im.putpixel((x, y), rgb(c))
    return im


def tatami_texture(w=512, h=116, top=30):
    """畳の床。高さは 1 列（116）と同じにして、どの列でも畳の継ぎ目が同じ所に来る（奥の壁の下 top から敷く）。
    畳は横向きの 32x16 で、段ごとに半分ずらす。長い辺に畳縁、短い辺は継ぎ目。い草の目は横の筋で、畳ごとに少し色が違う。"""
    shades = [("#cdc78c", "#c2bc80"), ("#c6c184", "#bbb678"), ("#d2cc93", "#c7c187")]
    im = Image.new("RGBA", (w, h))
    for y in range(h):
        row, dy = divmod(y - top, 16)
        for x in range(w):
            col, dx = divmod(x + (16 if row % 2 else 0), 32)
            if dy == 0:
                c = "#4a4f3a"  # 畳縁（上下の畳の縁が並んだもの）
            elif dx == 0:
                c = "#9d9958"  # 短い辺の継ぎ目
            else:
                c = shades[(col * 2 + row) % 3][dy % 2]
            im.putpixel((x, y), rgb(c))
    return im


def boards(w, h, along_x, width, length, seed):
    """板張りの床: along_x なら横に長い板（高さ width）、でなければ縦に長い板（幅 width）。板の継ぎ目は length ごとに、
    板ごとにずらす。length は板の向きの長さ（w か h）を割り切ること（並べたときに継ぎ目がそろう）。"""
    im = Image.new("RGBA", (w, h), rgb(BOARD["base"]))
    rng = random.Random(seed)
    for y in range(h):
        for x in range(w):
            across, along = (y, x) if along_x else (x, y)
            plank, d = divmod(across, width)
            if d == 0:
                c = BOARD["edge"]
            elif d == width - 1 or (along + plank * 37) % length == 0:
                c = BOARD["gap"]
            else:
                continue
            im.putpixel((x, y), rgb(c))
    for _ in range((w * h) // 40):  # 木目
        a, b = rng.randrange(w if along_x else h), rng.randrange(h if along_x else w)
        if 0 < b % width < width - 1:
            for k in range(rng.choice([3, 4, 6])):
                im.putpixel(((a + k) % w, b) if along_x else (b, (a + k) % h), rgb(BOARD["grain"]))
    return im


def engawa_texture(w=512, h=16):
    """縁側（列ごとの横の廊下）: 横に長い板。いちばん上の行は障子の影で暗い。"""
    im = boards(w, h, True, 4, 128, 7)
    for x in range(w):
        im.putpixel((x, 0), rgb(WOOD[2]))
    return im


def wood_hall_texture(w=48, h=560):
    """和風の縦の廊下: 縦に長い板（幅 8）。"""
    return boards(w, h, False, 8, 140, 9)


def shoji(w):
    """障子 1 枚（幅 w、高さ 14）: 上の面と上の框、少し透ける障子紙と組子（縦は 6 ごと、横は 3 段）、腰板、敷居。
    左右の縦の框は白木（右は影で少し濃い）。"""
    im = Image.new("RGBA", (w, GLASS_H), (0, 0, 0, 0))
    for x in range(w):
        for y in range(2, 10):
            im.putpixel((x, y), PAPER)
        for y, c in ((0, SHIRAKI[0]), (1, SHIRAKI[2]), (4, SHIRAKI[1]), (7, SHIRAKI[1]),
                     (10, SHIRAKI[2]), (11, "#b08a58"), (12, "#9e784a"), (13, WOOD[3])):
            im.putpixel((x, y), rgb(c))
    for x in range(6, w - 1, 6):  # 縦の組子
        for y in range(2, 10):
            im.putpixel((x, y), rgb(SHIRAKI[1]))
    for y in range(1, GLASS_H - 1):
        im.putpixel((0, y), rgb(SHIRAKI[1]))
        im.putpixel((w - 1, y), rgb(SHIRAKI[3]))
    return im


def shoji_tile():
    """障子の壁の 1 枚（幅 24、横に並べる）。"""
    return shoji(24)


def shoji_door():
    """障子戸の枠（幅 20、高さ 16。障子の壁より 2 上に出る）: 両側の柱（濃い木）と、戸口の下の敷居（障子の壁の敷居と
    続く）。戸は shoji_door_panel で、閉まっていると柱のあいだ、人が通るときは右の障子の手前へ滑る（modern の自動ドアと同じ）。"""
    im = Image.new("RGBA", (20, GLASS_H + 2), (0, 0, 0, 0))
    for x in range(2, 18):
        im.putpixel((x, GLASS_H + 1), rgb(WOOD[3]))
    for px in (0, 18):
        for y in range(GLASS_H + 2):
            im.putpixel((px, y), rgb(WOOD[0] if y == 0 else WOOD[1]))
            im.putpixel((px + 1, y), rgb(WOOD[0] if y == 0 else WOOD[2]))
    return im


def shoji_door_panel():
    """障子戸（幅 16 = 戸口、高さ 14 = 障子の壁）: 障子の壁と同じ作りで、腰板に引手。"""
    im = shoji(16)
    im.putpixel((2, 11), rgb(WOOD[3]))
    return im


# ---- 窓の外（scene.js の windowView）: 窓枠（window.png）の後ろに、空・雨や雪・稲光を重ねる。どれも 28x16 ----
# 窓は 2x2 枚のガラス（左上・右上・左下・右下。どれも 12x6）。枠は外周と、まんなかの縦横 2 ドットの桟
WIN_W, WIN_H = 28, 16
PANES = [(1, 1), (15, 1), (1, 9), (15, 9)]  # ガラスの左上


def in_glass(x, y):
    return any(px <= x < px + 12 and py <= y < py + 6 for px, py in PANES)


def in_view(x, y):
    """窓枠の内側（桟の裏も含む）。外の景色はここ全部に描き、窓枠（十字の桟・引き違いの縦の桟）がその上に重なる。"""
    return 1 <= x < WIN_W - 1 and 1 <= y < WIN_H - 1


def window_frame():
    """十字の窓枠（classic）: ガラスは透明（後ろの空が見える）。ガラスには斜めの光の筋を薄く重ねる。"""
    im = Image.new("RGBA", (WIN_W, WIN_H), (0, 0, 0, 0))
    for y in range(WIN_H):
        for x in range(WIN_W):
            if not in_glass(x, y):
                im.putpixel((x, y), rgb(FURN["a"]))
    for px, py in PANES:
        for i in range(6 if py == 1 else 5):
            im.putpixel((px + i, py + i), (255, 255, 255, 45))
    return im


def window_frame_slide():
    """引き違いの窓枠（modern）: 壁と区別できるアルミの枠（下の辺は敷居で少し濃い）と、真ん中に 2 枚の窓が重なる縦の桟
    （明るい縁と影の 2 ドット。まんなかに鍵）。左右のガラスに光の筋を薄く重ねる。"""
    im = Image.new("RGBA", (WIN_W, WIN_H), (0, 0, 0, 0))
    for y in range(WIN_H):
        for x in range(WIN_W):
            if not in_view(x, y):
                im.putpixel((x, y), rgb("#7f8a9c" if y == WIN_H - 1 else "#9aa4b4"))
    mid = WIN_W // 2 - 1  # 13 と 14
    for y in range(1, WIN_H - 1):
        im.putpixel((mid, y), rgb("#c9d1dc"))
        im.putpixel((mid + 1, y), rgb("#8592a6"))
    for y in (7, 8):  # 鍵
        im.putpixel((mid, y), rgb("#5b6678"))
    for x0 in (2, mid + 3):  # 光の筋（左右の 1 枚ずつ）
        for i in range(6):
            im.putpixel((x0 + i, 1 + i), (255, 255, 255, 45))
    return im


def window_frame_wood():
    """木の枠の引き違いの窓（classic の和風）: 濃い木の枠（下の辺は敷居で少し濃い）、真ん中に 2 枚の窓が重なる縦の桟、
    左右の窓の上のほうに横の桟。左右のガラスに光の筋を薄く重ねる。"""
    im = Image.new("RGBA", (WIN_W, WIN_H), (0, 0, 0, 0))
    for y in range(WIN_H):
        for x in range(WIN_W):
            if not in_view(x, y):
                im.putpixel((x, y), rgb(WOOD[3] if y == WIN_H - 1 else WOOD[1]))
    mid = WIN_W // 2 - 1
    for x in range(1, WIN_W - 1):  # 横の桟
        im.putpixel((x, 5), rgb(WOOD[1]))
    for y in range(1, WIN_H - 1):
        im.putpixel((mid, y), rgb(WOOD[0]))
        im.putpixel((mid + 1, y), rgb(WOOD[2]))
    for x0 in (2, mid + 3):  # 光の筋（左右の 1 枚ずつ、横の桟の下）
        for i in range(6):
            im.putpixel((x0 + i, 7 + i), (255, 255, 255, 45))
    return im


# 時間帯ごとの色: 空（上から地平線へ 4 段）、雲（明るい面・影）、ビル（2 色・窓・明かり・明かりの割合）、
# タワー（骨組み・展望台）、曇りの空（4 段と雲の筋）
SKY = {
    "day": {
        "sky": ["#5aa8e6", "#7cc0f0", "#a6d8f7", "#cdeafb"], "cloud": ("#ffffff", "#dfe8f2"),
        "bld": ("#9aaec8", "#8aa0bd", "#c9d8ea", "#ffd98c", 0.0), "tower": ("#e2533c", "#f4efe6"),
        "gray": ["#9ea9b7", "#aab4c0", "#b6bfca", "#c3cad3", "#8f9aa8"],
    },
    "dawn": {
        "sky": ["#6c86c6", "#b39ccc", "#f0aaa0", "#ffd49a"], "cloud": ("#fbd6cf", "#d8a7b4"),
        "bld": ("#7b7f9f", "#6e7292", "#8d90ad", "#ffd98c", 0.12), "tower": ("#c9503f", "#f0d2bc"),
        "gray": ["#8c8aa6", "#a09aae", "#b4a9b2", "#c4b5b1", "#7c7a96"],
    },
    "dusk": {
        "sky": ["#4a5aa0", "#9c6aa4", "#ec8a6a", "#ffb35e"], "cloud": ("#f6b394", "#b9708a"),
        "bld": ("#5e4f75", "#54466a", "#6c5d84", "#ffcc73", 0.3), "tower": ("#a8423d", "#e8b89c"),
        "gray": ["#6c6282", "#806c86", "#977a86", "#a88986", "#5c5472"],
    },
    "twilight": {
        "sky": ["#1d2a5e", "#2e3f7c", "#4c5a96", "#7a6aa2"], "cloud": ("#56608e", "#434b78"),
        "bld": ("#2b3050", "#252a47", "#343a5c", "#ffd86b", 0.55), "tower": ("#ff9a45", "#ffe08a"),
        "gray": ["#2d3249", "#363b54", "#40455e", "#4b4f68", "#262a40"],
    },
    "night": {
        "sky": ["#0b1230", "#111a3e", "#18244c", "#22305a"], "cloud": ("#2c3456", "#222944"),
        "bld": ("#151a2d", "#111526", "#1d2338", "#ffd86b", 0.45), "tower": ("#ff9a45", "#ffe08a"),
        "gray": ["#191b24", "#1e212b", "#242833", "#34303a", "#14161e"],
    },
}
COVERS = ("clear", "cloudy", "overcast")
# 下の街並み: (左端, 右端, 屋上の行)。右下には赤いタワー（上まで伸びる）。最後の 1 棟は十字の桟の裏（桟のない窓で見える）
BUILDINGS = [(1, 3, 12), (4, 6, 10), (7, 8, 12), (9, 12, 11), (15, 17, 12), (18, 19, 11), (25, 26, 10), (13, 14, 12)]
TOWER = {"tip": [(22, y) for y in range(3, 9)], "deck": [(21, 9), (22, 9), (23, 9), (21, 11), (22, 11), (23, 11)],
         "body": [(22, 10), (21, 12), (23, 12), (20, 13), (24, 13), (20, 14), (24, 14)]}
CLOUD_A = ["..LL...", ".LLLLL.", "LLLLLLL", ".SSSSS."]
CLOUD_B = [".LL..", "LLLLL", ".SSS."]
DISC = [".XX.", "XYYX", "XYYX", ".XX."]  # 太陽と月（X が縁）


def sky(phase, cover):
    """空 1 枚: 4 段の空（段の境は市松でぼかす）、太陽か月と星、雲。街並みと名物は場所ごとの絵（city_view）を重ねる。"""
    c = SKY[phase]
    bands = c["gray"][:4] if cover == "overcast" else c["sky"]
    im = Image.new("RGBA", (WIN_W, WIN_H), rgb(bands[3]))
    rows = {0: 0, 1: 0, 2: 0, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1, 9: 2, 10: 2}
    for y in range(WIN_H):
        for x in range(WIN_W):
            if y in rows:
                band = rows[y]
            elif y == 3:
                band = (x + y) % 2  # 0 と 1 の境
            elif y == 11:
                band = 2 + (x + y) % 2  # 2 と 3 の境
            else:
                band = 3
            im.putpixel((x, y), rgb(bands[band]))
    put = lambda x, y, col: in_view(x, y) and im.putpixel((x, y), rgb(col) if isinstance(col, str) else col)

    def shape(rows_, x0, y0, colors):
        for dy, row in enumerate(rows_):
            for dx, ch in enumerate(row):
                if ch in colors:
                    put(x0 + dx, y0 + dy, colors[ch])

    rng = random.Random(f"{phase}-{cover}")
    if cover == "overcast":  # 雲の筋（低く垂れた雲の底）
        for y in (2, 5, 10):
            x = rng.randrange(0, 4)
            while x < WIN_W:
                for k in range(rng.randrange(3, 6)):
                    put(x + k, y, c["gray"][4])
                x += rng.randrange(7, 11)
    else:
        if phase == "day":
            shape(DISC, 2, 2, {"X": "#ffe58a", "Y": "#fff8d8"})
        elif phase == "dawn":
            shape(DISC, 1, 9, {"X": "#ffb060", "Y": "#ffe0a0"})  # 街の向こうから昇る
        elif phase == "dusk":
            shape(DISC, 15, 9, {"X": "#ff8a4a", "Y": "#ffc070"})  # タワーの横に沈む
        elif phase == "night":
            shape(DISC, 3, 2, {"X": "#e8e0b8", "Y": "#fff6d6"})
        stars = {"night": 8, "twilight": 3}.get(phase, 0) // (2 if cover == "cloudy" else 1)
        placed = 0
        while placed < stars:
            x, y = rng.randrange(WIN_W), rng.choice([1, 2, 3, 4, 5, 6, 9])
            if not in_glass(x, y) or (phase == "night" and 2 <= x <= 6 and 1 <= y <= 6):
                continue
            put(x, y, "#ffffff" if placed % 3 else ("#b9c6ff" if phase == "night" else "#9aa8d8"))
            placed += 1
        if cover == "cloudy":
            light, shade = c["cloud"]
            shape(CLOUD_A, 5, 2, {"L": light, "S": shade})
            shape(CLOUD_B, 15, 3, {"L": light, "S": shade})
            shape(CLOUD_B, 8, 9, {"L": light, "S": shade})
    return im


# ---- 窓の外の街並みと名物（場所ごと。scene.js の PLACES の id）: 空（sky）の上に重ねる絵 view/<場所>-<時間帯> ----
# 名物は文字の格子（"." は描かない）と、置く所（左上の x, y）と、色（文字 → (昼の色, 明かり)）。昼の色は暗くなるほど
# 街のシルエットの色に寄せ（LIGHT_MIX）、明かりのある色は薄明と夜にその明かりで灯る（ライトアップ）。
# back は街並みの奥（山や丘）、front は手前（名物）。buildings は街並み（BUILDINGS の形。None なら名物と重ならないものを全部）。
# beacons はてっぺんの赤い灯り（薄明と夜）。東京だけは、名物を分ける前の窓とピクセルまで同じになるよう、元の描き方のまま
LIGHT_MIX = {"day": 0.0, "dawn": 0.45, "dusk": 0.55, "twilight": 0.75, "night": 0.85}
LANDMARKS = {
    "sydney": {  # ハーバーブリッジとオペラハウス（海は窓の幅いっぱい）
        "buildings": [],
        "back": [(["~" * 26, "~" * 26], 1, 13, {"~": ("#3f7fb5", None)})],
        "front": [
            ([
                "...aaaaaa...",
                ".aa......aa.",
                "a..........a",
                "dddddddddddd",
                "p..........p",
                "p..........p",
            ], 1, 9, {"a": ("#8c96a3", "#ffe08a"), "d": ("#6e7682", None), "p": ("#c9b48a", None)}),
            ([
                "....w.......",
                "...ww...w...",
                "..www..ww..w",
                ".wwww.www.ww",
                "bbbbbbbbbbbb",
            ], 15, 9, {"w": ("#f4f2ea", "#fff2c8"), "b": ("#c9a77a", None)}),
        ],
    },
    "tokyo": {"tokyo": True},
    "seoul": {  # 南山の上の N ソウルタワー
        "front": [([
            "....a....",
            "....a....",
            "...ppp...",
            "...PPP...",
            "...ppp...",
            "....t....",
            "....t....",
            "....t....",
            "....t....",
            "....t....",
            "...hhh...",
            ".hhhhhhh.",
            "hhhhhhhhh",
            "hhhhhhhhh",
        ], 17, 1, {"a": ("#e6e8ee", None), "p": ("#e1e5ec", None), "P": ("#9fb2c6", "#ffe08a"), "t": ("#cfd5de", None),
                   "h": ("#5e8a55", None)})],
        "beacons": [(21, 1)],
    },
    "shanghai": {  # 東方明珠塔（ピンクの玉）
        "front": [([
            "...s...",
            "...s...",
            "...s...",
            "..PPP..",
            "..PPP..",
            "...s...",
            "...s...",
            "..sss..",
            "..sss..",
            ".PPPPP.",
            ".PPPPP.",
            "..PPP..",
            ".s.s.s.",
            "s..s..s",
        ], 18, 1, {"s": ("#c8cdd6", None), "P": ("#d9558a", "#ff8fbf")})],
        "beacons": [(21, 1)],
    },
    "taipei": {  # 台北 101（積み重ねた節）
        "front": [([
            "..s..",
            ".ttt.",
            "ttttt",
            ".ttt.",
            "ttttt",
            ".ttt.",
            "ttttt",
            ".ttt.",
            "ttttt",
            ".ttt.",
            "ttttt",
            ".TTT.",
            ".TTT.",
            ".TTT.",
        ], 19, 1, {"s": ("#c9d3d8", None), "t": ("#5f9e93", "#7fdcc4"), "T": ("#4f857c", "#5fb8a5")})],
        "beacons": [(21, 1)],
    },
    "singapore": {  # マリーナベイ・サンズ（3 本の塔の上の船）
        "front": [([
            "..bbbbbbbbbb",
            "bbbbbbbbbbb.",
            ".TT..TT..TT.",
            ".TT..TT..TT.",
            ".TT..TT..TT.",
            ".TT..TT..TT.",
            ".TT..TT..TT.",
            ".WT..TW..WT.",
            ".TT..TT..TT.",
            ".TW..WT..TW.",
            ".TT..TT..TT.",
            ".TT..TT..TT.",
        ], 15, 3, {"b": ("#d4dbe2", "#e8f0ff"), "T": ("#a7b6c6", None), "W": ("#a7b6c6", "#ffd86b")})],
    },
    "bangkok": {  # ワット・アルン（とうもろこしのような塔）
        "front": [([
            "....s....",
            "....p....",
            "....p....",
            "...ppp...",
            "...ppp...",
            "...ppp...",
            "..ppppp..",
            "..ppppp..",
            ".s.ppp.s.",
            ".p.ppp.p.",
            "ppppppppp",
            "ppppppppp",
            "ggggggggg",
        ], 17, 2, {"s": ("#d9a441", "#ffd27a"), "p": ("#efe6d2", "#f2c46a"), "g": ("#9a7a52", None)})],
    },
    "delhi": {  # インド門
        "front": [([
            "...ccccc...",
            "..ggggggg..",
            "..ggggggg..",
            "..ggggggg..",
            "..ggggggg..",
            "..ggggggg..",
            "..gg...gg..",
            "..gg...gg..",
            "..gg...gg..",
            ".ggg...ggg.",
            "ggggggggggg",
        ], 16, 4, {"c": ("#b0744a", "#e0a060"), "g": ("#c98b5a", "#d99a62")})],
    },
    "dubai": {  # ブルジュ・ハリファ（細く高い針）
        "front": [([
            "..n..",
            "..n..",
            "..n..",
            "..n..",
            ".nnn.",
            ".nNn.",
            ".nnn.",
            ".nnn.",
            ".nNn.",
            "nnnnn",
            "nnNnn",
            "nnnnn",
            "nNnnn",
            "nnnnn",
        ], 19, 1, {"n": ("#7f8fa6", None), "N": ("#7f8fa6", "#ffe08a")})],
        "beacons": [(21, 1)],
    },
    "moscow": {  # ワシリー寺院（玉ねぎ屋根と金の塔）
        "front": [([
            ".....g.....",
            ".....g.....",
            "....ggg....",
            ".r..ggg..b.",
            "rrr.ggg.bbb",
            "rrr.ggg.bbb",
            ".w..www..w.",
            ".w..www..w.",
            ".w..www..w.",
            "wwwwwwwwwww",
            "wwwwwwwwwww",
            "wwwwwwwwwww",
            "wwwwwwwwwww",
        ], 16, 2, {"g": ("#d9b04a", "#ffd56a"), "r": ("#d9483b", "#ff6a55"), "b": ("#3f9a6a", "#5fd08f"),
                   "w": ("#b5523f", "#d9725a")})],
    },
    "berlin": {  # テレビ塔（銀の玉）
        "front": [([
            "..a..",
            "..a..",
            ".sss.",
            "sSsss",
            ".sss.",
            "..t..",
            "..t..",
            "..t..",
            "..t..",
            "..t..",
            "..t..",
            "..t..",
            ".ttt.",
            ".ttt.",
        ], 19, 1, {"a": ("#e05a48", None), "s": ("#c8ced6", None), "S": ("#c8ced6", "#ffe08a"), "t": ("#d8d3c8", None)})],
        "beacons": [(21, 1)],
    },
    "paris": {  # エッフェル塔（夜は金色）
        "front": [([
            "....e....",
            "....e....",
            "...eee...",
            "...e.e...",
            "...eee...",
            "..e...e..",
            "..eeeee..",
            "..e...e..",
            ".eeeeeee.",
            ".e.....e.",
            ".e.....e.",
            "e..eee..e",
            "e.e...e.e",
            "ee.....ee",
        ], 17, 1, {"e": ("#8a6a4a", "#ffc65a")})],
    },
    "london": {  # ビッグ・ベン（時計台）と国会議事堂
        "front": [([
            "..r.......",
            "..r.......",
            ".rrr......",
            ".CCC......",
            ".ccc......",
            ".bbb......",
            ".bbb......",
            ".bbb......",
            ".bbb......",
            ".bbb......",
            ".bbb.p.p.p",
            ".bbbpppppp",
            "bbbbpppppp",
            "bbbbpppppp",
        ], 17, 1, {"r": ("#4a5a64", None), "C": ("#f4ecd2", "#fff2b0"), "c": ("#c9a96e", None), "b": ("#c9a96e", "#e2c27e"),
                   "p": ("#b8995e", "#d8b56e")})],
    },
    "sao-paulo": {  # オクタビオ・フリアス橋（X の柱と斜めの綱）
        "front": [([
            ".....x.x....",
            ".....x.x....",
            "......x.....",
            "......x.....",
            ".....cxc....",
            "....c.x.c...",
            "...c..x..c..",
            "..c...x...c.",
            ".c....x....c",
            "c.....x.....",
            "dddddddddddd",
            "............",
            "wwwwwwwwwwww",
        ], 15, 2, {"x": ("#ededed", "#bfe8ff"), "c": ("#c3cbd3", "#9fd8ff"), "d": ("#7a8494", None), "w": ("#4f7fa8", None)})],
    },
    "new-york": {  # エンパイア・ステート・ビル
        "front": [([
            "...s...",
            "...s...",
            "..sss..",
            "..bBb..",
            ".bbbbb.",
            ".bBbbb.",
            ".bbbbb.",
            ".bbbbb.",
            "bbbbbbb",
            "bbBbbbb",
            "bbbbbBb",
            "bbbbbbb",
            "bBbbbbb",
            "bbbbbbb",
        ], 19, 1, {"s": ("#cfc8b8", "#c8a8ff"), "b": ("#b3aa97", None), "B": ("#b3aa97", "#ffd86b")})],
    },
    "chicago": {  # ウィリス・タワー（黒い塔と 2 本のアンテナ）
        "front": [([
            ".a...a.",
            ".a...a.",
            ".kkkk..",
            ".kkkk..",
            ".kkkkk.",
            ".kkkkk.",
            "kkkkkkk",
            "kkkkkkk",
            "kkkkkkk",
            "kkKkkkk",
            "kkkkkKk",
            "kkkkkkk",
            "kKkkkkk",
            "kkkkkkk",
        ], 18, 1, {"a": ("#e9e9ef", None), "k": ("#33363d", None), "K": ("#33363d", "#ffd86b")})],
        "beacons": [(19, 1), (23, 1)],
    },
    "denver": {  # ロッキー山脈（雪の頂。上の 2 枚に 1 つずつ）の手前の街
        "back": [([
            "........s...........s.....",
            ".......sss.........sss....",
            "......ssmss.......ssmss...",
            ".....mmmmmmm.....mmmmmmm..",
            "....mmmmmmmmm...mmmmmmmmm.",
            "...mmmmmmmmmmm.mmmmmmmmmmm",
            "..mmmmmmmmmmmmmmmmmmmmmmmm",
            ".mmmmmmmmmmmmmmmmmmmmmmmmm",
            "mmmmmmmmmmmmmmmmmmmmmmmmmm",
            "mmmmmmmmmmmmmmmmmmmmmmmmmm",
            "mmmmmmmmmmmmmmmmmmmmmmmmmm",
            "mmmmmmmmmmmmmmmmmmmmmmmmmm",
            "mmmmmmmmmmmmmmmmmmmmmmmmmm",
        ], 1, 2, {"m": ("#66748d", None), "s": ("#ffffff", None)})],
        "front": [],
    },
    "los-angeles": {  # 丘の上のハリウッドの看板と、ヤシの木
        "back": [([
            "......hhhh................",
            "...hhSSSSSShh.............",
            "..hhhhhhhhhhhhh...........",
            ".hhhhhhhhhhhhhhhh.........",
            "hhhhhhhhhhhhhhhhhhh.......",
            "hhhhhhhhhhhhhhhhhhhhhh....",
            "hhhhhhhhhhhhhhhhhhhhhhhhhh",
            "hhhhhhhhhhhhhhhhhhhhhhhhhh",
            "hhhhhhhhhhhhhhhhhhhhhhhhhh",
            "hhhhhhhhhhhhhhhhhhhhhhhhhh",
            "hhhhhhhhhhhhhhhhhhhhhhhhhh",
        ], 1, 4, {"h": ("#8a8a5a", None), "S": ("#f4f4f4", "#f4f4f4")})],
        "front": [
            ([
                "p.p.p",
                ".ppp.",
                "p.t.p",
                "..t..",
                "..t..",
                "..t..",
                "..t..",
                "..t..",
                "..t..",
                "..t..",
                "..t..",
                "..t..",
                "..t..",
            ], 19, 2, {"p": ("#3f7a3a", None), "t": ("#7a5a3a", None)}),
            ([
                "p.p.p",
                ".ppp.",
                "p.t.p",
                "..t..",
                "..t..",
                "..t..",
                "..t..",
                "..t..",
                "..t..",
                "..t..",
            ], 23, 5, {"p": ("#3f7a3a", None), "t": ("#7a5a3a", None)}),
        ],
    },
    "honolulu": {  # ダイヤモンドヘッド（右上まで上がる稜線）と海とヤシの木
        "back": [([
            "..........rr..",
            "........rrhhr.",
            "......rrhhhhhr",
            "....rrhhhhhhhh",
            "..rrhhhhhhhhhh",
            "rrhhhhhhhhhhhh",
            "hhhhhhhhhhhhhh",
            "hhhhhhhhhhhhhh",
            "hhhhhhhhhhhhhh",
        ], 13, 3, {"h": ("#7a8652", None), "r": ("#9aa66a", None)})],
        "buildings": [(6, 7, 9), (8, 10, 10), (11, 12, 11)],
        "front": [
            ([
                "wwwwfwwwwwwwwwwfwwwwwwwwww",
                "wwwwwwwwwfwwwwwwwwwwwfwwww",
                "wwwwwwwwwwwwwwwwwwwwwwwwww",
            ], 1, 12, {"w": ("#3f86b8", None), "f": ("#e8f4fb", None)}),
            ([
                "p.p.p",
                ".ppp.",
                "p.t.p",
                "..t..",
                "..t..",
                "..t..",
                "..t..",
                "..t..",
                "..t..",
            ], 1, 3, {"p": ("#3f7a3a", None), "t": ("#7a5a3a", None)}),
        ],
    },
}


def mix(a, b, t):
    ca, cb = rgb(a), rgb(b)
    return tuple(round(ca[i] + (cb[i] - ca[i]) * t) for i in range(3)) + (255,)


def city_view(place, phase):
    """窓の外の街並みと名物（透明の上に。sky の上に重ねる）。東京は元の街並みと東京タワーのまま。"""
    c = SKY[phase]
    im = Image.new("RGBA", (WIN_W, WIN_H), (0, 0, 0, 0))
    put = lambda x, y, col: in_view(x, y) and im.putpixel((x, y), rgb(col) if isinstance(col, str) else col)
    spec = LANDMARKS[place]

    def color(day, lamp):
        if lamp and phase in ("twilight", "night"):
            return rgb(lamp)
        return mix(day, c["bld"][0], LIGHT_MIX[phase])

    def draw(parts):
        for rows, x0, y0, pal in parts:
            for dy, row in enumerate(rows):
                for dx, ch in enumerate(row):
                    if ch in pal:
                        put(x0 + dx, y0 + dy, color(*pal[ch]))

    def skyline(buildings):
        body_a, body_b, unlit, lit, p = c["bld"]
        lights = random.Random(f"lights-{phase}")
        for x0, x1, top in buildings:
            i = BUILDINGS.index((x0, x1, top)) if (x0, x1, top) in BUILDINGS else x0
            body = body_a if i % 2 == 0 else body_b
            for x in range(x0, x1 + 1):
                for y in range(top, WIN_H):
                    window = y > top and (y - top) % 2 == 0 and (x - x0) % 2 == 1 - (i % 2) and x < x1 + (i % 2)
                    col = body
                    if window:
                        col = lit if lights.random() < p else unlit
                    put(x, y, col)

    if spec.get("tokyo"):
        skyline(BUILDINGS)
        frame, deck = c["tower"]
        for x, y in TOWER["tip"] + TOWER["body"]:
            put(x, y, frame)
        for x, y in TOWER["deck"]:
            put(x, y, deck)
        if phase in ("night", "twilight"):
            put(22, 3, "#ff5040")  # てっぺんの赤い灯り
        return im
    draw(spec.get("back", []))
    front = spec.get("front", [])
    buildings = spec.get("buildings")
    if buildings is None:  # 名物と横に重ならない街並み
        spans = [(x0, x0 + max(len(r) for r in rows) - 1) for rows, x0, _y0, _pal in front]
        buildings = [b for b in BUILDINGS if not any(b[0] <= hi and lo <= b[1] for lo, hi in spans)]
    skyline(buildings)
    draw(front)
    if phase in ("night", "twilight"):
        for x, y in spec.get("beacons", []):
            put(x, y, "#ff5040")
    return im


def rain(frame):
    """雨（4 コマで 1 周。1 コマで 4 ドット落ちる）。長さ 3 の筋で、先が濃い。"""
    im = Image.new("RGBA", (WIN_W, WIN_H), (0, 0, 0, 0))
    rng = random.Random(11)
    for _ in range(22):
        x, y0 = rng.randrange(WIN_W), rng.randrange(WIN_H)
        for k, alpha in ((0, 100), (1, 170), (2, 235)):
            y = (y0 + frame * 4 + k) % WIN_H
            if in_view(x, y):
                im.putpixel((x, y), (235, 242, 255, alpha))
    return im


def snow(frame):
    """雪（8 コマで 1 周。1 コマで 2 ドット落ち、左右に少し揺れる）。"""
    im = Image.new("RGBA", (WIN_W, WIN_H), (0, 0, 0, 0))
    rng = random.Random(13)
    sway = [0, 0, 1, 1, 0, 0, -1, -1]
    for i in range(24):
        x0, y0 = rng.randrange(WIN_W), rng.randrange(WIN_H)
        x, y = (x0 + sway[(frame + i) % 8]) % WIN_W, (y0 + frame * 2) % WIN_H
        if in_view(x, y):
            im.putpixel((x, y), (255, 255, 255, 240))
    return im


def flash():
    """稲光: ガラス全体が白く光り、左に稲妻。"""
    im = Image.new("RGBA", (WIN_W, WIN_H), (0, 0, 0, 0))
    for y in range(WIN_H):
        for x in range(WIN_W):
            if in_view(x, y):
                im.putpixel((x, y), (255, 255, 255, 96))
    for x, y in [(9, 1), (8, 2), (8, 3), (7, 4), (8, 5), (7, 6), (7, 7), (6, 8), (6, 9), (6, 10), (5, 11)]:
        im.putpixel((x, y), (255, 248, 200, 255))
    return im


def window_view(phase, cover, *overlays, place="tokyo", slide=False):
    """窓 1 つ（空・その場所の街並みと名物・重ねるもの・窓枠。slide なら引き違いの窓、でなければ十字の桟）。見本用。"""
    im = sky(phase, cover)
    im.alpha_composite(city_view(place, phase))
    for o in overlays:
        im.alpha_composite(o)
    im.alpha_composite(window_frame_slide() if slide else window_frame())
    return im


def sky_preview():
    """窓の見本（絵の 1 ピクセル = 8px）: 行が時間帯、列が 晴れ・晴れ時々曇り・曇り・雨・雪・雷。"""
    cols = [("clear", ()), ("cloudy", ()), ("overcast", ()), ("overcast", (rain(0),)), ("overcast", (snow(0),)),
            ("overcast", (rain(1), flash()))]
    sheet = Image.new("RGBA", (4 + len(cols) * (WIN_W + 4), 4 + len(SKY) * (WIN_H + 4)), rgb("#f6ead2"))
    for r, phase in enumerate(SKY):
        for k, (cover, overlays) in enumerate(cols):
            sheet.alpha_composite(window_view(phase, cover, *overlays), (4 + k * (WIN_W + 4), 4 + r * (WIN_H + 4)))
    path = PREVIEW.parent / "sky-preview.png"
    sheet.resize((sheet.width * 8, sheet.height * 8), Image.NEAREST).save(path)
    print(f"preview -> {path.relative_to(ROOT)}")


def landmarks_preview():
    """名物の見本（絵の 1 ピクセル = 6px）: 場所ごとに、時間帯（昼・朝焼け・夕焼け・薄明・夜。晴れ）の窓を横に並べる。
    場所は 2 列に分ける。tmp/landmarks-preview.png"""
    from PIL import ImageDraw, ImageFont
    places = list(LANDMARKS)
    half = (len(places) + 1) // 2
    label = 34  # 場所の名前の幅（絵の px）
    cell_w, cell_h = WIN_W + 3, WIN_H + 3
    block = label + len(SKY) * cell_w
    sheet = Image.new("RGBA", (2 * block + 8, 4 + half * cell_h), rgb("#2a2d36"))
    for i, place in enumerate(places):
        x0 = (i // half) * (block + 8)
        y0 = 4 + (i % half) * cell_h
        for k, phase in enumerate(SKY):
            sheet.alpha_composite(window_view(phase, "clear", place=place, slide=True), (x0 + label + k * cell_w, y0))
    Z = 6
    big = sheet.resize((sheet.width * Z, sheet.height * Z), Image.NEAREST)
    d = ImageDraw.Draw(big)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 30)
    except OSError:
        font = ImageFont.load_default()
    for i, place in enumerate(places):
        x0 = (i // half) * (block + 8)
        y0 = 4 + (i % half) * cell_h
        d.text((x0 * Z + 12, (y0 + WIN_H / 2) * Z), place, font=font, fill="#e6e8ee", anchor="lm")
    path = PREVIEW.parent / "landmarks-preview.png"
    big.save(path)
    print(f"preview -> {path.relative_to(ROOT)}")


def up(im):
    return im.resize((im.width * SCALE, im.height * SCALE), Image.NEAREST)


def save(im, name, out=OUT):
    path = out / f"{name}.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    up(im).save(path, optimize=True)
    return path


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    n = 0
    import shutil
    for sub in ("char", "band", "sky", "view"):
        shutil.rmtree(OUT / sub, ignore_errors=True)
    for name, look in LOOKS.items():
        (h, H, j), (c, C) = look["hair"], look["shirt"]
        p = pal({"h": h, "H": H, "j": j, "c": c, "C": C})
        for pose, fn in POSES.items():
            save(fn(look)[0].image(p), f"char/{name}-{pose}")
            n += 1
        for pose, src in MIRRORED.items():
            save(POSES[src](look)[0].flipped().image(p), f"char/{name}-{pose}")
            n += 1
    plain = LOOKS["other"]  # 鉢巻きの輪郭は、小物のない体を基準にする
    for color, (d, f) in BANDS.items():
        p = pal({"d": d, "f": f})
        for pose, fn in POSES.items():
            save(headband(*fn(plain)).image(p), f"band/{color}-{pose}")
            n += 1
        for pose, src in MIRRORED.items():
            save(headband(*POSES[src](plain)).flipped().image(p), f"band/{color}-{pose}")
            n += 1
    for i in range(2):
        save(flame(i).image(pal()), f"fx-flame-{i}")
        n += 1
    p = pal()
    furniture = {
        "desk-l": desk_end(False), "desk-m": desk_mid(), "desk-r": desk_end(True),
        "laptop": Sprite(10, 9).blit(LAPTOP, 0, 0),
        "hands-a": hands("a"), "hands-b": hands("b"), "hands-rest": hands("rest"),
        "chair": Sprite(14, 9).blit(CHAIR, 0, 0).outline(),
        "hire-sign": Sprite(11, 11).blit(HIRE_SIGN, 0, 0),
        "plant": Sprite(12, 17).blit(PLANT, 0, 0).outline(),
        "clock-face": Sprite(13, 13).blit(CLOCK_FACE, 0, 0),
        "door": Sprite(16, 20).blit(DOOR, 0, 0).outline(),
        "bookshelf": bookshelf(), "bookshelf-empty": bookshelf(books=False), "whiteboard": whiteboard(),
        "whiteboard-plan": whiteboard_plan(),
        "bubble-alert": bubble("alert"), "bubble-ask": bubble("ask"), "bubble-done": bubble("done"),
        "bubble-talk": bubble("talk"),
    }
    for name, sp in furniture.items():
        save(sp.image(p), name)
        n += 1
    # 時計の針: 時針（短い）と分針（長い、5 分ごと）を 12 方向ずつ
    for i in range(12):
        save(clock_hand(i, 3).image(p), f"clock-h-{i}")
        save(clock_hand(i, 5).image(p), f"clock-m-{i}")
        n += 2
    # 空いた席（雇える席）の椅子は緑
    save(furniture["chair"].image(pal({"x": "#5fbf8a", "X": "#3f9a6a", "z": "#9fe6bd"})), "chair-free")
    n += 1
    save(floor_texture(), "floor")
    save(wall_texture(), "wall")
    save(hall_texture(), "hall")
    n += 3
    # modern のテーマの絵（低い壁・横の廊下の床・ガラスの壁の 1 枚・扉の枠・自動ドアの戸）
    modern = THEMES / "modern"
    save(wall_texture(h=30), "wall", modern)
    save(corridor_texture(), "corridor", modern)
    save(glass_tile(), "glass", modern)
    save(glass_door(), "glass-door", modern)
    save(glass_door_panel(), "glass-door-panel", modern)
    n += 5
    # classic（和風）のテーマの絵（長押と土壁・畳・縁側・板の縦の廊下・障子の壁の 1 枚・障子戸の枠・障子戸）
    classic = THEMES / "classic"
    save(plaster_wall(), "wall", classic)
    save(tatami_texture(), "tatami", classic)
    save(engawa_texture(), "engawa", classic)
    save(wood_hall_texture(), "hall", classic)
    save(shoji_tile(), "shoji", classic)
    save(shoji_door(), "shoji-door", classic)
    save(shoji_door_panel(), "shoji-door-panel", classic)
    n += 7
    # 窓: 枠（ガラスは透明）と、後ろに重ねる空（時間帯 x 空模様）・雨・雪・稲光
    save(window_frame(), "window")
    save(window_frame_slide(), "window-slide")
    save(window_frame_wood(), "window-wood")
    for phase in SKY:
        for cover in COVERS:
            save(sky(phase, cover), f"sky/{phase}-{cover}")
    for i in range(4):
        save(rain(i), f"sky/rain-{i}")
    for i in range(8):
        save(snow(i), f"sky/snow-{i}")
    save(flash(), "sky/flash")
    n += 3 + len(SKY) * len(COVERS) + 4 + 8 + 1
    for place in LANDMARKS:  # 場所ごとの街並みと名物（時間帯ごと）
        for phase in SKY:
            save(city_view(place, phase), f"view/{place}-{phase}")
            n += 1
    print(f"{n} images -> {OUT.relative_to(ROOT)}")
    preview(p, furniture)
    sky_preview()
    landmarks_preview()


def preview(p, furniture):
    """確認用（絵の 1 ピクセル = 4px）: 見た目 6 種と鉢巻き、ポーズ一覧、家具、部屋の見本。"""
    def char(name, pose, band=None):
        (h, H, j), (c, C) = LOOKS[name]["hair"], LOOKS[name]["shirt"]
        im = POSES[pose](LOOKS[name])[0].image(pal({"h": h, "H": H, "j": j, "c": c, "C": C}))
        if band:
            d, f = BANDS[band]
            im.alpha_composite(headband(*POSES[pose](LOOKS["other"])).image(pal({"d": d, "f": f})))
        return im

    sheet = Image.new("RGBA", (290, 300), rgb("#2a2d36"))
    x = 4
    for name in LOOKS:  # 1 行目: opus・sonnet・haiku・fable・codex・ほか
        sheet.alpha_composite(char(name, "stand"), (x, 4))
        x += 20
    x += 8
    for band in (None, "blue", "white", "red"):  # effort: low・medium・high・xhigh/max
        sheet.alpha_composite(char("claude-sonnet", "stand", band), (x, 4))
        x += 20
    x = 4
    for pose in POSES:  # 2 行目: ポーズ（opus・赤）
        sheet.alpha_composite(char("claude-opus", pose, "red"), (x, 32))
        x += 20
    x = 4
    free_chair = furniture["chair"].image(pal({"x": "#5fbf8a", "X": "#3f9a6a", "z": "#9fe6bd"}))
    for name in ("bookshelf", "whiteboard", "whiteboard-plan", "window", "door", "plant", "chair", "chair-free", "laptop", "hire-sign",
                 "clock-face", "bubble-alert", "bubble-ask", "bubble-done", "bubble-talk"):
        im = free_chair if name == "chair-free" else window_view("day", "clear") if name == "window" else furniture[name].image(p)
        sheet.alpha_composite(im, (x, 62))
        x += im.width + 4

    # 部屋の見本（既定の床と壁の絵で、手前の開いた部屋。テーマの glass が null のとき）: 幅 200、高さ 140。
    # 壁は高さ 36、奥の通路は足が y=54、机の奥の縁が y=74、手前の床は足が y=104..132
    room = Image.new("RGBA", (200, 140), (0, 0, 0, 0))
    room.alpha_composite(floor_texture().crop((0, 0, 200, 104)), (0, 36))
    room.alpha_composite(wall_texture().crop((0, 0, 200, 36)), (0, 0))
    room.alpha_composite(window_view("day", "clear"), (128, 6))
    for layer in (furniture["clock-face"], clock_hand(10, 3), clock_hand(2, 5)):  # 10:10
        room.alpha_composite(layer.image(p), (167, 8))
    room.alpha_composite(furniture["whiteboard"].image(p), (62, 7))
    room.alpha_composite(furniture["bookshelf"].image(p), (6, 14))
    put = lambda im, cx, feet: room.alpha_composite(im, (cx - 9, feet - 23))
    put(char("codex", "walk-r-0", "white"), 110, 54)  # 奥の通路を歩く Codex（high）
    put(char("claude-haiku", "read-0", "blue"), 22, 66)  # 本棚の前で読む haiku（medium）
    desk_x, back, seats = 48, 74, 3  # 机の左端、机の奥の縁、席の数（最後は空席）
    who = {0: ("claude-opus", "sit-0", "red", "hands-a"), 1: ("claude-fable", "sit-happy", None, "hands-rest")}
    for i in range(seats):
        cx = desk_x + 8 + i * 24 + 12
        if i == 0:  # max で作業中: 炎
            room.alpha_composite(flame(0).image(p), (cx - 14, back - 15))
        room.alpha_composite(furniture["chair"].image(p) if i in who else free_chair, (cx - 7, back - 9))
        if i in who:
            name, pose, band, _ = who[i]
            room.alpha_composite(char(name, pose, band), (cx - 9, back - 18))
        else:
            room.alpha_composite(furniture["hire-sign"].image(p), (cx - 5, back - 24))  # 空いた席の「＋」
    room.alpha_composite(furniture["desk-l"].image(p), (desk_x, back))
    for i in range(seats):
        room.alpha_composite(furniture["desk-m"].image(p), (desk_x + 8 + i * 24, back))
    room.alpha_composite(furniture["desk-r"].image(p), (desk_x + 8 + seats * 24, back))
    for i in range(seats):
        seg = desk_x + 8 + i * 24
        if i in who:  # 空いた席にはノート PC を置かない
            room.alpha_composite(furniture["laptop"].image(p), (seg + 7, back - 5))
            room.alpha_composite(furniture[who[i][3]].image(p), (seg, back))
    room.alpha_composite(furniture["bubble-done"].image(p), (desk_x + 8 + 24 + 6, back - 31))
    put(char("claude-sonnet", "raise-0", "white"), 150, 118)  # 手を挙げて待つ sonnet
    room.alpha_composite(furniture["bubble-ask"].image(p), (144, 118 - 36))
    room.alpha_composite(furniture["plant"].image(p), (182, 78))
    sheet.alpha_composite(room, (4, 100))
    PREVIEW.parent.mkdir(parents=True, exist_ok=True)
    sheet.resize((sheet.width * SCALE, sheet.height * SCALE), Image.NEAREST).save(PREVIEW)
    print(f"preview -> {PREVIEW.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
