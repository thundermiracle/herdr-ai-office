# スパイク用の画像を作る: uv run --with pillow spike/make-assets.py
# - anim.gif / anim.webp: 4 コマ、各 400ms。コマごとに背景色と数字が違うので、2 枚のショットで進んだか分かる
# - check-1x/2x/4x.png: 同じ 16px の市松模様を 1・2・4 倍で。画面では同じ大きさに描いて、にじみを比べる
# - frame-a.png / frame-b.png: 静止画 2 枚（opacity の loop でコマを切り替える代わりの方法を試す）
from pathlib import Path
from PIL import Image

OUT = Path(__file__).parent / "ai-office-spike" / "img"
OUT.mkdir(parents=True, exist_ok=True)

# 3x5 の数字
DIGITS = {
    "1": ["010", "110", "010", "010", "111"],
    "2": ["111", "001", "111", "100", "111"],
    "3": ["111", "001", "111", "001", "111"],
    "4": ["101", "101", "111", "001", "001"],
    "A": ["010", "101", "111", "101", "101"],
    "B": ["110", "101", "110", "101", "110"],
}


def glyph_tile(ch, bg, fg=(255, 255, 255, 255), size=16):
    """16px の角が透明なタイルに、3x5 の文字を 2 倍で描く。"""
    im = Image.new("RGBA", (size, size), bg)
    for x, y in [(0, 0), (size - 1, 0), (0, size - 1), (size - 1, size - 1)]:
        im.putpixel((x, y), (0, 0, 0, 0))
    rows = DIGITS[ch]
    ox, oy = (size - 6) // 2, (size - 10) // 2
    for r, row in enumerate(rows):
        for c, bit in enumerate(row):
            if bit == "1":
                for dx in range(2):
                    for dy in range(2):
                        im.putpixel((ox + c * 2 + dx, oy + r * 2 + dy), fg)
    return im


def up(im, k):
    return im.resize((im.width * k, im.height * k), Image.NEAREST)


colors = [(220, 60, 60, 255), (60, 170, 80, 255), (60, 100, 220, 255), (230, 180, 40, 255)]
frames = [up(glyph_tile(str(i + 1), c), 4) for i, c in enumerate(colors)]

frames[0].save(OUT / "anim.webp", save_all=True, append_images=frames[1:], duration=400, loop=0, lossless=True)

# GIF は透明が 1 ビット。パレットに変えて、透明の色を 1 つ決める
gif_frames = []
for f in frames:
    rgb = Image.new("RGB", f.size, (255, 0, 255))
    rgb.paste(f, mask=f.split()[3])
    q = rgb.quantize(colors=16)
    # マゼンタ（透明にした角）の番号を探して透明にする
    palette = q.getpalette()
    idx = next(i for i in range(len(palette) // 3) if palette[i * 3:i * 3 + 3] == [255, 0, 255])
    q.info["transparency"] = idx
    gif_frames.append(q)
gif_frames[0].save(OUT / "anim.gif", save_all=True, append_images=gif_frames[1:], duration=400, loop=0,
                   disposal=2, transparency=gif_frames[0].info["transparency"])

# 市松模様（1px ごと）と、まわりの枠
check = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
for y in range(16):
    for x in range(16):
        if x in (0, 15) or y in (0, 15):
            check.putpixel((x, y), (255, 255, 255, 255))
        elif (x + y) % 2 == 0:
            check.putpixel((x, y), (240, 120, 40, 255))
        else:
            check.putpixel((x, y), (30, 30, 60, 255))
check.save(OUT / "check-1x.png")
up(check, 2).save(OUT / "check-2x.png")
up(check, 4).save(OUT / "check-4x.png")

up(glyph_tile("A", (60, 100, 220, 255)), 4).save(OUT / "frame-a.png")
up(glyph_tile("B", (230, 120, 40, 255)), 4).save(OUT / "frame-b.png")

for p in sorted(OUT.iterdir()):
    print(p.name, p.stat().st_size)
