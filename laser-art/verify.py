"""Checks on the exact vector geometry: nothing merges, nothing cut off, nothing overlaps."""
import pickle
import sys

import numpy as np
from shapely import STRtree
from shapely.geometry import Polygon
from shapely.ops import unary_union

from board import brown_area, lettering_region


def check(bg, verse_pieces, min_gap=1.8, verbose=True):
    problems = []
    pieces = [(w["text"], w["kind"], p) for w in bg for p in w["pieces"]]
    geoms = [p for _, _, p in pieces]
    for t, k, p in pieces:
        if not isinstance(p, Polygon) or not p.is_valid or p.is_empty:
            problems.append(f"invalid piece in {t}")
    # gaps between every pair of background pieces
    tree = STRtree(geoms)
    gaps = []
    for i, g in enumerate(geoms):
        for j in tree.query(g.buffer(min_gap + 3.0)):
            if j <= i:
                continue
            d = g.distance(geoms[j])
            gaps.append(d)
            hidden = pieces[i][1] == "spacer" or pieces[j][1] == "spacer"
            if d < (1.15 if hidden else min_gap):
                problems.append(f"gap {d:.2f} mm between '{pieces[i][0]}' and '{pieces[j][0]}'")
    # inside the lettering region (not cut off by board or rug edges)
    reg = lettering_region().buffer(1e-6)
    for t, k, p in pieces:
        if not reg.contains(p):
            problems.append(f"'{t}' crosses the board/rug boundary")
    # verse: separate pieces, inside the brown area, clear of the Names
    vg = [p for p in verse_pieces]
    for i in range(len(vg)):
        for j in range(i + 1, len(vg)):
            if vg[i].distance(vg[j]) < min_gap:
                problems.append(f"verse pieces {i},{j} too close")
    ba = brown_area()
    for i, p in enumerate(vg):
        if not ba.contains(p):
            problems.append(f"verse piece {i} leaves the brown area")
    V = unary_union(vg)
    for w in bg:
        if w["kind"] == "name":
            d = unary_union(w["pieces"]).distance(V)
            if d < 3.0:
                problems.append(f"Name {w['text']} only {d:.1f} mm from the verse")
    # support: every verse piece must rest on background wood
    B = unary_union(geoms)
    sup = [p.intersection(B).area / p.area for p in vg]
    for i, s in enumerate(sup):
        if s < 0.2:
            problems.append(f"verse piece {i} only {100*s:.0f}% supported")
    stats = dict(n_words=len(bg), n_pieces=len(geoms), min_gap=min(gaps) if gaps else None,
                 median_contact_gap=float(np.median([g for g in gaps if g < 3.0])) if gaps else None,
                 coverage=B.area / lettering_region().area, min_support=min(sup) if sup else None)
    if verbose:
        print(stats)
        print(f"{len(problems)} problems")
        for p in problems[:30]:
            print("  ", p)
    return problems, stats


if __name__ == "__main__":
    bg = pickle.load(open(sys.argv[1], "rb"))
    vp, vk, vl = pickle.load(open(sys.argv[2] if len(sys.argv) > 2 else "data/verse.pkl", "rb"))
    check(bg, vp)
