"""Build the laser files, previews and assembly map for one finished layout.

usage: build.py BACKGROUND.pkl OUTDIR PHOTO
"""
import os
import pickle
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from shapely import affinity
from shapely.geometry import box
from shapely.ops import unary_union

from board import BOARD_H, BOARD_W, rugs
from export import (BLUE, add_spacers, label_block, sheet_png, support, text_rings, write_dxf, write_svg)
from fontgeom import polys
from render import cut_view, render, to_pil
from sheets import MARGIN, NOTCH, SHEET, USE, nest_extras, plan, to_sheet
from verify import check

BG, OUT, PHOTO = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(OUT, exist_ok=True)
bg = pickle.load(open(BG, "rb"))
vp, vk, vl = pickle.load(open("data/verse.pkl", "rb"))

# 1. hidden spacers so every verse piece sits level on wood
n_sp = add_spacers(bg, vp)
sup = support(bg, vp)
print(f"spacers {n_sp}; verse support min {min(sup):.0%}, median {np.median(sup):.0%}")

# 2. exact vector checks
problems, stats = check(bg, vp, verbose=False)
problems = [p for p in problems if "supported" not in p]
print("check:", stats, "problems:", problems)
if problems:
    sys.exit("geometry problems - not exporting")

# 3. sheets
P = plan(bg, vp)
pieces = P["pieces"]
A, B = P["A"], P["B"]
print(f"window A x={P['xa']:.0f}, window B x={P['xb']:.0f}; A {len(P['sheetA'])} pieces, "
      f"B {len(P['sheetB'])}, edge pieces {len(P['extras'])}")
Apieces = unary_union([pieces[i] for i in P["sheetA"]])
Bpieces = unary_union([pieces[i] for i in P["sheetB"]])
# sheet-2 stencil: only the area around its own pieces; where it meets sheet-1
# letters its edge hugs them (that is what locks it in place)
stB_full = B.difference(Apieces.buffer(NOTCH)).buffer(0.6).buffer(-0.6)
parts = [q for q in polys(stB_full) if any(q.buffer(1e-6).contains(pieces[i]) for i in P["sheetB"])]
stB = unary_union(parts)
print("sheet-2 stencil parts:", len(parts), [round(q.area) for q in parts])
lost = [i for i in P["sheetB"] if not stB.buffer(1e-6).contains(pieces[i])]
if lost:
    print("WARNING sheet-2 pieces outside its stencil:", len(lost))
summary = {}
sideA = "LEFT" if P["xa"] < P["xb"] else "RIGHT"
sideB = "RIGHT" if sideA == "LEFT" else "LEFT"

sheets = []
# sheet 1 ---------------------------------------------------------------
cut1 = [to_sheet(pieces[i], A) for i in P["sheetA"]]
st1 = to_sheet(A, A)
free1 = st1.buffer(-1.0).difference(unary_union(cut1).buffer(2.5))
lab1, used = label_block(["SHEET 1 OF 3", f"BACKGROUND TOP-{sideA}", "^ TOP EDGE = BOARD TOP",
                          f"LEFT EDGE {P['xa']:.0f} MM", "FROM BOARD LEFT"], free1, h=3.0, prefer=(10, 150))
assert used is not None, "no room for sheet-1 label"
sheets.append((f"sheet1_background_top_{sideA.lower()}", cut1, st1, lab1))
# sheet 2 ---------------------------------------------------------------
cut2 = [to_sheet(pieces[i], B) for i in P["sheetB"]]
st2 = to_sheet(stB, B)
free2 = st2.buffer(-1.0).difference(unary_union(cut2).buffer(2.5))
lab2, used = label_block(["SHEET 2 OF 3", f"BACKGROUND BOTTOM-{sideB}", "BOTTOM EDGE = BOARD BOTTOM",
                          f"LEFT EDGE {P['xb']:.0f} MM", "FROM BOARD LEFT"], free2, h=3.0, prefer=(250, 280))
assert used is not None, "no room for sheet-2 label"
sheets.append((f"sheet2_background_bottom_{sideB.lower()}", cut2, st2, lab2))
# sheet 3: verse in place + edge pieces nested -------------------------
vr = P["verse_rect"]
cut3v = [to_sheet(p, vr) for p in vp]
st3 = to_sheet(vr, vr)
vb = vr.bounds
usable = box(MARGIN, MARGIN, SHEET - MARGIN, SHEET - MARGIN)
free3 = usable.difference(st3.buffer(3.0))
extras = [pieces[i] for i in P["extras"]]
nest = nest_extras(extras, free3.buffer(-1.0))
cut3e, lab3 = [], []
failed = [n for n in nest if n[2] is None]
taken = unary_union([n[2] for n in nest if n[2] is not None] + [st3]) if nest else st3
for k, (p, ang, t) in enumerate([n for n in nest if n[2] is not None], 1):
    cut3e.append(t)
    fr = free3.difference(taken.buffer(1.5))
    r, used = label_block([f"{k}"], fr, h=3.0, prefer=(t.centroid.x, t.centroid.y))
    if used is not None:
        lab3 += r
        taken = taken.union(used)
