"""Realistic preview: painted 3 mm plywood relief, silver verse, rug texture.

Light from the upper left, as in the reference photos.  Heights: board 0,
background words 3 mm, verse 6 mm (glued on top of the background layer).
"""
from __future__ import annotations

import json
import os

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi

from board import BOARD_H, BOARD_W, rugs
from fontgeom import polys
from rasterops import rasterize

HERE = os.path.dirname(os.path.abspath(__file__))

BROWN = np.array([118, 97, 80], float) / 255      # paint albedo (calibrated to photo)
SILVER = np.array([196, 192, 185], float) / 255


def _mask(geoms, x0, y0, ppm, shape, ss=1):
    res = 1.0 / (ppm * ss)
    m = rasterize(geoms, res, (x0 + res / 2, y0 + res / 2), (shape[0] * ss, shape[1] * ss))
    if ss > 1:
        m = m.reshape(shape[0], ss, shape[1], ss).mean(axis=(1, 3))
    return m.astype(np.float32)


def rug_texture(photo_path, x0, y0, ppm, shape):
    """Sample the user's own rug pieces from the flat reference photo."""
    d = json.load(open(os.path.join(HERE, "data", "rugs.json")))
    kL, kR = d["kL_mm_per_px"], d["kR_mm_per_px"]
    W, H = d["photo_px"]
    img = cv2.imread(photo_path)[:, :, ::-1].astype(np.float32) / 255
    h, w = shape
    xs = x0 + (np.arange(w) + 0.5) / ppm
    ys = y0 + (np.arange(h) + 0.5) / ppm
    X, Y = np.meshgrid(xs, ys)
    py = (Y * H / BOARD_H).astype(np.float32)
    pxl = (X / kL).astype(np.float32)
    pxr = (W - (BOARD_W - X) / kR).astype(np.float32)
    left = cv2.remap(img, pxl, py, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)
    right = cv2.remap(img, pxr, py, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)
    return left, right


