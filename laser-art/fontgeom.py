"""Font shaping -> laser-cut piece geometry.

Shapes Arabic text with HarfBuzz, converts glyph outlines to shapely polygons in
millimetres (y axis pointing DOWN, like SVG), adds the rounded outline, and pulls
apart any components that the outline would otherwise fuse together.

Every word comes back as a list of separate pieces: letter groups that are joined
in normal writing are one piece; letters that are not joined, dots, hamzas and
harakat are their own pieces.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field

import numpy as np
import uharfbuzz as hb
from fontTools.pens.basePen import BasePen
from fontTools.ttLib import TTFont
from shapely import affinity
from shapely.geometry import MultiPolygon, Polygon
from shapely.ops import unary_union

HERE = os.path.dirname(os.path.abspath(__file__))
FONT_DIR = os.environ.get("LASER_FONT_DIR", os.path.join(HERE, "fonts"))

ROUND = dict(join_style="round", cap_style="round", quad_segs=8)


def polys(g):
    """Iterate the polygons of a (Multi)Polygon/GeometryCollection."""
    if g is None or g.is_empty:
        return []
    if isinstance(g, Polygon):
        return [g]
    if isinstance(g, MultiPolygon):
        return list(g.geoms)
    out = []
    for h in getattr(g, "geoms", []):
        out += polys(h)
    return out


class _PolyPen(BasePen):
    def __init__(self, gs, steps=10):
        super().__init__(gs)
        self.contours, self.cur, self.steps = [], [], steps

    def _moveTo(self, p):
        self.cur = [p]

    def _lineTo(self, p):
        self.cur.append(p)

    def _curveToOne(self, p1, p2, p3):
        p0 = self.cur[-1]
        for i in range(1, self.steps + 1):
            t = i / self.steps
            m = 1 - t
            self.cur.append((m**3 * p0[0] + 3 * m * m * t * p1[0] + 3 * m * t * t * p2[0] + t**3 * p3[0],
                             m**3 * p0[1] + 3 * m * m * t * p1[1] + 3 * m * t * t * p2[1] + t**3 * p3[1]))

    def _qCurveToOne(self, p1, p2):
        p0 = self.cur[-1]
        for i in range(1, self.steps + 1):
            t = i / self.steps
            m = 1 - t
            self.cur.append((m * m * p0[0] + 2 * m * t * p1[0] + t * t * p2[0],
                             m * m * p0[1] + 2 * m * t * p1[1] + t * t * p2[1]))

    def _closePath(self):
        if len(self.cur) > 2:
            self.contours.append(self.cur)
        self.cur = []

    _endPath = _closePath


def _signed_area(c):
    a = np.asarray(c)
    x, y = a[:, 0], a[:, 1]
    return 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


class Font:
    def __init__(self, filename):
        path = filename if os.path.isabs(filename) else os.path.join(FONT_DIR, filename)
        self.path = path
        self.face = hb.Face(hb.Blob.from_file_path(path))
        self.hbfont = hb.Font(self.face)
        self.tt = TTFont(path)
        self.gs = self.tt.getGlyphSet()
        self.order = self.tt.getGlyphOrder()
        self.upm = self.tt["head"].unitsPerEm
        gdef = self.tt["GDEF"].table if "GDEF" in self.tt else None
        self.gclass = gdef.GlyphClassDef.classDefs if gdef is not None and gdef.GlyphClassDef else {}
        self._geom = {}
        cmap = self.tt.getBestCmap() or {}
        self.glyph_cp = {}
        for cp, gn in cmap.items():
            self.glyph_cp.setdefault(gn, cp)

    def is_haraka(self, name):
        cp = self.glyph_cp.get(name)
        return cp is not None and (0x064B <= cp <= 0x0652 or cp == 0x0670)

    def glyph_geom(self, name):
        """Glyph outline as shapely geometry, font units, y up (nonzero fill)."""
        if name in self._geom:
            return self._geom[name]
        pen = _PolyPen(self.gs)
        self.gs[name].draw(pen)
        cs = [c for c in pen.contours if len(c) >= 3 and abs(_signed_area(c)) > 1e-6]
        if not cs:
            g = Polygon()
        else:
            # TrueType: outer contours run clockwise (negative area, y up)
            big = max(cs, key=lambda c: abs(_signed_area(c)))
            outer_sign = np.sign(_signed_area(big))
            outers = [Polygon(c).buffer(0) for c in cs if np.sign(_signed_area(c)) == outer_sign]
            holes = [Polygon(c).buffer(0) for c in cs if np.sign(_signed_area(c)) != outer_sign]
            g = unary_union(outers)
            if holes:
                g = g.difference(unary_union(holes))
        self._geom[name] = g
        return g

    def is_mark(self, name):
        return self.gclass.get(name, 0) == 3

    def shape(self, text, features=None):
        buf = hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()
        hb.shape(self.hbfont, buf, features or {})
        out, x = [], 0
        for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
            name = self.order[info.codepoint]
            out.append((name, x + pos.x_offset, pos.y_offset, info.cluster))
            x += pos.x_advance
        return out, x


@dataclass
class Comp:
    geom: Polygon            # raw outline, mm, y down
    kind: str                # 'body' or 'mark'
    clusters: set = field(default_factory=set)
    group: int = -1          # mark group id (one per mark glyph)
    haraka: bool = False     # a vowel mark (fatha, damma, ...) rather than a dot
    body: int = -1           # index of the body a mark belongs to


def _to_mm(g, x, y, s):
    # font units (y up) -> mm (y down)
    g = affinity.translate(g, x, y)
    return affinity.scale(g, xfact=s, yfact=-s, origin=(0, 0))


def raw_components(font: Font, text: str, size_mm: float, features=None, mark_area_mm2=None):
    """Shape text; return list[Comp] (raw outlines, no offset) and advance in mm."""
    s = size_mm / font.upm
    glyphs, adv = font.shape(text, features)
    bodies, marks = [], []
    for gi, (name, x, y, cl) in enumerate(glyphs):
        g = font.glyph_geom(name)
        if g.is_empty:
            continue
        g = _to_mm(g, x, y, s)
        if font.is_mark(name):
            hk = font.is_haraka(name)
            for p in polys(g):
                marks.append(Comp(p, "mark", {cl}, group=gi, haraka=hk))
        else:
            bodies.append((g, cl))
    # merge joined letters (glyphs that touch) into bodies
    eps = 0.02
    merged = unary_union([b.buffer(eps, **ROUND) for b, _ in bodies]).buffer(-eps, **ROUND)
    comps = []
    if mark_area_mm2 is None:
        mark_area_mm2 = 0.035 * size_mm * size_mm   # dot-sized
    for p in polys(merged):
        if p.area < 1e-3:
            continue
        cls = {cl for b, cl in bodies if b.intersects(p.buffer(eps))}
        kind = "mark" if p.area < mark_area_mm2 else "body"
        comps.append(Comp(p, kind, cls, group=10000 + len(comps) if kind == "mark" else -1))
    comps += marks
    return comps, adv * s


def _off(c: Comp, d):
    return c.geom.buffer(d, **ROUND) if d > 0 else c.geom


def separate(comps, offset, gap, step=0.2, max_mark_move=7.0, log=None):
    """Move components apart until every pair of offset outlines is >= gap apart.

    Bodies (letter groups) only slide horizontally - everything to the left of a
    conflict slides further left, as extra letter spacing would.  Marks (dots,
    hamza, harakat) move the least distance needed, preferring straight up/down
    away from their letter.  Returns False if the word cannot be separated.
    """
    bodies = [i for i, c in enumerate(comps) if c.kind == "body"]
    markids = [i for i, c in enumerate(comps) if c.kind == "mark"]
    # attach marks to bodies by cluster, else nearest
    for i in markids:
        c = comps[i]
        best, bd = -1, 1e9
        for j in bodies:
            if c.clusters & comps[j].clusters:
                d = comps[j].geom.distance(c.geom)
                if d < bd:
                    best, bd = j, d
        if best < 0:
            best = min(bodies, key=lambda j: comps[j].geom.distance(c.geom)) if bodies else -1
        c.body = best
    # 1) bodies right-to-left, slide later ones left
    order = sorted(bodies, key=lambda j: -comps[j].geom.bounds[2])
    for k in range(1, len(order)):
        cur = order[k]
        for _ in range(400):
            o = _off(comps[cur], offset)
            dmin = min(o.distance(_off(comps[p], offset)) for p in order[:k])
            if dmin >= gap:
                break
            shift = -max(step, gap - dmin)
            movers = set(order[k:])
            for i in list(movers):
                pass
            for i, c in enumerate(comps):
                if i in movers or (c.kind == "mark" and c.body in movers):
                    c.geom = affinity.translate(c.geom, shift, 0)
        else:
            return False
    # 2) mark groups
    groups = {}
    for i in markids:
        groups.setdefault(comps[i].group, []).append(i)
    # order groups right-to-left
    gorder = sorted(groups, key=lambda g: -max(comps[i].geom.bounds[2] for i in groups[g]))
    # 2a) spread multi-dot groups so the dots themselves keep the gap
    for g in gorder:
        ids = groups[g]
        if len(ids) < 2:
            continue
        cen = np.mean([[comps[i].geom.centroid.x, comps[i].geom.centroid.y] for i in ids], axis=0)
        for _ in range(60):
            ok = True
            for a in range(len(ids)):
                for b in range(a + 1, len(ids)):
                    if _off(comps[ids[a]], offset).distance(_off(comps[ids[b]], offset)) < gap:
                        ok = False
            if ok:
                break
            for i in ids:
                c = comps[i].geom.centroid
                v = np.array([c.x - cen[0], c.y - cen[1]])
                n = np.linalg.norm(v)
                v = v / n if n > 1e-6 else np.array([1.0, 0.0])
                comps[i].geom = affinity.translate(comps[i].geom, v[0] * step * 0.5, v[1] * step * 0.5)
        else:
            return False
    # 2b) move each mark group off whatever it touches
    cands = []
    for dy in np.arange(0, max_mark_move + 1e-9, step):
        for dx in np.arange(0, max_mark_move * 0.6 + 1e-9, step):
            cost = dy + 2.5 * dx
            if cost <= max_mark_move * 1.3:
                cands.append((cost, dx, dy))
    cands.sort()
    for g in gorder:
        ids = groups[g]
        others = [i for i in range(len(comps)) if i not in ids]
        oth = unary_union([_off(comps[i], offset) for i in others]) if others else Polygon()
        cur = unary_union([_off(comps[i], offset) for i in ids])
        if oth.is_empty or cur.distance(oth) >= gap:
            continue
        # preferred vertical direction: away from own body
        b = comps[ids[0]].body
        by = comps[b].geom.centroid.y if b >= 0 else 0
        my = cur.centroid.y
        sy = -1.0 if my < by else 1.0          # y down: above -> move up (negative)
        done = False
        for cost, dx, dy in cands:
            for sx in ((0,) if dx == 0 else (1, -1)):
                for syy in ((sy,) if dy == 0 else (sy, -sy)):
                    if dy > 0 and syy == -sy and dy > 2.0:
                        continue      # only small moves toward the letter
                    t = affinity.translate(cur, sx * dx, syy * dy)
                    if t.distance(oth) >= gap:
                        for i in ids:
                            comps[i].geom = affinity.translate(comps[i].geom, sx * dx, syy * dy)
                        done = True
                        break
                if done:
                    break
            if done:
                break
        if not done:
            if log is not None:
                log.append("mark group could not be cleared")
            return False
    return True


def fill_small_holes(p: Polygon, min_area, min_width):
    """Remove interior holes too small (or too narrow) to cut cleanly."""
    keep = []
    for r in p.interiors:
        h = Polygon(r)
        if h.area < min_area:
            continue
        if h.buffer(-min_width / 2).is_empty:
            continue
        keep.append(r)
    return Polygon(p.exterior, keep)


@dataclass
class Word:
    text: str
    pieces: list            # list[Polygon], mm, y down, word origin at (0,0) baseline-right
    kinds: list             # 'body'/'mark' per piece
    raw: list               # raw outlines (before offset), same order

    @property
    def geom(self):
        return unary_union(self.pieces)

    def bounds(self):
        return unary_union(self.pieces).bounds


def build_word(font, text, size_mm, offset, gap, features=None, hole_min_area=4.0,
               hole_min_width=1.6, log=None, max_mark_move=7.0):
    comps, adv = raw_components(font, text, size_mm, features)
    if not comps:
        return None
    ok = separate(comps, offset, gap, log=log, max_mark_move=max_mark_move)
    if not ok:
        return None
    pieces, kinds, raws = [], [], []
    for c in comps:
        g = _off(c, offset)
        for p in polys(g):
            p = fill_small_holes(p, hole_min_area, hole_min_width)
            pieces.append(p)
            kinds.append("haraka" if c.haraka else c.kind)
            raws.append(c.geom)
    # sanity: every pair separated
    for a in range(len(pieces)):
        for b in range(a + 1, len(pieces)):
            if pieces[a].distance(pieces[b]) < gap - 1e-6:
                if log is not None:
                    log.append(f"{text}: pieces {a},{b} too close")
                return None
    # normalise: origin at the word's bounding-box top-left
    minx, miny, _, _ = unary_union(pieces).bounds
    pieces = [affinity.translate(p, -minx, -miny) for p in pieces]
    raws = [affinity.translate(p, -minx, -miny) for p in raws]
    return Word(text, pieces, kinds, raws)