fr = free3.difference(taken.buffer(1.5))
info, _ = label_block(["SHEET 3 OF 3", "VERSE + EDGE PIECES",
                       f"VERSE STENCIL TOP-LEFT:", f"{vb[0]:.0f} MM FROM LEFT,",
                       f"{vb[1]:.0f} MM FROM TOP", "NUMBERS: SEE MAP"], fr, h=3.0)
lab3 += info
sheets.append(("sheet3_verse_and_edge_pieces", cut3v + cut3e, st3, lab3))
print("edge pieces nested:", len(cut3e), "not nested:", len(failed))
if failed:
    sys.exit("some edge pieces did not fit on sheet 3")

# 4. write files + render-back checks ------------------------------------
for name, cut, st, lab in sheets:
    write_svg(os.path.join(OUT, name + ".svg"), cut, st, lab, title=name)
    write_dxf(os.path.join(OUT, name + ".dxf"), cut, st, lab)
    sheet_png(os.path.join(OUT, name + "_check.png"), cut, st, lab)
    # checks on what was written: inside sheet margin, no two cut pieces closer than 1.5 mm
    U = box(MARGIN - 0.01, MARGIN - 0.01, SHEET - MARGIN + 0.01, SHEET - MARGIN + 0.01)
    bad_out = sum(1 for p in cut if not U.contains(p))
    dmin = 1e9
    for i in range(len(cut)):
        for j in range(i + 1, len(cut)):
            if cut[i].distance(cut[j]) < 3:
                dmin = min(dmin, cut[i].distance(cut[j]))
    lab_hits = sum(1 for r in lab for p in cut if box(*np.r_[np.min(r, 0), np.max(r, 0)]).intersects(p))
    summary[name] = dict(pieces=len(cut), outside=bad_out, min_gap=round(dmin, 2), label_hits=lab_hits)
    print(name, summary[name])

# 5. previews ---------------------------------------------------------------
bgp = [p for w in bg for p in w["pieces"] if w["kind"] != "spacer"]
img = render(bgp, vp, (0, 0, BOARD_W, BOARD_H), ppm=4, photo=PHOTO)
to_pil(img).save(os.path.join(OUT, "preview_full_board.jpg"), quality=92)
cut_view(bgp, vp, (0, 0, BOARD_W, BOARD_H), ppm=3).save(os.path.join(OUT, "cut_pieces_full_board.png"))

# 6. assembly map ------------------------------------------------------------
sc = 2.0
W, H = int(BOARD_W * sc) + 40, int(BOARD_H * sc) + 40 + 330
im = Image.new("RGB", (W, H), "white")
dr = ImageDraw.Draw(im)
tf = lambda x, y: (20 + x * sc, 20 + y * sc)
F = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 15)
Fb = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 16)
L, R = rugs()
for g in (L, R):
    for p in polys(g.intersection(box(0, 0, BOARD_W, BOARD_H))):
        dr.polygon([tf(*c) for c in p.exterior.coords], fill=(236, 228, 214))
dr.rectangle([tf(0, 0), tf(BOARD_W, BOARD_H)], outline=(0, 0, 0), width=2)
cols = {"A": (120, 190, 120), "B": (110, 160, 220), "E": (240, 150, 60), "K": (190, 190, 190)}
for i, p in enumerate(pieces):
    c = cols["A"] if i in P["sheetA"] else cols["B"] if i in P["sheetB"] else cols["E"]
    for q in polys(p):
        dr.polygon([tf(*xy) for xy in q.exterior.coords], fill=c)
for p in vp:
    for q in polys(p):
        dr.line([tf(*xy) for xy in q.exterior.coords], fill=(60, 60, 60), width=2)
for rect, col, txt, anchor in ((A, (0, 140, 0), "SHEET 1", "tl"), (B, (0, 80, 200), "SHEET 2", "br"),
                               (vr, (80, 80, 80), "SHEET 3 (verse)", "tl")):
    x0, y0, x1, y1 = rect.bounds
    dr.rectangle([tf(x0, y0), tf(x1, y1)], outline=col, width=3)
    pos = tf(x0 + 3, y0 + 3) if anchor == "tl" else tf(x1 - 60, y1 - 12)
    dr.text(pos, txt, fill=col, font=Fb)
for k, (p, ang, t) in enumerate([n for n in nest if n[2] is not None], 1):
    x0_, y0_, x1_, y1_ = p.bounds
    lx, ly = tf(x1_ + 1, y0_ - 2)
    dr.ellipse([lx - 2, ly - 1, lx + 18, ly + 19], fill=(255, 255, 255), outline=(200, 90, 0))
    dr.text((lx + 3, ly + 1), str(k), fill=(0, 0, 0), font=Fb)
