"""Trace a calligraphy image into separate laser-cut pieces, fitted to a square board.

usage: trace_text.py IMAGE OUT.svg BOARD_MM MIN_WIDTH_MM LABEL
Two lines: the image is split at its widest word gap near the middle.
"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from shapely import affinity
from shapely.geometry import box
from shapely.ops import unary_union
import export
from export import write_svg, write_dxf, sheet_png, text_rings
from fontgeom import polys, fill_small_holes
from rasterops import mask_to_polys, enforce_min_width

IMG, OUT, BOARD, WMIN, LABEL = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4]), sys.argv[5]
MARGIN, SMARG, GAP_MIN, LINE_GAP = 3.0, 2.5, 1.6, 6.0

g = np.asarray(Image.open(IMG).convert("L")).astype(float)
ink = g < 128
lab, n = ndi.label(ink, structure=np.ones((3, 3)))
comps = [i for i in range(1, n + 1) if (lab == i).sum() >= 40]
xs = np.nonzero(np.isin(lab, comps))[1]
# split into two lines at the empty-column run nearest the middle
col = np.isin(lab, comps).sum(0)
runs, s0 = [], None
for x in range(xs.min(), xs.max() + 1):
    if col[x] == 0 and s0 is None:
        s0 = x
    if col[x] > 0 and s0 is not None:
        if x - s0 > 8:
            runs.append((s0 + x) / 2)
        s0 = None
mid = (xs.min() + xs.max()) / 2
split = min(runs, key=lambda r: abs(r - mid))


def trace(i):
    m = lab == i
    ys_, xs_ = np.nonzero(m)
    y0, y1, x0, x1 = ys_.min() - 3, ys_.max() + 4, xs_.min() - 3, xs_.max() + 4
    sub = m[y0:y1, x0:x1].astype(float)
    up = ndi.zoom(ndi.gaussian_filter(sub, 0.9), 3, order=1) > 0.5        # smooth, 3x finer
    return [affinity.translate(p, x0 - 0.5, y0 - 0.5) for p in mask_to_polys(up, 1 / 3, (0, 0))], xs_.mean()


lines = {1: [], 2: []}
for i in comps:
    ps, cx = trace(i)
    lines[1 if cx > split else 2] += ps          # Arabic: right half is the first line
# scale so two stacked lines fit the board
avail = BOARD - 2 * MARGIN - 2 * SMARG
b1, b2 = unary_union(lines[1]).bounds, unary_union(lines[2]).bounds
wpx = max(b1[2] - b1[0], b2[2] - b2[0])
hpx = (b1[3] - b1[1]) + (b2[3] - b2[1])
s = min(avail / wpx, (avail - LINE_GAP - 8.0) / hpx)          # 8 mm kept for the label
placed = []
y = MARGIN + SMARG
for k in (1, 2):
    b = unary_union(lines[k]).bounds
    w = (b[2] - b[0]) * s
    xoff = MARGIN + SMARG + (avail - w) / 2
    for p in lines[k]:
        q = affinity.scale(affinity.translate(p, -b[0], -b[1]), s, s, origin=(0, 0))
        placed.append(affinity.translate(q, xoff, y))
    y += (b[3] - b[1]) * s + LINE_GAP
# cuttable: every stroke >= WMIN, tiny counters filled. Dots (and the joined double
# dots this calligraphy uses) keep their crisp diamond shape: they are already wide,
# so they only get a closing that thickens the waist between the two diamonds.
pieces = []
for p in placed:
    p = p.simplify(0.03)
    w = np.asarray(p.minimum_rotated_rectangle.exterior.coords)
    ex = sorted(np.hypot(*np.diff(w[:3], axis=0).T))
    dot = ex[1] <= 15.0 and ex[0] >= 3.5 and p.area / p.convex_hull.area >= 0.7
    q = p.buffer(0.8).buffer(-0.8) if dot else enforce_min_width(p, WMIN)
    for r in polys(q):
        if r.area > 1.0:
            pieces.append(fill_small_holes(r, 3.0, 1.6))

# keep every piece >= GAP_MIN from every other: nudge small marks (8 directions,
# smallest move first); if a contact remains, trim the smaller piece locally
def others_of(i):
    return unary_union([q for j, q in enumerate(pieces) if j != i])
big = max(p.area for p in pieces)
moves = sorted({(dx * 0.2 * k, dy * 0.2 * k) for k in range(1, 16) for dx, dy in
                ((0, -1), (0, 1), (-1, 0), (1, 0), (-1, -1), (1, -1), (-1, 1), (1, 1))}, key=lambda v: abs(v[0]) + abs(v[1]))
for it in range(3):
    for i, p in enumerate(pieces):
        o = others_of(i)
        if p.distance(o) >= GAP_MIN:
            continue
        if p.area < 0.15 * big:
            for dx, dy in moves:
                t = affinity.translate(p, dx, dy)
                if t.distance(o) >= GAP_MIN:
                    pieces[i] = t
                    break
for i in range(len(pieces)):
    for j in range(len(pieces)):
        if i != j and pieces[i].area <= pieces[j].area and pieces[i].distance(pieces[j]) < GAP_MIN:
            q = pieces[i].difference(pieces[j].buffer(GAP_MIN)).buffer(-0.3).buffer(0.3)
            pieces[i] = max(polys(q), key=lambda r: r.area)
# fit inside the usable square again (moves can push marks outward)
U = BOARD - 2 * (MARGIN + SMARG)
bb = unary_union(pieces).bounds
k = min(1.0, U / (bb[2] - bb[0]), (U - 8.0) / (bb[3] - bb[1]))
cx, cy = (bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2
pieces = [affinity.scale(p, k, k, origin=(cx, cy)) for p in pieces]
bb = unary_union(pieces).bounds
pieces = [affinity.translate(p, MARGIN + SMARG + (U - (bb[2] - bb[0])) / 2 - bb[0], MARGIN + SMARG - bb[1]) for p in pieces]
stencil = unary_union(pieces).envelope.buffer(SMARG, join_style="mitre")
lb = stencil.bounds
rings, wlab = text_rings(LABEL, 0, 0, 3.0)
rings, _ = text_rings(LABEL, lb[0] + 2, lb[3] - 6.0, 3.0)
export.SHEET = BOARD
write_svg(OUT, pieces, stencil, rings, size=BOARD, title=LABEL)
write_dxf(OUT.replace(".svg", ".dxf"), pieces, stencil, rings)
sheet_png(OUT.replace(".svg", "_check.png"), pieces, stencil, rings, ppm=8)
dmin = min(pieces[i].distance(pieces[j]) for i in range(len(pieces)) for j in range(i + 1, len(pieces)))
ub = unary_union(pieces + [stencil]).bounds
hit = any(box(*np.r_[np.min(r, 0), np.max(r, 0)]).intersects(p) for r in rings for p in pieces)
print(f"scale {s:.4f} mm/px, pieces {len(pieces)}, min gap {dmin:.2f} mm, extent x {ub[0]:.1f}-{ub[2]:.1f} y {ub[1]:.1f}-{ub[3]:.1f} mm, label hits piece: {hit}")
