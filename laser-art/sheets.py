"""Split the design across 12" x 12" sheets without cutting any piece in two.

Sheet 1 and 2: background cut IN PLACE - each sheet is a 297 mm window onto the
board, so the leftover sheet is a stencil that drops onto the board. Sheet 2 also
cuts copies of the sheet-1 pieces in the overlap: those holes key onto the
already-glued sheet-1 pieces (exact registration) and the copies are spares.
Sheet 3: the verse in place (its leftover is the verse stencil) plus the few
background pieces that fit neither window, nested and numbered.
"""
from __future__ import annotations

import numpy as np
from shapely import affinity
from shapely.geometry import box
from shapely.ops import unary_union

from board import BOARD_H, BOARD_W

SHEET = 304.8
MARGIN = 4.0
USE = SHEET - 2 * MARGIN          # 296.8 mm usable window
NOTCH = 1.2                        # stencil edge keeps this clear of pieces it doesn't cut


def choose_windows(pieces, weight=None):
    """Window A flush with the board top, window B flush with the bottom; pick x
    positions that leave the least (weighted) area outside both."""
    weight = weight or [1.0] * len(pieces)
    best = None
    for xa in np.arange(0, BOARD_W - USE + 0.01, 2.0):
        A = box(xa, 0, xa + USE, USE)
        inA = [A.contains(p) for p in pieces]
        for xb in np.arange(0, BOARD_W - USE + 0.01, 2.0):
            B = box(xb, BOARD_H - USE, xb + USE, BOARD_H)
            left = [i for i, p in enumerate(pieces) if not inA[i] and not B.contains(p)]
            area = sum(pieces[i].area * weight[i] for i in left)
            key = (area, len(left), abs(xa - xb))
            if best is None or key < best[0]:
                best = (key, xa, xb, left)
    return best[1], best[2], best[3]


def plan(bg_words, verse_pieces):
    pieces, owner = [], []
    for wi, w in enumerate(bg_words):
        for p in w["pieces"]:
            pieces.append(p)
            owner.append(wi)
    kinds = [bg_words[o]["kind"] for o in owner]
    xa, xb, left = choose_windows(pieces, [25.0 if k == "name" else 1.0 for k in kinds])
    A = box(xa, 0, xa + USE, USE)
    B = box(xb, BOARD_H - USE, xb + USE, BOARD_H)
    sheetA, sheetB, keysB, extras = [], [], [], []
    for i, p in enumerate(pieces):
        if A.contains(p):
            sheetA.append(i)
            if B.contains(p):
                keysB.append(i)
        elif B.contains(p):
            sheetB.append(i)
        else:
            extras.append(i)

    def stencil(rect, inside_ids):
        cross = [p for i, p in enumerate(pieces) if i not in inside_ids and p.intersects(rect)]
        s = rect
        if cross:
            s = rect.difference(unary_union(cross).buffer(NOTCH))
        return s

    stA = stencil(A, set(sheetA))
    stB = stencil(B, set(sheetB) | set(keysB))
    V = unary_union(verse_pieces)
    vb = V.bounds
    vrect = box(vb[0] - 8, vb[1] - 8, vb[2] + 8, vb[3] + 8)
    return dict(pieces=pieces, owner=owner, xa=xa, xb=xb, A=A, B=B, sheetA=sheetA, sheetB=sheetB,
                keysB=keysB, extras=extras, stencilA=stA, stencilB=stB, verse_rect=vrect)


def to_sheet(geom, rect):
    """Board coords -> sheet coords (window's top-left at the margin)."""
    x0, y0 = rect.bounds[0], rect.bounds[1]
    return affinity.translate(geom, MARGIN - x0, MARGIN - y0)


def nest_extras(extra_pieces, free_region, step=1.0, gap=2.5):
    """Greedy bottom-left nesting of the leftover pieces (rotations allowed)."""
    placed = []
    occupied = None
    for p in sorted(extra_pieces, key=lambda q: -q.area):
        done = False
        for ang in (0, 90, 180, 270):
            q = affinity.rotate(p, ang, origin="centroid")
            minx, miny, maxx, maxy = q.bounds
            q = affinity.translate(q, -minx, -miny)
            w, h = maxx - minx, maxy - miny
            fb = free_region.bounds
            for y in np.arange(fb[1], fb[3] - h, step):
                for x in np.arange(fb[0], fb[2] - w, step):
                    t = affinity.translate(q, x, y)
                    if not free_region.contains(t):
                        continue
                    if occupied is not None and t.distance(occupied) < gap:
                        continue
                    placed.append((p, ang, t))
                    occupied = t if occupied is None else occupied.union(t)
                    done = True
                    break
                if done:
                    break
            if done:
                break
        if not done:
            placed.append((p, None, None))
    return placed
