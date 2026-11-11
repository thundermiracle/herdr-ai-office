# ドット絵を作る: uv run --with pillow scripts/build-art.py
# 絵は文字の格子で描き、外側の輪郭は自動で付ける。書き出すときに 4 倍に拡大する
# （mod では絵の 1 ピクセル = 2 論理 px で描くので、Retina では物理 1:1 になり、にじまない）。
# 出力: mods/ai-office/img/（mod が使う PNG）と tmp/art-preview.png（確認用の一覧と部屋の見本）
import random
from pathlib import Path
from PIL import Image

SCALE = 4
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "mods" / "ai-office" / "img"
PREVIEW = ROOT / "tmp" / "art-preview.png"


def rgb(s):
    s = s.lstrip("#")
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4)) + (255,)


# 全員に共通の色。h/H/j（髪）と c/C（服）は色違いごとに差し替える
BASE = {
    "o": "#3b2a2a",  # 輪郭
    "e": "#3b2a2a",  # 目
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
    "y": "#f3d36b",  # 本の帯
}
HAIRS = {
    "black": ("#3a3346", "#28222f", "#5d5572"),
    "brown": ("#8a5634", "#673d22", "#b27a4c"),
    "blond": ("#e5b94f", "#c08f2e", "#f7dc8a"),
    "red": ("#c24f37", "#922f22", "#e57a58"),
    "navy": ("#46549a", "#323d74", "#6d7cc0"),
    "silver": ("#c3c4d2", "#9c9db0", "#e7e8f2"),
}
# 服の色はエージェントの種類ごと（scene.js の shirtOf と合わせる）
SHIRTS = {
    "orange": ("#e8804e", "#bf5f37"),  # Claude Code
    "teal": ("#3fa7a3", "#2b7d7a"),  # Codex
    "violet": ("#8d6cc9", "#6a4fa6"),  # そのほか
}


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

EYES = {"open": [(3, 6), (3, 7), (8, 6), (8, 7)]}


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


def head(sprite, x0, y0, eye="open", side=False, mouth=None):
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


def stand(eye="open"):
    s = Sprite(CHAR_W, 22)
    head(s, 3, 2, eye)
    s.blit(TORSO_FRONT, 4, 12).blit(LEGS_FRONT, 4, 17)
    return s.outline()


def walk(frame):
    """右向きの歩き。0: 足を開いたコマ、1: 足をそろえて 1 ドット浮いたコマ。"""
    s = Sprite(CHAR_W, 22)
    up = 0 if frame == 0 else -1
    head(s, 3, 2 + up, side=True)
    s.blit(TORSO_SIDE_A if frame == 0 else TORSO_SIDE_B, 5, 12 + up)
    s.blit(LEGS_STRIDE if frame == 0 else LEGS_PASS, 5, 17 + up)
    return s.outline()


def read(frame):
    s = Sprite(CHAR_W, 22)
    head(s, 3, 2 + frame, "blink" if frame else "open")
    s.blit(TORSO_READ, 4, 12).blit(LEGS_FRONT, 4, 17)
    return s.outline()


def raise_hand(frame):
    s = Sprite(CHAR_W, 22)
    head(s, 3, 2, mouth="open")
    s.blit(TORSO_RAISE, 4, 12).blit(LEGS_FRONT, 4, 17)
    # 右手（見て右）を頭の横に上げる。frame 1 は少し外に振る
    x = 15 if frame == 0 else 16
    s.put(14, 12, "C")
    s.put(15, 11, "C")
    for y in range(5, 11):
        s.put(x, y, "C")
    s.put(x, 4, "s")
    s.put(x, 3, "s")
    return s.outline()


def sit(frame, eye="open"):
    """机の奥に座っている上半身。frame 1 はうなずく（頭が 1 ドット下がる）。"""
    s = Sprite(CHAR_W, 16)
    head(s, 3, 1 + frame, eye)
    s.blit(TORSO_SIT, 4, 12)
    return s.outline(bottom=False)


CHAR_POSES = {
    "stand": stand(),
    "blink": stand("blink"),
    "walk-r-0": walk(0),
    "walk-r-1": walk(1),
    "read-0": read(0),
    "read-1": read(1),
    "raise-0": raise_hand(0),
    "raise-1": raise_hand(1),
    "sit-0": sit(0),
    "sit-1": sit(1),
    "sit-happy": sit(0, "happy"),
}
CHAR_POSES["walk-l-0"] = CHAR_POSES["walk-r-0"].flipped()
CHAR_POSES["walk-l-1"] = CHAR_POSES["walk-r-1"].flipped()


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

