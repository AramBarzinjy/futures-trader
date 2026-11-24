"""Background packer: interlock whole words like a jigsaw, one layer, even density.

Raster search at 0.25 mm. Masks are conservative (each pixel that could hold any
part of a piece is marked) so the raster gap is a guaranteed lower bound on the
real gap; the result is re-checked on the exact vector outlines afterwards.

Loop: find the biggest empty pocket left on the board, try a sample of words in
and around it, keep the placement whose outline hugs its neighbours most
closely (that is what makes tall letters rise into gaps and bowls dip below),
repeat until no letter fits anywhere.
"""
from __future__ import annotations

import pickle
import time

import cv2
import numpy as np
from scipy import ndimage as ndi
from shapely import affinity
from shapely.ops import unary_union

from board import BOARD_H, BOARD_W, lettering_region
from fontgeom import Font, build_word
from rasterops import rasterize
from vocab import LETTERS, NAMES, WORDS

RES = 0.25                 # mm per pixel
CONS = 0.18                # conservative raster inflation (half pixel diagonal)
GAP_RASTER = 1.95          # mm; real gap >= 1.95 - 2*0.177 ~ 1.6 mm, usually 1.8-2.3
RING = 1.25                # mm; "contact" band used to score snug fits
NOTO_EM = 32.0 / 671 * 1000   # raw alef 32 mm (+1 mm outline top and bottom = 34 mm)
OUTLINE = 1.0
INTRA_GAP = 2.0
PAD = 420                  # board raster padding (px)


def disk(r):
    k = int(np.ceil(r))
    y, x = np.ogrid[-k:k + 1, -k:k + 1]
    return (x * x + y * y) <= r * r


class Item:
    def __init__(self, word, kind):
        self.word, self.kind, self.text = word, kind, word.text
        g = unary_union(word.pieces)
        minx, miny, maxx, maxy = g.bounds
        pad = int(np.ceil(GAP_RASTER / RES)) + 4
        self.x0, self.y0 = minx - pad * RES, miny - pad * RES
        h = int(np.ceil((maxy - miny) / RES)) + 2 * pad + 1
        w = int(np.ceil((maxx - minx) / RES)) + 2 * pad + 1
        M = rasterize([p.buffer(CONS) for p in word.pieces], RES, (self.x0, self.y0), (h, w))
        self.M = M
        self.Mf = M.astype(np.float32)
        self.D = ndi.binary_dilation(M, disk(GAP_RASTER / RES))
        ring = ndi.binary_dilation(M, disk(RING / RES)) & ~M
        self.Rf = ring.astype(np.float32)
        self.ring_n = float(ring.sum())
        self.area = float(sum(p.area for p in word.pieces))
        self.npieces = len(word.pieces)
        self.uses = 0

    def world_pieces(self, py, px):
        dx = RES / 2 + px * RES - self.x0
        dy = RES / 2 + py * RES - self.y0
        return [affinity.translate(p, dx, dy) for p in self.word.pieces]


def build_items(log=None):
    noto = Font("NotoNaskhArabic-VF.ttf")
    items = {"word": [], "letter": [], "name": []}
    for kind, lst in (("word", WORDS), ("letter", LETTERS), ("name", NAMES)):
        for t in lst:
            w = build_word(noto, t, NOTO_EM, OUTLINE, INTRA_GAP, log=log)
            if w is None:
                if log is not None:
                    log.append("skipped " + t)
                continue
            items[kind].append(Item(w, kind))
    return items