def render(bg, verse, window, ppm=8, photo=None, seed=0, light=(-1.0, -1.15, 1.25)):
    """bg, verse: lists of polygons (mm). window=(x0,y0,x1,y1) mm. Returns HxWx3 float."""
    x0, y0, x1, y1 = window
    h, w = int(round((y1 - y0) * ppm)), int(round((x1 - x0) * ppm))
    shape = (h, w)
    from shapely.geometry import box
    win = box(x0 - 10, y0 - 10, x1 + 10, y1 + 10)
    bgw = [p for p in bg if p.intersects(win)]
    vw = [p for p in verse if p.intersects(win)]
    L, R = rugs()
    mb = _mask(bgw, x0, y0, ppm, shape, ss=2)
    mv = _mask(vw, x0, y0, ppm, shape, ss=2)
    ml = _mask([L.intersection(win)], x0, y0, ppm, shape, ss=2)
    mr = _mask([R.intersection(win)], x0, y0, ppm, shape, ss=2)
    rug = np.clip(ml + mr, 0, 1)
    # rugs sit on the board; the fabric is ~4 mm thick
    Hm = np.maximum(3.0 * mb, 6.0 * mv)
    Hm = np.maximum(Hm, 4.0 * rug * (1 - mv))
    px = 1.0 / ppm
    Hs = ndi.gaussian_filter(Hm, 0.45 * ppm)            # painted edges are soft
    gy, gx = np.gradient(Hs, px)
    n = np.dstack([-gx, -gy, np.ones_like(gx)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    Lv = np.array(light, float)
    Lv /= np.linalg.norm(Lv)
    lam = np.clip((n * Lv).sum(2), 0, 1)
    flat = Lv[2]
    # cast shadows: march toward the light
    dxy = Lv[:2] / np.linalg.norm(Lv[:2])
    tan_e = Lv[2] / np.linalg.norm(Lv[:2])
    sh = np.zeros_like(Hm)
    step = 1.0
    nsteps = int(6.5 / tan_e * ppm) + 2
    for k in range(1, nsteps):
        t = k * step
        M = np.float32([[1, 0, -dxy[0] * t], [0, 1, -dxy[1] * t]])
        Hk = cv2.warpAffine(Hm.astype(np.float32), M, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        sh = np.maximum(sh, Hk - Hm - (t / ppm) * tan_e)
    shadow = np.clip(sh / 1.2, 0, 1)
    shadow = ndi.gaussian_filter(shadow, 0.7 * ppm)
    # ambient occlusion in narrow gaps
    ao = np.clip((ndi.gaussian_filter(Hm, 2.0 * ppm) - Hm) / 3.5, 0, 1)
    rng = np.random.default_rng(seed)
    grain = ndi.gaussian_filter(rng.standard_normal(shape), 0.6 * ppm) * 0.05 + \
        ndi.gaussian_filter(rng.standard_normal(shape), 6 * ppm) * 0.18
    shade = (0.40 + 0.75 * lam / flat * 0.82) * (1 - 0.55 * shadow) * (1 - 0.45 * ao)
    wood = BROWN[None, None, :] * (1 + grain[..., None]) * shade[..., None]
    # silver: soft metallic sheen + specular
    hv = np.array([Lv[0], Lv[1], Lv[2] + 1.0])
    hv /= np.linalg.norm(hv)
    spec = np.clip((n * hv).sum(2), 0, 1) ** 40
    sheen = ndi.gaussian_filter(rng.standard_normal(shape), 1.2 * ppm) * 0.05 + \
        ndi.gaussian_filter(rng.standard_normal(shape), 0.25 * ppm) * 0.06      # metallic flake
    silv = SILVER[None, None, :] * (0.45 + 0.5 * lam[..., None] / flat + sheen[..., None]) * (1 - 0.35 * ao[..., None]) \
        + 0.18 * spec[..., None]
    img = wood * (1 - mv[..., None]) + silv * mv[..., None]
    if photo is not None:
        lt, rt = rug_texture(photo, x0, y0, ppm, shape)
        rugtex = lt * ml[..., None] + rt * mr[..., None]
        rshade = (0.85 + 0.15 * lam / flat)[..., None]
        img = img * (1 - rug[..., None] * (1 - mv[..., None])) + \
            (rugtex * rshade * 1.08) * rug[..., None] * (1 - mv[..., None])
    return np.clip(img, 0, 1)


def to_pil(img):
    return Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8))


def cut_view(bg, verse, window, ppm=8, seed=3):
    """Flat diagram: every background piece its own colour, verse outlined on top."""
    x0, y0, x1, y1 = window
    w, h = int(round((x1 - x0) * ppm)), int(round((y1 - y0) * ppm))
    ss = 2
    im = Image.new("RGB", (w * ss, h * ss), (250, 248, 243))
    d = ImageDraw.Draw(im)
    tf = lambda x, y: ((x - x0) * ppm * ss, (y - y0) * ppm * ss)
    rng = np.random.default_rng(seed)
    L, R = rugs()
    for g in (L, R):
        for p in polys(g):
            d.polygon([tf(*c) for c in p.exterior.coords], fill=(226, 221, 210))
    for p in bg:
        c = tuple(int(v) for v in 150 + rng.integers(0, 90, 3))
        for q in polys(p):
            d.polygon([tf(*c2) for c2 in q.exterior.coords], fill=c, outline=(0, 0, 0), width=ss)
            for r in q.interiors:
                d.polygon([tf(*c2) for c2 in r.coords], fill=(250, 248, 243), outline=(0, 0, 0), width=ss)
    for p in verse:
        for q in polys(p):
            pts = [tf(*c) for c in q.exterior.coords]
            d.line(pts, fill=(30, 60, 200), width=3 * ss)
            for r in q.interiors:
                d.line([tf(*c) for c in r.coords], fill=(30, 60, 200), width=3 * ss)
    return im.resize((w, h), Image.LANCZOS)
