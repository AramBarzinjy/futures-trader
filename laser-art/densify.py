"""Densify: give placed background words their correct harakat wherever they fit.

Each haraka is its own piece and must keep the same >= ~1.5-2 mm gap to every
other piece; harakat that would crowd a neighbour are simply left off (partial
vocalisation is normal Arabic). Letters and dots never move or disappear: if a
vocalised word would need its dots moved into a neighbour, the word is skipped.
"""
from __future__ import annotations

import pickle
import sys
import time

import cv2
import numpy as np
from shapely import affinity
from shapely.ops import unary_union

from board import BOARD_H, BOARD_W, lettering_region
from fontgeom import Font, build_word
from pack2 import CONS, GAP_RASTER, INTRA_GAP, NOTO_EM, OUTLINE, RES, _variant
from rasterops import fast_rasterize
from vocal import marked_letters, vocalise

KG = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * int(GAP_RASTER / RES) + 1,) * 2)
H, W = int(round(BOARD_H / RES)), int(round(BOARD_W / RES))
M = 24  # window margin px


def _win(pieces):
    minx, miny, maxx, maxy = unary_union(pieces).bounds
    x0 = max(0, int(minx / RES) - M)
    y0 = max(0, int(miny / RES) - M)
    x1 = min(W, int(maxx / RES) + M)
    y1 = min(H, int(maxy / RES) + M)
    return y0, y1, x0, x1


def _mask(pieces, y0, y1, x0, x1):
    return fast_rasterize([p.buffer(CONS, quad_segs=4) for p in pieces], RES,
                          (x0 * RES + RES / 2, y0 * RES + RES / 2), (y1 - y0, x1 - x0))


class Occ:
    def __init__(self, words):
        from rasterops import rasterize
        allowed = rasterize([lettering_region().buffer(-CONS)], RES, (RES / 2, RES / 2), (H, W))
        self.B = ~allowed
        self.cnt = np.zeros((H, W), np.int16)
        for w in words:
            self.add(w["pieces"])

    def _dil(self, pieces):
        y0, y1, x0, x1 = _win(pieces)
        m = _mask(pieces, y0, y1, x0, x1)
        return (y0, y1, x0, x1), cv2.dilate(m.view(np.uint8), KG).astype(np.int16)

    def add(self, pieces):
        (y0, y1, x0, x1), d = self._dil(pieces)
        self.cnt[y0:y1, x0:x1] += d

    def remove(self, pieces):
        (y0, y1, x0, x1), d = self._dil(pieces)
        self.cnt[y0:y1, x0:x1] -= d

    def fits(self, pieces):
        y0, y1, x0, x1 = _win(pieces)
        m = _mask(pieces, y0, y1, x0, x1)
        F = self.B[y0:y1, x0:x1] | (self.cnt[y0:y1, x0:x1] > 0)
        return not (m & F).any()


def _largest_body(pieces, kinds):
    bs = [p for p, k in zip(pieces, kinds) if k == "body"]
    return max(bs, key=lambda p: p.area) if bs else None


def densify(words, seed=0, verbose=True):
    rng = np.random.default_rng(seed)
    noto = Font("NotoNaskhArabic-VF.ttf")
    occ = Occ(words)
    order = rng.permutation(len(words))
    added = 0
    touched = 0
    t0 = time.time()
    for n, i in enumerate(order):
        w = words[i]
        if w["kind"] != "word":
            continue
        form = w.get("form", w["text"])
        letters = marked_letters(w["text"])
        if not letters:
            continue
        # full vocalisation first, then one haraka at a time
        options = [None] + [{j} for j in letters] if len(letters) > 1 else [None]
        old_pieces = w["pieces"]
        kinds_old = w.get("kinds") or None
        occ.remove(old_pieces)
        done = False
        for keep in options:
            vf = vocalise(form, w["text"], keep=keep)
            if vf == form:
                continue
            nw = build_word(noto, vf, NOTO_EM, OUTLINE, INTRA_GAP, max_mark_move=9.0)
            if nw is None:
                continue
            nw = _variant(nw, w["scale"], w["rot"])
            nb = _largest_body(nw.pieces, nw.kinds)
            ob = max(old_pieces, key=lambda p: p.area)
            if nb is None:
                continue
            dx, dy = ob.bounds[0] - nb.bounds[0], ob.bounds[1] - nb.bounds[1]
            moved = [affinity.translate(p, dx, dy) for p in nw.pieces]
            if affinity.translate(nb, dx, dy).symmetric_difference(ob).area > 2.0:
                continue
            base = [p for p, k in zip(moved, nw.kinds) if k != "haraka"]
            hara = [p for p, k in zip(moved, nw.kinds) if k == "haraka"]
            # letters and dots must not change position (or at least still fit)
            if len(base) != len(old_pieces) or not occ.fits(base):
                continue
            keep_h = [h for h in hara if occ.fits([h])]
            if not keep_h:
                continue
            # harakat kept must also clear each other (they came out of one shaping, so they do)
            w["pieces"] = base + keep_h
            w["form_vocal"] = vf
            w["n_harakat"] = len(keep_h)
            occ.add(w["pieces"])
            added += len(keep_h)
            touched += 1
            done = True
            break
        if not done:
            occ.add(old_pieces)
        if verbose and (n + 1) % 40 == 0:
            print(f"  {n+1}/{len(words)} words checked, {touched} vocalised, {added} harakat, {time.time()-t0:.0f}s", flush=True)
    return added, touched


if __name__ == "__main__":
    src, dst = sys.argv[1], sys.argv[2]
    words = pickle.load(open(src, "rb"))
    a, t = densify(words)
    pickle.dump(words, open(dst, "wb"))
    print(f"done: {t} words vocalised, {a} harakat added")
