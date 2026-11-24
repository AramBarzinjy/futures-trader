"""Final assembly: spacers under the verse, sheet split, SVG + DXF, previews, map.

Colours (laser layers): black = cut pieces, blue = cut last (stencil outline),
red = light score (labels).
"""
from __future__ import annotations

import json
import os
import pickle
import sys

import numpy as np
from fontTools.ttLib import TTFont
from fontTools.pens.basePen import BasePen
from PIL import Image, ImageDraw, ImageFont
from shapely import affinity
from shapely.geometry import Polygon, box
from shapely.ops import unary_union

from board import BOARD_H, BOARD_W, brown_area, lettering_region, rugs
from fontgeom import polys
from sheets import MARGIN, SHEET, USE, NOTCH, nest_extras, plan, to_sheet

HERE = os.path.dirname(os.path.abspath(__file__))
BLACK, BLUE, RED = "#000000", "#0000FF", "#FF0000"


# ---------------------------------------------------------------- spacers
def add_spacers(bg, verse_pieces, want=0.45, passes=((2.0, 1.5, 12.0), (1.2, 1.0, 6.0))):
    """Hidden 3 mm spacers under verse pieces that would otherwise sit over gaps.

    First pass keeps the normal 2 mm gap to the letters; if a verse piece is still
    poorly supported, a second pass allows 1.2 mm (the spacer is hidden anyway).
    """
    out = []
    for k, (gap, inset, amin) in enumerate(passes):
        B = unary_union([p for w in bg for p in w["pieces"]] + out)
        for vp in verse_pieces:
            s = vp.intersection(B).area / vp.area
            if s >= (want if k == 0 else 0.35):
                continue
            room = vp.buffer(-inset).difference(B.buffer(gap))
            for q in polys(room):
                q = q.buffer(-1.0).buffer(1.0)          # no slivers thinner than 2 mm
                for r in polys(q):
                    if r.area >= amin:
                        out.append(r)
    if out:
        bg.append({"text": "(hidden spacer)", "kind": "spacer", "pieces": out})
    return len(out)


def support(bg, verse_pieces):
    B = unary_union([p for w in bg for p in w["pieces"]])
    return [vp.intersection(B).area / vp.area for vp in verse_pieces]


# ---------------------------------------------------------------- text -> paths
class _Pen(BasePen):
    def __init__(self, gs):
        super().__init__(gs)
        self.cs, self.cur = [], []

    def _moveTo(self, p):
        self.cur = [p]

    def _lineTo(self, p):
        self.cur.append(p)

    def _curveToOne(self, a, b, c):
        p0 = self.cur[-1]
        for i in range(1, 7):
            t = i / 6
            m = 1 - t
            self.cur.append((m ** 3 * p0[0] + 3 * m * m * t * a[0] + 3 * m * t * t * b[0] + t ** 3 * c[0],
                             m ** 3 * p0[1] + 3 * m * m * t * a[1] + 3 * m * t * t * b[1] + t ** 3 * c[1]))

    def _qCurveToOne(self, a, b):
        p0 = self.cur[-1]
        for i in range(1, 7):
            t = i / 6
            m = 1 - t
            self.cur.append((m * m * p0[0] + 2 * m * t * a[0] + t * t * b[0], m * m * p0[1] + 2 * m * t * a[1] + t * t * b[1]))

    def _closePath(self):
        if len(self.cur) > 2:
            self.cs.append(self.cur)
        self.cur = []

    _endPath = _closePath


