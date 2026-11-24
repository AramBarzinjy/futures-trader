"""The verse layer: Amiri Bold, two lines, every stroke >= 2.5 mm, harakat separate."""
from __future__ import annotations

import numpy as np
from shapely import affinity
from shapely.ops import unary_union

from fontgeom import Font, fill_small_holes, polys, raw_components, separate
from rasterops import enforce_min_width

LINES = ["فَاذْكُرُونِي", "أَذْكُرْكُمْ"]
ALEF_UNITS = 709            # Amiri Bold alef height, font units
ROUND = dict(join_style="round", quad_segs=8)


def build_line(font, text, alef_mm, soften=0.3, min_w=2.5, gap=2.2):
    size = alef_mm / ALEF_UNITS * font.upm
    comps, _ = raw_components(font, text, size, mark_area_mm2=0.02 * size * size)
    # soften pen corners slightly, like the original's rounded laser-cut letters
    for c in comps:
        c.geom = c.geom.buffer(soften, **ROUND).buffer(-soften * 0.5, **ROUND)
    ok = separate(comps, 0.0, gap, max_mark_move=6.0)
    if not ok:
        raise RuntimeError("verse marks could not be separated: " + text)
    pieces, kinds = [], []
    for c in comps:
        g = enforce_min_width(c.geom, min_w)
        for p in polys(g):
            if p.area < 1.0:
                continue
            p = fill_small_holes(p, min_area=6.0, min_width=2.6)
            pieces.append(p)
            kinds.append(c.kind)
    return pieces, kinds


def compose(alef_mm=54.0, line_gap=4.0, centre=(0.0, 0.0), dx2=0.0):
    """Stack line 2 under line 1, as close as line_gap allows, both centred."""
    font = Font("Amiri-Bold.ttf")
    l1, k1 = build_line(font, LINES[0], alef_mm)
    l2, k2 = build_line(font, LINES[1], alef_mm)
    g1, g2 = unary_union(l1), unary_union(l2)
    c1 = (g1.bounds[0] + g1.bounds[2]) / 2
    c2 = (g2.bounds[0] + g2.bounds[2]) / 2
    l1 = [affinity.translate(p, -c1, 0) for p in l1]
    l2 = [affinity.translate(p, -c2 + dx2, 0) for p in l2]
    g1, g2 = unary_union(l1), unary_union(l2)
    # lowest offset that keeps line_gap everywhere (lines may interlock)
    lo, hi = 0.0, (g1.bounds[3] - g2.bounds[1]) + line_gap + 1
    for _ in range(40):
        mid = (lo + hi) / 2
        if affinity.translate(g2, 0, mid).distance(g1) >= line_gap:
            hi = mid
        else:
            lo = mid
    dy = hi
    l2 = [affinity.translate(p, 0, dy) for p in l2]
    allg = unary_union(l1 + l2)
    bx = allg.bounds
    cx, cy = (bx[0] + bx[2]) / 2, (bx[1] + bx[3]) / 2
    pieces = [affinity.translate(p, centre[0] - cx, centre[1] - cy) for p in l1 + l2]
    kinds = k1 + k2
    line = [1] * len(l1) + [2] * len(l2)
    return pieces, kinds, line


if __name__ == "__main__":
    import time
    t = time.time()
    ps, ks, ln = compose()
    g = unary_union(ps)
    b = g.bounds
    print("pieces", len(ps), "block %.1f x %.1f" % (b[2] - b[0], b[3] - b[1]), "t=%.1fs" % (time.time() - t))
    dmin = min(ps[i].distance(ps[j]) for i in range(len(ps)) for j in range(i + 1, len(ps)))
    print("min gap between verse pieces %.2f" % dmin)
