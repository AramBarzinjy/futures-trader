"""Raster <-> vector helpers (shapely polygons in mm)."""
from __future__ import annotations

import numpy as np
from scipy import ndimage as ndi
from shapely.geometry import Polygon
from shapely.ops import unary_union
from skimage.draw import polygon as skpoly
from skimage.measure import find_contours
from skimage.morphology import skeletonize

from fontgeom import polys


def rasterize(geoms, res, origin, shape):
    """Fill geometries into a bool array. origin=(x0,y0) mm of pixel (0,0) centre."""
    m = np.zeros(shape, bool)
    x0, y0 = origin
    for g in geoms:
        for p in polys(g):
            ext = np.asarray(p.exterior.coords)
            rr, cc = skpoly((ext[:, 1] - y0) / res, (ext[:, 0] - x0) / res, shape)
            sub = np.zeros(shape, bool)
            sub[rr, cc] = True
            for r in p.interiors:
                a = np.asarray(r.coords)
                rr, cc = skpoly((a[:, 1] - y0) / res, (a[:, 0] - x0) / res, shape)
                sub[rr, cc] = False
            m |= sub
    return m


def mask_to_polys(mask, res, origin, simplify=None):
    """Trace a bool mask into polygons (even-odd nesting)."""
    x0, y0 = origin
    pad = np.pad(mask.astype(float), 1)
    cs = find_contours(pad, 0.5)
    rings = []
    for c in cs:
        if len(c) < 4:
            continue
        xy = np.c_[(c[:, 1] - 1) * res + x0, (c[:, 0] - 1) * res + y0]
        p = Polygon(xy).buffer(0)
        if p.area > res * res * 2:
            rings.append(p)
    if not rings:
        return []
    rings.sort(key=lambda p: -p.area)
    # even-odd: depth = number of rings containing this ring's representative point
    out = []
    for i, r in enumerate(rings):
        pt = r.representative_point()
        depth = sum(1 for j in range(i) if rings[j].contains(pt))
        out.append((depth, r))
    geom = Polygon()
    for depth, r in out:
        geom = geom.union(r) if depth % 2 == 0 else geom.difference(r)
    res_polys = polys(geom)
    if simplify:
        res_polys = [p.simplify(simplify, preserve_topology=True).buffer(0) for p in res_polys]
        res_polys = [q for p in res_polys for q in polys(p)]
    return res_polys


def enforce_min_width(poly, wmin, res=0.04):
    """Return poly thickened so every stroke is at least wmin wide (round caps)."""
    minx, miny, maxx, maxy = poly.bounds
    pad = wmin + 1.0
    x0, y0 = minx - pad, miny - pad
    shape = (int((maxy - miny + 2 * pad) / res) + 1, int((maxx - minx + 2 * pad) / res) + 1)
    m = rasterize([poly], res, (x0, y0), shape)
    sk = skeletonize(m)
    d = ndi.distance_transform_edt(~sk) * res
    m2 = m | (d <= wmin / 2)
    ps = mask_to_polys(m2, res, (x0, y0), simplify=res * 0.6)
    g = unary_union(ps)
    # keep the original crisp outline wherever it was already thick enough
    return g.union(poly).buffer(0)


def fast_rasterize(geoms, res, origin, shape):
    """cv2 polygon fill (pixel centres on integer coords). Much faster than skimage."""
    import cv2
    m = np.zeros(shape, np.uint8)
    x0, y0 = origin
    sh = 4
    k = float(1 << sh)
    for g in geoms:
        for p in polys(g):
            ext = np.asarray(p.exterior.coords)
            pts = np.round(np.c_[(ext[:, 0] - x0) / res, (ext[:, 1] - y0) / res] * k).astype(np.int32)
            cv2.fillPoly(m, [pts], 1, lineType=cv2.LINE_8, shift=sh)
            for r in p.interiors:
                # cv2 clears every pixel the hole edge touches: shrink the hole by a
                # pixel first so the fill stays conservative (never too small)
                for h in polys(Polygon(r).buffer(-res, quad_segs=4)):
                    a = np.asarray(h.exterior.coords)
                    pts = np.round(np.c_[(a[:, 0] - x0) / res, (a[:, 1] - y0) / res] * k).astype(np.int32)
                    cv2.fillPoly(m, [pts], 0, lineType=cv2.LINE_8, shift=sh)
    return m.astype(bool)
