"""Close-up comparison: the same 150 x 100 mm area of the original and the new design.

usage: closeup.py PHOTO OUT X0 Y0 BG_A [BG_B]
"""
import pickle
import sys

from PIL import Image, ImageDraw, ImageFont

from board import BOARD_H, BOARD_W
from render import cut_view, render, to_pil

PHOTO, OUT = sys.argv[1], sys.argv[2]
X0, Y0 = float(sys.argv[3]), float(sys.argv[4])
BGS = sys.argv[5:]
WIN = (X0, Y0, X0 + 150, Y0 + 100)
PPM = 8

vp, vk, vl = pickle.load(open("data/verse.pkl", "rb"))

ph = Image.open(PHOTO).convert("RGB")
W, H = ph.size
sx, sy = W / BOARD_W, H / BOARD_H
crop = ph.crop((X0 * sx, Y0 * sy, (X0 + 150) * sx, (Y0 + 100) * sy)).resize((150 * PPM, 100 * PPM), Image.LANCZOS)


def font(sz):
    for f in ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]:
        try:
            return ImageFont.truetype(f, sz)
        except OSError:
            pass
    return ImageFont.load_default()


labels = {0: "NEW A  - one layer, all letters 34 mm", 1: "NEW B  - same, plus small letters in the gaps"}
panels = [(crop, "YOUR ORIGINAL  (same 15 x 10 cm area, same scale)")]
last = None
for i, f in enumerate(BGS):
    bg = pickle.load(open(f, "rb"))
    bgp = [p for w in bg for p in w["pieces"]]
    panels.append((to_pil(render(bgp, vp, WIN, ppm=PPM, photo=PHOTO)), labels.get(i, f) if len(BGS) > 1 else "NEW  - preview"))
    last = bgp
panels.append((cut_view(last, vp, WIN, ppm=PPM), "CUT PIECES%s  (each colour = 1 piece, blue = verse)" % (" of B" if len(BGS) > 1 else "")))

F = font(34)
Fs = font(26)
pw, ph_ = 150 * PPM, 100 * PPM
lab = 56
out = Image.new("RGB", (pw + 40, len(panels) * (ph_ + lab) + 70), (24, 24, 24))
d = ImageDraw.Draw(out)
y = 10
for im, t in panels:
    d.text((22, y + 10), t, fill=(240, 240, 240), font=F)
    out.paste(im, (20, y + lab))
    y += ph_ + lab
d.rectangle([20, y + 18, 20 + 50 * PPM, y + 30], fill=(240, 240, 240))
d.text((30 + 50 * PPM, y + 8), "5 cm", fill=(240, 240, 240), font=Fs)
out.save(OUT, quality=90)
print("saved", OUT, out.size)
