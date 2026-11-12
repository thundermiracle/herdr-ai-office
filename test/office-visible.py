# herdr-app shot の画面に、オフィス（床の色 #e6c48f あたり）が見えているか: yes / no と、見つかった点の数。
# Office パネルの開け閉めはファイルに残らない（layouts/.state は大きさだけ）ので、確かめる前にこれで見る:
#   herdr-app shot /tmp/s.png && uv run --with pillow test/office-visible.py /tmp/s.png
# Herdr の窓が隠れていると shot は古い画面のままなので、前に出してから撮る
import sys
from PIL import Image

im = Image.open(sys.argv[1]).convert("RGB")
w, h = im.size
small = im.crop((int(w * 0.55), 0, w, h)).resize((300, 400))
n = sum(1 for p in small.get_flattened_data() if abs(p[0] - 230) < 14 and abs(p[1] - 196) < 14 and abs(p[2] - 143) < 16)
print("yes" if n > 800 else "no", n)