_TT = TTFont("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
_GS = _TT.getGlyphSet()
_CMAP = _TT.getBestCmap()
_UPM = _TT["head"].unitsPerEm
_HMTX = _TT["hmtx"]


def text_rings(s, x, y, h):
    """Outline rings (lists of points) for a Latin label, cap height ~h mm, top-left at x,y."""
    sc = h / (0.73 * _UPM)
    rings, pen_x = [], 0.0
    for ch in s:
        gn = _CMAP.get(ord(ch))
        if gn is None:
            continue
        pen = _Pen(_GS)
        _GS[gn].draw(pen)
        for c in pen.cs:
            rings.append([(x + (pen_x + px) * sc, y + h - py * sc) for px, py in c])
        pen_x += _HMTX[gn][0]
    return rings, pen_x * sc


# ---------------------------------------------------------------- writers
def _rings_of(g):
    out = []
    for p in polys(g):
        out.append(list(p.exterior.coords))
        out += [list(r.coords) for r in p.interiors]
    return out


def _holes_then_outers(geoms):
    holes, outers = [], []
    for g in geoms:
        for p in polys(g):
            holes += [list(r.coords) for r in p.interiors]
            outers.append(list(p.exterior.coords))
    return holes + outers


def write_svg(fn, cut, last, score_rings, size=SHEET, title=""):
    def d(r):
        return "M" + " L".join(f"{x:.3f},{y:.3f}" for x, y in r) + " Z"
    with open(fn, "w") as f:
        f.write(f'<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" '
                f'width="{size}mm" height="{size}mm" viewBox="0 0 {size} {size}">\n<title>{title}</title>\n')
        f.write(f'<g id="score_red" fill="none" stroke="{RED}" stroke-width="0.1">\n')
        for r in score_rings:
            f.write(f'<path d="{d(r)}"/>\n')
        f.write('</g>\n')
        f.write(f'<g id="cut_black" fill="none" stroke="{BLACK}" stroke-width="0.1">\n')
        for r in _holes_then_outers(cut):
            f.write(f'<path d="{d(r)}"/>\n')
        f.write('</g>\n')
        f.write(f'<g id="cut_last_blue" fill="none" stroke="{BLUE}" stroke-width="0.1">\n')
        for r in _rings_of(last):
            f.write(f'<path d="{d(r)}"/>\n')
        f.write('</g>\n</svg>\n')


def write_dxf(fn, cut, last, score_rings):
    import ezdxf
    doc = ezdxf.new("R2010", setup=True)
    doc.units = ezdxf.units.MM
    doc.layers.add("SCORE_RED", color=1)
    doc.layers.add("CUT_BLACK", color=7)
    doc.layers.add("CUT_LAST_BLUE", color=5)
    msp = doc.modelspace()
    # DXF is y-up: flip so the sheet reads the same way as the SVG
    def add(r, layer):
        msp.add_lwpolyline([(x, SHEET - y) for x, y in r], close=True, dxfattribs={"layer": layer})
    for r in score_rings:
        add(r, "SCORE_RED")
    for r in _holes_then_outers(cut):
        add(r, "CUT_BLACK")
    for r in _rings_of(last):
        add(r, "CUT_LAST_BLUE")
    doc.saveas(fn)


def sheet_png(fn, cut, last, score_rings, ppm=4, extra_fill=None):
    s = int(SHEET * ppm)
    im = Image.new("RGB", (s, s), (222, 196, 150))       # plywood
    dr = ImageDraw.Draw(im)
    tf = lambda x, y: (x * ppm, y * ppm)
    for g in cut:
        for p in polys(g):
            dr.polygon([tf(*c) for c in p.exterior.coords], fill=(198, 170, 124), outline=(0, 0, 0))
            for r in p.interiors:
                dr.polygon([tf(*c) for c in r.coords], fill=(60, 60, 60), outline=(0, 0, 0))
    for r in _rings_of(last):
        dr.line([tf(*c) for c in r] + [tf(*r[0])], fill=(0, 60, 255), width=2)
    for r in score_rings:
        dr.line([tf(*c) for c in r] + [tf(*r[0])], fill=(230, 0, 0), width=1)
    im.save(fn)


# ---------------------------------------------------------------- labels
def find_label_spot(free, w, h, prefer=None):
    """Top-left of a w x h box fully inside free (a shapely region)."""
    fb = free.bounds
    best = None
    for y in np.arange(fb[1], fb[3] - h, 1.0):
        for x in np.arange(fb[0], fb[2] - w, 1.0):
            b = box(x, y, x + w, y + h)
            if free.contains(b):
                score = 0 if prefer is None else (abs(x - prefer[0]) + abs(y - prefer[1]))
                if best is None or score < best[0]:
                    best = (score, x, y)
                if prefer is None:
                    return x, y
    return None if best is None else (best[1], best[2])


def label_block(lines, free, h=3.2, lead=1.6, prefer=None):
    wmax = 0
    for s in lines:
        _, wd = text_rings(s, 0, 0, h)
        wmax = max(wmax, wd)
    H = len(lines) * (h + lead)
    spot = find_label_spot(free, wmax + 2, H + 2, prefer)
    if spot is None:
        return [], None
    x, y = spot
    rings = []
    for k, s in enumerate(lines):
        r, _ = text_rings(s, x + 1, y + 1 + k * (h + lead), h)
        rings += r
    return rings, box(x, y, x + wmax + 2, y + H + 2)