dr.text(tf(P["xa"], -9), f"<- {P['xa']:.0f} mm ->", fill=(0, 140, 0), font=F)
y = 20 + BOARD_H * sc + 18
steps = [
    "ASSEMBLY (board painted brown first)",
    f"1. Sheet 1 stencil: its top edge on the board's top edge, its left edge {P['xa']:.0f} mm from the board's left edge.",
    "   Tape it down, glue each green piece into its own hole, lift the stencil off.",
    f"2. Sheet 2 stencil: bottom edge on the board's bottom edge, left edge {P['xb']:.0f} mm from the left;",
    "   its cut edge hugs the sheet-1 letters, so it can only sit one way. Glue the blue pieces, lift it off.",
    f"3. Orange edge pieces 1-{len(cut3e)} (sheet 3): place by this map, 2 mm from their neighbours.",
    "4. Glue the rug pieces, trimming the frayed edge to meet the letters.",
    f"5. Verse stencil (sheet 3) on top of the brown layer: top-left corner {vb[0]:.0f} mm from the left, {vb[1]:.0f} mm from the top.",
    "   Hidden spacers (sheet 1/2, under the verse) go in with their sheet; the verse pieces sit on them.",
]
for k, s in enumerate(steps):
    dr.text((20, y + k * 24), s, fill=(0, 0, 0), font=Fb if k == 0 else F)
dr.rectangle([20, H - 34, 34, H - 20], fill=cols["A"]); dr.text((40, H - 36), "sheet 1", fill=(0, 0, 0), font=F)
dr.rectangle([130, H - 34, 144, H - 20], fill=cols["B"]); dr.text((150, H - 36), "sheet 2", fill=(0, 0, 0), font=F)
dr.rectangle([240, H - 34, 254, H - 20], fill=cols["E"]); dr.text((260, H - 36), "sheet 3 edge pieces", fill=(0, 0, 0), font=F)
im.save(os.path.join(OUT, "assembly_map.png"))
pickle.dump(dict(bg=bg, plan={k: v for k, v in P.items() if k in ("xa", "xb", "sheetA", "sheetB", "extras")},
                 summary=summary), open(os.path.join(OUT, "build_info.pkl"), "wb"))
print("done ->", OUT)

# 7. one-page overview of the three sheets + instructions + zip ------------------
ims = [Image.open(os.path.join(OUT, n + "_check.png")) for n, *_ in sheets]
s = ims[0].size[0]
ov = Image.new("RGB", (3 * s + 80, s + 90), "white")
d2 = ImageDraw.Draw(ov)
Fh = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 34)
for k, (im_, (n, *_)) in enumerate(zip(ims, sheets)):
    ov.paste(im_, (20 + k * (s + 20), 70))
    d2.text((20 + k * (s + 20), 15), f"SHEET {k + 1}: " + [f"background top-{sideA.lower()}", f"background bottom-{sideB.lower()}", "verse + edge pieces"][k],
            fill=(0, 0, 0), font=Fh)
ov.save(os.path.join(OUT, "sheets_overview.png"))
for n, *_ in sheets:
    os.remove(os.path.join(OUT, n + "_check.png"))
open(os.path.join(OUT, "READ_ME.txt"), "w").write(f"""FAADHKURUNI ADHKURKUM - laser files
Board: 680 x 324 mm visible.  Material: 3 x 12in (304.8 mm) sheets of 3 mm plywood.

COLOURS (one layer each in LightBurn / Creality software)
  BLACK = cut through - all pieces. Turn on "cut inner shapes first".
  BLUE  = cut through, LAST - the stencil outline (frees the leftover sheet).
  RED   = light score only - labels on the leftover/stencil, never on a piece.
Files are true size in mm (SVG and DXF are identical).

SHEETS
  {sheets[0][0]:<34}{len(P['sheetA'])} pieces, cut in place: the leftover sheet is the stencil.
  {sheets[1][0]:<34}{len(P['sheetB'])} pieces, cut in place; its stencil edge hugs the sheet-1 letters.
  sheet3_verse_and_edge_pieces      {len(vp)} verse pieces in place (leftover = verse stencil)
                                    + {len(cut3e)} numbered background edge pieces.
  Hidden spacers ({n_sp}) are part of sheets 1/2: they sit under the verse so every verse piece is supported.

ORDER
  1. Paint the board. Stencil 1: top edge on the board's top edge, left edge {P['xa']:.0f} mm from the left edge.
     Glue each piece into its own hole, lift the stencil.
  2. Stencil 2: bottom edge on the board's bottom edge (left edge {P['xb']:.0f} mm from the left);
     it locks against the sheet-1 letters. Glue, lift.
  3. Edge pieces 1-{len(cut3e)}: see assembly_map.png.
  4. Rug pieces (trim the frayed edge to meet the letters).
  5. Verse stencil on top of the brown layer: top-left corner {vb[0]:.0f} mm from the left, {vb[1]:.0f} mm from the top.
     Glue the verse pieces (paint silver first).

Checks run on the exact cut lines: no piece merges, nothing crosses the board or rug edge,
smallest gap between pieces {stats['min_gap']:.1f} mm, verse supported >= {min(sup):.0%} of its area.
""")
import zipfile
with zipfile.ZipFile(os.path.join(OUT, "laser_files.zip"), "w", zipfile.ZIP_DEFLATED) as z:
    for f in sorted(os.listdir(OUT)):
        if f.endswith((".svg", ".dxf", ".txt", ".png", ".jpg")):
            z.write(os.path.join(OUT, f), f)
print("packaged", sorted(os.listdir(OUT)))