WINDOW = grid("""
aaaaaaaaaaaaaaaaaaaaaaaaaaaa
aBAAAAAAAAAAAaaBAAAAAAAAAAAa
aABAAAAAAAAAAaaABAAAAAAAAAAa
aAABAAAAAaaaAaaAABAAAAAAAAAa
aAAABAAAaaaaaaaAAABAAAAAAAAa
aAAAABAAAAAAAaaAAAABAAAAAAAa
aAAAAABAAAAAAaaAAAAABAAAAAAa
aaaaaaaaaaaaaaaaaaaaaaaaaaaa
aaaaaaaaaaaaaaaaaaaaaaaaaaaa
aBAAAAAAAAAAAaaBAAAAAAAAAAAa
aABAAAAAAAAAAaaABAAAAAAAAAAa
aAABAAAAAAAAAaaAABAAAAAAAAAa
aAAABAAAAAAAAaaAAABAAAAAAAAa
aAAAABAAAAAAAaaAAAABAAAAAAAa
aCCCCCCCCCCCCaaCCCCCCCCCCCCa
aaaaaaaaaaaaaaaaaaaaaaaaaaaa
""")

# 時計（輪郭は自動にすると斜めが途切れるので、格子に描く）
CLOCK = grid("""
...ooooo...
..oaaaaao..
.oaaaoaaao.
oaaaaoaaaao
oaaaaoaaaao
oaaaaoooaao
oaaaaaaaaao
oaaaaaaaaao
.oaaaaaaao.
..oaaaaao..
...ooooo...
""")

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
}


def bubble(kind):
    s = Sprite(13, 14).blit(BUBBLE, 1, 1)
    rows, _ = MARKS[kind]
    s.blit(rows, 3, 2)
    return s.outline()


def bookshelf():
    """幅 32・高さ 42 の本棚。本の色と幅は毎回同じになるよう種を決めて散らす。"""
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
        while x < 29:
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


def wall_texture(w_tiles=32):
    """壁紙（縦じま）と、上の飾り縁、下の幅木。高さ 36。"""
    W, H = w_tiles * 16, 36
    im = Image.new("RGBA", (W, H), rgb("#f6ead2"))
    for x in range(W):
        for y in range(H):
            if y < 3:
                c = "#d8c09a" if y < 2 else "#c4a87e"
            elif y >= 31:
                c = {31: "#8a6040", 32: "#c08a5a", 33: "#b07a4c", 34: "#b07a4c", 35: "#8a6040"}[y]
            elif x % 8 in (0, 1):
                c = "#efe0c2"
            else:
                continue
            im.putpixel((x, y), rgb(c))
    return im


def up(im):
    return im.resize((im.width * SCALE, im.height * SCALE), Image.NEAREST)


def save(im, name):
    path = OUT / f"{name}.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    up(im).save(path, optimize=True)
    return path


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    n = 0
    for hair, (h, H, j) in HAIRS.items():
        for shirt, (c, C) in SHIRTS.items():
            p = pal({"h": h, "H": H, "j": j, "c": c, "C": C})
            for pose, sp in CHAR_POSES.items():
                save(sp.image(p), f"char/{hair}-{shirt}-{pose}")
                n += 1
    p = pal()
    furniture = {
        "desk-l": desk_end(False), "desk-m": desk_mid(), "desk-r": desk_end(True),
        "laptop": Sprite(10, 9).blit(LAPTOP, 0, 0),
        "hands-a": hands("a"), "hands-b": hands("b"), "hands-rest": hands("rest"),
        "chair": Sprite(14, 9).blit(CHAIR, 0, 0).outline(),
        "hire-sign": Sprite(11, 11).blit(HIRE_SIGN, 0, 0),
        "plant": Sprite(12, 17).blit(PLANT, 0, 0).outline(),
        "window": Sprite(28, 16).blit(WINDOW, 0, 0).outline(),
        "clock": Sprite(11, 11).blit(CLOCK, 0, 0),
        "door": Sprite(16, 20).blit(DOOR, 0, 0).outline(),
        "bookshelf": bookshelf(), "whiteboard": whiteboard(),
        "bubble-alert": bubble("alert"), "bubble-ask": bubble("ask"), "bubble-done": bubble("done"),
    }
    for name, sp in furniture.items():
        save(sp.image(p), name)
        n += 1
    # 空いた席（雇える席）の椅子は緑
    save(furniture["chair"].image(pal({"x": "#5fbf8a", "X": "#3f9a6a", "z": "#9fe6bd"})), "chair-free")
    n += 1
    save(floor_texture(), "floor")
    save(wall_texture(), "wall")
    n += 2
    print(f"{n} images -> {OUT.relative_to(ROOT)}")
    preview(p, furniture)