class Packer:
    def __init__(self, region, seed=1):
        self.rng = np.random.default_rng(seed)
        self.H, self.W = int(round(BOARD_H / RES)), int(round(BOARD_W / RES))
        allowed = rasterize([region.buffer(-CONS)], RES, (RES / 2, RES / 2), (self.H, self.W))
        self.Fp = np.pad((~allowed).astype(np.float32), PAD, constant_values=1.0)
        self.failed = np.zeros((self.H, self.W), bool)
        self.placed = []          # (item, py, px)

    # --- raster helpers -------------------------------------------------
    def F(self):
        return self.Fp[PAD:-PAD, PAD:-PAD]

    def stamp(self, it, py, px):
        h, w = it.D.shape
        sl = self.Fp[PAD + py:PAD + py + h, PAD + px:PAD + px + w]
        sl[it.D] = 1.0
        self.placed.append((it, py, px))
        it.uses += 1

    def fits_anywhere(self, it, extra=None):
        """All top-left positions where item fits (whole board). Returns bool map."""
        F = self.Fp if extra is None else np.maximum(self.Fp, extra)
        R = cv2.matchTemplate(F, it.Mf, cv2.TM_CCORR)
        return R < 0.5          # indexed in padded coords

    # --- one placement attempt around a target pocket --------------------
    def try_item(self, it, ty, tx, rho, bonus):
        h, w = it.M.shape
        y0, y1 = PAD + ty - h - rho, PAD + ty + rho + 1
        x0, x1 = PAD + tx - w - rho, PAD + tx + rho + 1
        if y0 < 0 or x0 < 0:
            return None
        Fw = self.Fp[y0:y1 + h, x0:x1 + w]
        R = cv2.matchTemplate(Fw, it.Mf, cv2.TM_CCORR)
        ok = R < 0.5
        if not ok.any():
            return None
        T = np.zeros(Fw.shape, np.float32)
        cv2.circle(T, (tx + PAD - x0, ty + PAD - y0), max(rho, 1), 1.0, -1)
        C = cv2.matchTemplate(T, it.Mf, cv2.TM_CCORR) > 0.5
        ok &= C
        if not ok.any():
            return None
        K = cv2.matchTemplate(Fw, it.Rf, cv2.TM_CCORR) / it.ring_n
        s = np.where(ok, K + self.rng.random(K.shape) * 0.004, -1e9)
        i = int(np.argmax(s))
        iy, ix = divmod(i, s.shape[1])
        py, px = y0 + iy - PAD, x0 + ix - PAD
        return s[iy, ix] + bonus, py, px

    def pick_target(self):
        free = self.F() < 0.5
        D = ndi.distance_transform_edt(free) * RES
        D[self.failed] = 0
        i = int(np.argmax(D))
        ty, tx = divmod(i, self.W)
        return ty, tx, D[ty, tx]

    def run(self, items, k_words=14, min_pocket=2.3, verbose=True, max_steps=5000):
        words, letters = items["word"], items["letter"]
        amax = max(it.area for it in words)
        t0 = time.time()
        steps = 0
        while steps < max_steps:
            steps += 1
            ty, tx, r = self.pick_target()
            if r < min_pocket:
                break
            rho = int(max(1, min(r, 4.0)) / RES)
            # weighted sample of words: favour the least used
            wts = np.array([1.0 / (1 + it.uses) ** 2 for it in words])
            idx = self.rng.choice(len(words), size=min(k_words, len(words)), replace=False, p=wts / wts.sum())
            best = None
            for j in idx:
                it = words[j]
                bonus = 0.45 * np.sqrt(it.area / amax) - 0.02 * it.npieces
                res = self.try_item(it, ty, tx, rho, bonus)
                if res and (best is None or res[0] > best[0]):
                    best = (res[0], it, res[1], res[2])
            if best is None or best[0] < 0.30:
                for it in letters:
                    bonus = 0.2 * np.sqrt(it.area / amax) - 0.25 - 0.03 * it.uses
                    res = self.try_item(it, ty, tx, rho, bonus)
                    if res and (best is None or res[0] > best[0]):
                        best = (res[0], it, res[1], res[2])
            if best is None:
                rr = max(r, 1.5) / RES
                yy, xx = np.ogrid[:self.H, :self.W]
                self.failed |= (yy - ty) ** 2 + (xx - tx) ** 2 <= rr * rr
                continue
            _, it, py, px = best
            self.stamp(it, py, px)
            if verbose and len(self.placed) % 25 == 0:
                cov = self.coverage()
                print(f"  {len(self.placed)} placed, pocket {r:.1f} mm, coverage {cov:.3f}, {time.time()-t0:.0f}s", flush=True)
        return self.placed

    # --- global greedy: the snuggest fit anywhere on the board ---------------
    def _coarse(self, it):
        if not hasattr(it, "Mc"):
            def pool(a):
                h, w = a.shape
                a = np.pad(a, ((0, h % 2), (0, w % 2)))
                return a.reshape(a.shape[0] // 2, 2, a.shape[1] // 2, 2).max(axis=(1, 3))
            it.Mc = pool(it.M).astype(np.float32)
            rc = pool(it.Rf > 0.5) & ~pool(it.M)
            it.Rc = rc.astype(np.float32)
            it.rc_n = float(rc.sum())
        return it

    def _fine_best(self, it, py, px, r=4):
        """Best snug position at full resolution within +-r px of (py, px)."""
        h, w = it.M.shape
        y0, x0 = PAD + py - r, PAD + px - r
        Fw = self.Fp[y0:y0 + h + 2 * r, x0:x0 + w + 2 * r]
        if Fw.shape[0] < h + 2 * r or Fw.shape[1] < w + 2 * r:
            return None
        R = cv2.matchTemplate(Fw, it.Mf, cv2.TM_CCORR)
        ok = R < 0.5
        if not ok.any():
            return None
        K = cv2.matchTemplate(Fw, it.Rf, cv2.TM_CCORR) / it.ring_n
        s = np.where(ok, K, -1e9)
        i = int(np.argmax(s))
        iy, ix = divmod(i, s.shape[1])
        return float(s[iy, ix]), py - r + iy, px - r + ix

    def run_global(self, items, k_words=12, k_letters=4, verbose=True, letter_penalty=0.22,
                   size_w=0.5, top=3):
        words = [self._coarse(it) for it in items["word"]]
        letters = [self._coarse(it) for it in items["letter"]]
        alive = set(range(len(words))), set(range(len(letters)))
        amax = max(it.area for it in words)
        t0 = time.time()
        while alive[0] or alive[1]:
            F = self.F()
            Fc = np.pad(F, ((0, F.shape[0] % 2), (0, F.shape[1] % 2)), constant_values=1)
            Fc = Fc.reshape(Fc.shape[0] // 2, 2, Fc.shape[1] // 2, 2).max(axis=(1, 3))
            cands = []
            for pool_, live, k in ((words, alive[0], k_words), (letters, alive[1], k_letters)):
                live = sorted(live)
                if not live:
                    continue
                wts = np.array([1.0 / (1 + pool_[i].uses) ** 2 for i in live])
                pick = self.rng.choice(live, size=min(k, len(live)), replace=False, p=wts / wts.sum())
                cands += [(pool_, i) for i in pick]
            best = None
            for pool_, i in cands:
                it = pool_[i]
                if it.Mc.shape[0] > Fc.shape[0] or it.Mc.shape[1] > Fc.shape[1]:
                    continue
                R = cv2.matchTemplate(Fc, it.Mc, cv2.TM_CCORR)
                ok = R < 0.5
                if not ok.any():
                    # coarse grid is conservative: confirm at full resolution before retiring
                    Rf = cv2.matchTemplate(F, it.Mf, cv2.TM_CCORR)
                    if not (Rf < 0.5).any():
                        (alive[0] if pool_ is words else alive[1]).discard(i)
                        continue
                    ys, xs = np.nonzero(Rf < 0.5)
                    j = self.rng.integers(len(ys))
                    coarse_pos = [(ys[j] // 2, xs[j] // 2)]
                else:
                    K = cv2.matchTemplate(Fc, it.Rc, cv2.TM_CCORR) / it.rc_n
                    s = np.where(ok, K + self.rng.random(K.shape) * 0.01, -1e9)
                    flat = np.argpartition(-s.ravel(), min(top, s.size - 1))[:top]
                    coarse_pos = [divmod(int(f), s.shape[1]) for f in flat if s.ravel()[f] > -1e8]
                bonus = size_w * np.sqrt(it.area / amax) - 0.02 * it.npieces - 0.05 * it.uses
                if pool_ is letters:
                    bonus -= letter_penalty
                for cy, cx in coarse_pos:
                    r = self._fine_best(it, 2 * cy, 2 * cx)
                    if r is None:
                        continue
                    sc = r[0] + bonus
                    if best is None or sc > best[0]:
                        best = (sc, it, r[1], r[2])
            if best is None:
                continue
            _, it, py, px = best
            self.stamp(it, py, px)
            if verbose and len(self.placed) % 25 == 0:
                print(f"  {len(self.placed)} placed ({len(alive[0])} words, {len(alive[1])} letters still fit), "
                      f"{time.time()-t0:.0f}s", flush=True)
        return self.placed

    def coverage(self, region_mask=None):
        occ = np.zeros((self.H, self.W), bool)
        for it, py, px in self.placed:
            h, w = it.M.shape
            occ[max(0, py):py + h, max(0, px):px + w] |= it.M[max(0, -py):, max(0, -px):][:min(h, self.H - py), :min(w, self.W - px)]
        allowed = self.F() < 0.5
        return occ.sum() / max(1, (occ | allowed).sum())


def _overlap(a, pa, b, pb):
    """Does item a's mask at pa collide with item b's gap-dilated mask at pb?"""
    (ay, ax), (by, bx) = pa, pb
    ha, wa = a.M.shape
    hb, wb = b.D.shape
    y0, y1 = max(ay, by), min(ay + ha, by + hb)
    x0, x1 = max(ax, bx), min(ax + wa, bx + wb)
    if y0 >= y1 or x0 >= x1:
        return False
    return bool((a.M[y0 - ay:y1 - ay, x0 - ax:x1 - ax] & b.D[y0 - by:y1 - by, x0 - bx:x1 - bx]).any())


def place_names(pk, names, avoid_geom, trials=400):
    """Place the five Names first: clear of the verse, spread as far apart as possible.

    Randomised greedy with restarts; keeps the arrangement whose closest pair of
    Names is furthest apart.
    """
    extra = np.zeros_like(pk.Fp)
    av = rasterize([avoid_geom], RES, (RES / 2, RES / 2), (pk.H, pk.W))
    extra[PAD:-PAD, PAD:-PAD] = av.astype(np.float32)
    cand = {}
    for it in names:
        ok = pk.fits_anywhere(it, extra)
        ys, xs = np.nonzero(ok[::4, ::4])
        ys, xs = ys * 4 - PAD, xs * 4 - PAD
        if len(ys) == 0:
            raise RuntimeError("no room at all for " + it.text)
        h, w = it.M.shape
        cand[it.text] = (ys, xs, ys + h / 2, xs + w / 2)
    rng = pk.rng
    best = None
    for _ in range(trials):
        order = sorted(names, key=lambda it: len(cand[it.text][0]) * rng.uniform(0.5, 1.5))
        placed = []
        for it in order:
            ys, xs, cy, cx = cand[it.text]
            if placed:
                d = np.min([np.hypot(cy - a, cx - b) for _, _, a, b in placed], axis=0) * RES
            else:
                d = rng.random(len(ys)) * 100
            idx = np.argsort(-(d + rng.random(len(ys)) * 30))[:300]
            for i in idx:
                p = (ys[i], xs[i])
                if all(not _overlap(it, p, o, (oy, ox)) for o, (oy, ox), _, _ in
                       [(q[0], q[1], None, None) for q in placed]):
                    placed.append((it, p, cy[i], cx[i]))
                    break
            else:
                break
        if len(placed) < len(names):
            continue
        dmin = min(np.hypot(placed[i][2] - placed[j][2], placed[i][3] - placed[j][3])
                   for i in range(len(placed)) for j in range(i + 1, len(placed))) * RES
        if best is None or dmin > best[0]:
            best = (dmin, placed)
    if best is None:
        raise RuntimeError("could not fit all five Names clear of the verse")
    for it, (py, px), _, _ in best[1]:
        pk.stamp(it, py, px)
    print("  names placed, closest pair %.0f mm apart" % best[0], flush=True)
    return best[1]


def assemble(placed):
    out = []
    for it, py, px in placed:
        out.append({"text": it.text, "kind": it.kind, "pieces": it.world_pieces(py, px)})
    return out


def support_verse(pk, items, verse_pieces, max_area=450.0, want=0.45, n_try=40):
    """Before the fill: put wood under every small verse piece (dots, harakat)."""
    pool = items["word"] + items["letter"]
    for vp in sorted(verse_pieces, key=lambda p: p.area):
        if vp.area > max_area:
            continue
        S = rasterize([vp], RES, (RES / 2, RES / 2), (pk.H, pk.W))
        ys, xs = np.nonzero(S)
        n = float(len(ys))
        cy, cx = int(ys.mean()), int(xs.mean())
        best = None
        for j in pk.rng.choice(len(pool), size=min(n_try, len(pool)), replace=False):
            it = pool[j]
            h, w = it.M.shape
            y0, x0 = PAD + cy - h, PAD + cx - w
            Fw = pk.Fp[y0:y0 + 2 * h, x0:x0 + 2 * w]
            Sw = np.zeros_like(Fw)
            sy0, sx0 = cy - h, cx - w
            sub = S[max(0, sy0):sy0 + 2 * h, max(0, sx0):sx0 + 2 * w]
            Sw[max(0, -sy0):max(0, -sy0) + sub.shape[0], max(0, -sx0):max(0, -sx0) + sub.shape[1]] = sub
            R = cv2.matchTemplate(Fw, it.Mf, cv2.TM_CCORR)
            O = cv2.matchTemplate(Sw, it.Mf, cv2.TM_CCORR) / n
            K = cv2.matchTemplate(Fw, it.Rf, cv2.TM_CCORR) / it.ring_n
            s = np.where((R < 0.5) & (O >= want), O + K + 0.3 * (it.kind == "word"), -1e9)
            i = int(np.argmax(s))
            iy, ix = divmod(i, s.shape[1])
            if s[iy, ix] > -1e8 and (best is None or s[iy, ix] > best[0]):
                best = (s[iy, ix], it, y0 + iy - PAD, x0 + ix - PAD)
        if best is not None:
            pk.stamp(best[1], best[2], best[3])


if __name__ == "__main__":
    import sys
    seed = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    verse_file = sys.argv[2] if len(sys.argv) > 2 else "data/verse.pkl"
    out_file = sys.argv[3] if len(sys.argv) > 3 else "data/background.pkl"
    t = time.time()
    log = []
    items = build_items(log)
    print("items", {k: len(v) for k, v in items.items()}, log, "%.0fs" % (time.time() - t), flush=True)
    vp, vk, vl = pickle.load(open(verse_file, "rb"))
    verse = unary_union(vp)
    region = lettering_region()
    pk = Packer(region, seed=seed)
    place_names(pk, items["name"], verse.buffer(8.0))
    support_verse(pk, items, vp)
    print("  verse supports placed:", len(pk.placed) - 5, flush=True)
    pk.run_global(items)
    res = assemble(pk.placed)
    pickle.dump(res, open(out_file, "wb"))
    print("done", len(res), "words, %.0fs" % (time.time() - t))