def preview(p, furniture):
    """確認用: 1 人ぶんのポーズ一覧、家具、部屋の見本を 1 枚に並べる（絵の 1 ピクセル = 4px）。"""
    var = pal({"h": HAIRS["brown"][0], "H": HAIRS["brown"][1], "j": HAIRS["brown"][2],
               "c": SHIRTS["orange"][0], "C": SHIRTS["orange"][1]})
    var2 = pal({"h": HAIRS["navy"][0], "H": HAIRS["navy"][1], "j": HAIRS["navy"][2],
                "c": SHIRTS["teal"][0], "C": SHIRTS["teal"][1]})
    var3 = pal({"h": HAIRS["blond"][0], "H": HAIRS["blond"][1], "j": HAIRS["blond"][2],
                "c": SHIRTS["violet"][0], "C": SHIRTS["violet"][1]})
    sheet = Image.new("RGBA", (260, 240), rgb("#2a2d36"))
    x = 4
    for pose, sp in CHAR_POSES.items():
        sheet.alpha_composite(sp.image(var), (x, 4))
        x += 20
    x = 4
    free_chair = furniture["chair"].image(pal({"x": "#5fbf8a", "X": "#3f9a6a", "z": "#9fe6bd"}))
    for name in ("bookshelf", "whiteboard", "window", "door", "plant", "chair", "chair-free", "laptop", "hire-sign",
                 "clock", "bubble-alert", "bubble-ask", "bubble-done"):
        im = free_chair if name == "chair-free" else furniture[name].image(p)
        sheet.alpha_composite(im, (x, 32))
        x += im.width + 4

    # 部屋の見本（scene.js の寸法の下書き）: 幅 200、高さ 140。
    # 壁は高さ 36、奥の通路は足が y=50、机の奥の縁が y=74、手前の床は足が y=100..132
    room = Image.new("RGBA", (200, 140), (0, 0, 0, 0))
    room.alpha_composite(floor_texture().crop((0, 0, 200, 104)), (0, 36))
    room.alpha_composite(wall_texture().crop((0, 0, 200, 36)), (0, 0))
    room.alpha_composite(furniture["window"].image(p), (128, 6))
    room.alpha_composite(furniture["clock"].image(p), (168, 9))
    room.alpha_composite(furniture["whiteboard"].image(p), (62, 7))
    room.alpha_composite(furniture["bookshelf"].image(p), (6, 14))
    put = lambda im, cx, feet: room.alpha_composite(im, (cx - 9, feet - 21))
    put(CHAR_POSES["walk-r-0"].image(var2), 110, 50)  # 奥の通路を歩く人
    put(CHAR_POSES["read-0"].image(var3), 22, 62)  # 本棚の前で読む人
    desk_x, back, seats = 48, 74, 3  # 机の左端、机の奥の縁、席の数（最後は空席）
    who = {0: (CHAR_POSES["sit-0"], var, "hands-a"), 1: (CHAR_POSES["sit-happy"], var3, "hands-rest")}
    for i in range(seats):
        cx = desk_x + 8 + i * 24 + 12
        room.alpha_composite(furniture["chair"].image(p) if i in who else free_chair, (cx - 7, back - 9))
        if i in who:
            room.alpha_composite(who[i][0].image(who[i][1]), (cx - 9, back - 16))
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
            room.alpha_composite(furniture[who[i][2]].image(p), (seg, back))
    room.alpha_composite(furniture["bubble-done"].image(p), (desk_x + 8 + 24 + 12, back - 30))
    put(CHAR_POSES["raise-0"].image(var2), 150, 118)  # 手を挙げて待つ人
    room.alpha_composite(furniture["bubble-alert"].image(p), (152, 118 - 21 - 13))
    room.alpha_composite(furniture["plant"].image(p), (182, 78))
    sheet.alpha_composite(room, (4, 80))
    PREVIEW.parent.mkdir(parents=True, exist_ok=True)
    sheet.resize((sheet.width * SCALE, sheet.height * SCALE), Image.NEAREST).save(PREVIEW)
    print(f"preview -> {PREVIEW.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
