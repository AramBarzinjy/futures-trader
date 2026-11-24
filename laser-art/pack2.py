"""Background packer v2: greedy snug fill + ruin-and-recreate optimisation.

Why v2: a pure greedy fill of same-size Arabic words lines them up like text
(rows) and stalls near 37 % coverage, leaving channels no word fits into.
Here every word also exists in a few near-identical variants (size +-5 %,
tilt +-3 deg) and a large-neighbourhood search repeatedly clears a random patch
and refills it, keeping the refill only when it puts more wood in the patch.
That breaks rows up and packs noticeably denser.

Raster at 0.25 mm with conservative masks (see pack.py); exact vector check after.
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
from fontgeom import Font, Word, build_word
from rasterops import fast_rasterize, rasterize
from vocab import EXTRA, LETTERS, NAMES, WORDS

RES = 0.25
CONS = 0.18
GAP_RASTER = 1.85          # real gap >= 1.85 - 0.354 = ~1.5 mm; typical contact 1.8-2.2 mm
RING = 1.25
NOTO_EM = 32.0 / 671 * 1000
OUTLINE = 1.0
INTRA_GAP = 2.0
PAD = 300


def disk(r):
    k = int(np.ceil(r))
    y, x = np.ogrid[-k:k + 1, -k:k + 1]
    return (x * x + y * y) <= r * r


def _pool2(a):
    h, w = a.shape
    a = np.pad(a, ((0, h % 2), (0, w % 2)))
    return a.reshape(a.shape[0] // 2, 2, a.shape[1] // 2, 2).max(axis=(1, 3))


class Item:
    def __init__(self, word, kind, scale=1.0, rot=0.0, form=""):
        self.word, self.kind, self.text = word, kind, word.text
        self.form = form or word.text          # spelling incl. any kashida
        self.scale, self.rot = scale, rot
        g = unary_union(word.pieces)
        minx, miny, maxx, maxy = g.bounds
        pad = int(np.ceil(GAP_RASTER / RES)) + 4
        self.x0, self.y0 = minx - pad * RES, miny - pad * RES
        h = int(np.ceil((maxy - miny) / RES)) + 2 * pad + 1
        w = int(np.ceil((maxx - minx) / RES)) + 2 * pad + 1
        M = fast_rasterize([p.buffer(CONS, quad_segs=4) for p in word.pieces], RES, (self.x0, self.y0), (h, w))
        self.M = M
        self.D = cv2.dilate(M.view(np.uint8), _KG).astype(bool)
        ring = cv2.dilate(M.view(np.uint8), _KR).astype(bool) & ~M
        self.ring = ring
        self.ring_n = float(ring.sum())
        self.Mcb = _pool2(M)
        self.Rcb = _pool2(ring) & ~self.Mcb
        self.rc_n = float(self.Rcb.sum())
        self.area = float(sum(p.area for p in word.pieces))
        self.npieces = len(word.pieces)
        ys, xs = np.nonzero(M)
        self.cy, self.cx = ys.mean(), xs.mean()

    # float32 templates on demand (keeps memory down with thousands of variants)
    @property
    def Mf(self):
        return self.M.astype(np.float32)

    @property
    def Rf(self):
        return self.ring.astype(np.float32)

    @property
    def Mc(self):
        return self.Mcb.astype(np.float32)

    @property
    def Rc(self):
        return self.Rcb.astype(np.float32)

    def world_pieces(self, py, px):
        dx = RES / 2 + px * RES - self.x0
        dy = RES / 2 + py * RES - self.y0
        return [affinity.translate(p, dx, dy) for p in self.word.pieces]


# Gap kernel is an ellipse: words side by side on a line keep WORD_GAP_X apart so two
# words never read as one string; above/below they may interlock at GAP_RASTER.
WORD_GAP_X = 4.3     # mm raster (real >= ~3.9 mm)
LETTER_SEP = 20.0    # mm: lone letters never sit next to each other (no accidental strings)
_KG = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * int(WORD_GAP_X / RES) + 1, 2 * int(GAP_RASTER / RES) + 1))
_KR = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * int(RING / RES) + 1,) * 2)


def _variant(word, s, r):
    c = unary_union(word.pieces).centroid
    ps = [affinity.rotate(affinity.scale(p, s, s, origin=c), r, origin=c) for p in word.pieces]
    return Word(word.text, ps, word.kinds, word.raw)


DUAL = set("بتثجحخسشصضطظعغفقكلمنهيئى")
LETTERSET = set(chr(c) for c in range(0x0621, 0x064B))


def kashida_forms(t, n=2):
    """The word plus up to n elongated spellings (one tatweel at a joining point)."""
    pos = [i for i in range(1, len(t)) if t[i - 1] in DUAL and t[i] in LETTERSET
           and not (t[i - 1] == "ل" and t[i] in "اأإآ")]
    if not pos:
        return [t]
    mid = (len(t) - 1) / 2
    pos.sort(key=lambda i: abs(i - mid))
    return [t] + [t[:i] + "ـ" + t[i:] for i in pos[:n]]


def _build_one(args):
    text, kind, scales, rots = args
    noto = Font("NotoNaskhArabic-VF.ttf")
    out = []
    forms = [text] if kind != "word" else kashida_forms(text)
    for f in forms:
        w = build_word(noto, f, NOTO_EM, OUTLINE, INTRA_GAP, max_mark_move=9.0)
        if w is None:
            continue
        w.text = text
        if kind == "name":
            out.append(Item(w, kind, form=f))
        else:
            out += [Item(_variant(w, s, r), kind, s, r, form=f) for s in scales for r in rots]
    return kind, text, out


FILLER_SCALE = 0.62


def _build_filler(args):
    text, rots = args
    noto = Font("NotoNaskhArabic-VF.ttf")
    w = build_word(noto, text, NOTO_EM * FILLER_SCALE, OUTLINE, 1.8, max_mark_move=6.0)
    if w is None:
        return text, []
    return text, [Item(_variant(w, 1.0, r), "filler", FILLER_SCALE, r) for r in rots]


def build_fillers(texts, rots=(-4.0, 0.0, 4.0), workers=4):
    from concurrent.futures import ProcessPoolExecutor
    out = {}
    with ProcessPoolExecutor(workers) as ex:
        for t, its in ex.map(_build_filler, [(t, rots) for t in texts]):
            if its:
                out[t] = its
    return out


def build_items(scales=(0.94, 1.0, 1.06), rots=(-2.5, 0.0, 2.5), log=None, workers=4):
    from concurrent.futures import ProcessPoolExecutor
    groups = {"word": {}, "letter": {}, "name": {}}
    jobs = [(t, k, scales, rots) for k, lst in (("word", WORDS + EXTRA), ("letter", LETTERS), ("name", NAMES))
            for t in dict.fromkeys(lst)]
    with ProcessPoolExecutor(workers) as ex:
        for kind, text, its in ex.map(_build_one, jobs, chunksize=4):
            if its:
                groups[kind][text] = its
            elif log is not None:
                log.append("skipped " + text)
    return groups


class State:
    def __init__(self, region, seed=1):
        self.rng = np.random.default_rng(seed)
        self.H, self.W = int(round(BOARD_H / RES)), int(round(BOARD_W / RES))
        allowed = rasterize([region.buffer(-CONS)], RES, (RES / 2, RES / 2), (self.H, self.W))
        self.Bp = np.pad(~allowed, PAD, constant_values=True)
        self.cnt = np.zeros(self.Bp.shape, np.int16)
        self.recs = []          # [item, py, px, fixed]
        self.uses = {}
        self.lex = np.zeros(self.Bp.shape, np.int16)   # zones where another lone letter may not go
        # straight board edges: still forbidden, but they don't "attract" words (that made rows)
        yy = np.arange(self.Bp.shape[0])[:, None] - PAD
        self.edge = ((yy * RES < 6.0) | (yy * RES > BOARD_H - 6.0)) & self.Bp

    def Fwin(self, y0, y1, x0, x1, lone=False, contact=False):
        """Forbidden map (float32) for board-pixel window [y0,y1) x [x0,x1)."""
        b = self.Bp[PAD + y0:PAD + y1, PAD + x0:PAD + x1]
        if contact:
            b = b & ~self.edge[PAD + y0:PAD + y1, PAD + x0:PAD + x1]
        a = (b | (self.cnt[PAD + y0:PAD + y1, PAD + x0:PAD + x1] > 0))
        if lone:
            a = a | (self.lex[PAD + y0:PAD + y1, PAD + x0:PAD + x1] > 0)
        return a.astype(np.float32)

    def _lex_box(self, it, py, px):
        e = int(LETTER_SEP / RES)
        h, w = it.D.shape
        return (max(0, PAD + py - e), PAD + py + h + e, max(0, PAD + px - e), PAD + px + w + e)

    def add(self, it, py, px, fixed=False):
        h, w = it.D.shape
        self.cnt[PAD + py:PAD + py + h, PAD + px:PAD + px + w] += it.D
        if it.kind in ("letter", "filler"):
            y0, y1, x0, x1 = self._lex_box(it, py, px)
            self.lex[y0:y1, x0:x1] += 1
        self.recs.append([it, py, px, fixed])
        self.uses[it.text] = self.uses.get(it.text, 0) + 1

    def remove(self, rec):
        it, py, px, _ = rec
        h, w = it.D.shape
        self.cnt[PAD + py:PAD + py + h, PAD + px:PAD + px + w] -= it.D
        if it.kind in ("letter", "filler"):
            y0, y1, x0, x1 = self._lex_box(it, py, px)
            self.lex[y0:y1, x0:x1] -= 1
        self.recs.remove(rec)
        self.uses[it.text] -= 1

    def area(self):
        return sum(r[0].area for r in self.recs)

    # ------------------------------------------------------------------
    def best_in_window(self, cands, y0, y1, x0, x1, amax, noise=0.03, top=3, coarse=True):
        """Best (score, item, py, px) among candidates overlapping window."""
        best = None
        for it, bonus in cands:
            h, w = it.M.shape
            wy0, wy1 = y0 - h + 1, y1 + h - 1
            wx0, wx1 = x0 - w + 1, x1 + w - 1
            wy0, wx0 = max(wy0, -PAD + 1), max(wx0, -PAD + 1)
            wy1, wx1 = min(wy1, self.H + PAD - 1), min(wx1, self.W + PAD - 1)
            if wy1 - wy0 < h or wx1 - wx0 < w:
                continue
            F = self.Fwin(wy0, wy1, wx0, wx1, lone=it.kind in ("letter", "filler"))
            Fk = self.Fwin(wy0, wy1, wx0, wx1, contact=True)
            if coarse:
                Fc = _pool2(F)
                Fkc = _pool2(Fk)
                if Fc.shape[0] < it.Mc.shape[0] or Fc.shape[1] < it.Mc.shape[1]:
                    continue
                R = cv2.matchTemplate(Fc, it.Mc, cv2.TM_CCORR)
                ok = R < 0.5
                if not ok.any():
                    continue
                K = cv2.matchTemplate(Fkc, it.Rc, cv2.TM_CCORR) / it.rc_n
                s = np.where(ok, K + self.rng.random(K.shape) * noise, -1e9)
                n = min(top, s.size)
                flat = np.argpartition(-s.ravel(), n - 1)[:n]
                poss = [divmod(int(f), s.shape[1]) for f in flat if s.ravel()[f] > -1e8]
                for cy, cx in poss:
                    r = self._refine(it, wy0 + 2 * cy, wx0 + 2 * cx)
                    if r is None:
                        continue
                    sc = r[0] + bonus
                    if best is None or sc > best[0]:
                        best = (sc, it, r[1], r[2])
            else:
                R = cv2.matchTemplate(F, it.Mf, cv2.TM_CCORR)
                ok = R < 0.5
                if not ok.any():
                    continue
                K = cv2.matchTemplate(Fk, it.Rf, cv2.TM_CCORR) / it.ring_n
                s = np.where(ok, K + self.rng.random(K.shape) * noise, -1e9)
                i = int(np.argmax(s))
                iy, ix = divmod(i, s.shape[1])
                sc = s[iy, ix] + bonus
                if best is None or sc > best[0]:
                    best = (sc, it, wy0 + iy, wx0 + ix)
        return best

    def _refine(self, it, py, px, r=3):
        h, w = it.M.shape
        F = self.Fwin(py - r, py + h + r, px - r, px + w + r, lone=it.kind in ("letter", "filler"))
        R = cv2.matchTemplate(F, it.Mf, cv2.TM_CCORR)
        ok = R < 0.5
        if not ok.any():
            return None
        Fk = self.Fwin(py - r, py + h + r, px - r, px + w + r, contact=True)
        K = cv2.matchTemplate(Fk, it.Rf, cv2.TM_CCORR) / it.ring_n
        s = np.where(ok, K, -1e9)
        i = int(np.argmax(s))
        iy, ix = divmod(i, s.shape[1])
        return float(s[iy, ix]), py - r + iy, px - r + ix


class Packer2:
    def __init__(self, region, groups, seed=1, size_w=0.45, letter_pen=0.25):
        self.st = State(region, seed)
        self.g = groups
        self.rng = self.st.rng
        self.words = list(groups["word"].keys())
        self.letters = list(groups["letter"].keys())
        self.amax = max(v[0].area for v in groups["word"].values())
        self.size_w, self.letter_pen = size_w, letter_pen
        self.max_letters = 16

    def _bonus(self, it):
        b = self.size_w * np.sqrt(it.area / self.amax) - 0.02 * it.npieces
        if it.kind == "letter":
            nl = sum(1 for r in self.st.recs if r[0].kind == "letter")
            if nl >= self.max_letters:
                return -1e6
        b -= 0.06 * self.st.uses.get(it.text, 0)
        if it.kind == "letter":
            b -= self.letter_pen
        return b

    def sample(self, k_words, k_letters):
        out = []
        for keys, k, kind in ((self.words, k_words, "word"), (self.letters, k_letters, "letter")):
            if k <= 0:
                continue
            u = np.array([self.st.uses.get(t, 0) for t in keys], float)
            p = 1.0 / (1 + u) ** 2
            pick = self.rng.choice(len(keys), size=min(k, len(keys)), replace=False, p=p / p.sum())
            for j in pick:
                vs = self.g[kind][keys[j]]
                it = vs[self.rng.integers(len(vs))]
                out.append((it, self._bonus(it)))
        return out

    def fill(self, y0, y1, x0, x1, k_words=14, k_letters=5, max_steps=10000, coarse=True, quiet=True, max_miss=2):
        """Greedy: keep adding the best snug fit overlapping the window."""
        added = []
        misses = 0
        for _ in range(max_steps):
            cands = self.sample(k_words, k_letters)
            b = self.st.best_in_window(cands, y0, y1, x0, x1, self.amax, coarse=coarse)
            if b is None:
                misses += 1
                if misses >= max_miss:
                    break
                continue
            if b[0] < -1e5:
                misses += 1
                if misses >= max_miss:
                    break
                continue
            misses = 0
            _, it, py, px = b
            self.st.add(it, py, px)
            added.append(self.st.recs[-1])
            if not quiet and len(added) % 25 == 0:
                print(f"   fill: {len(added)} added", flush=True)
        return added

    def fill_fillers(self, fillers, max_miss=8, k=16):
        """Final pass: small letters / short words into pockets nothing else fits."""
        keys = list(fillers.keys())
        n0 = len(self.st.recs)
        misses = 0
        while misses < max_miss:
            pick = self.rng.choice(len(keys), size=min(k, len(keys)), replace=False)
            cands = []
            for j in pick:
                vs = fillers[keys[j]]
                it = vs[self.rng.integers(len(vs))]
                cands.append((it, 0.3 * np.sqrt(it.area / self.amax) - 0.05 * self.st.uses.get(it.text, 0)))
            b = self.st.best_in_window(cands, 0, self.st.H, 0, self.st.W, self.amax)
            if b is None:
                misses += 1
                continue
            misses = 0
            self.st.add(b[1], b[2], b[3])
        return len(self.st.recs) - n0

    def lns(self, iters, win=(45, 75), verbose=True, log_every=50, attempts=2):
        """Ruin and recreate: clear a patch, refill it (best of a few tries), keep if denser."""
        st = self.st
        t0 = time.time()
        acc = 0
        H, W = st.H, st.W
        pts = None
        base_w = self.size_w
        for k in range(iters):
            if k % 20 == 0:
                F = st.Fwin(0, H, 0, W) < 0.5
                D = ndi.distance_transform_edt(F)
                pts = np.argwhere(D * RES > 2.5)
            if pts is None or len(pts) == 0:
                break
            cy, cx = pts[self.rng.integers(len(pts))]
            hh = int(self.rng.uniform(win[0] * 0.7, win[0] * 1.3) / RES / 2)
            ww = int(self.rng.uniform(win[1] * 0.7, win[1] * 1.3) / RES / 2)
            y0, y1, x0, x1 = cy - hh, cy + hh, cx - ww, cx + ww
            rem = [r for r in st.recs if not r[3] and y0 <= r[1] + r[0].cy <= y1 and x0 <= r[2] + r[0].cx <= x1]
            old = sum(r[0].area for r in rem)
            for r in rem:
                st.remove(r)
            best_new, best_set = -1.0, None
            for a in range(attempts):
                self.size_w = base_w * self.rng.uniform(0.5, 1.5)
                added = self.fill(y0, y1, x0, x1, k_words=10, k_letters=4)
                new = sum(r[0].area for r in added)
                if new > best_new:
                    if best_set is not None:
                        pass
                    best_new = new
                    best_set = [(r[0], r[1], r[2]) for r in added]
                for r in added:
                    st.remove(r)
            self.size_w = base_w
            if best_new > old + 1.0:
                for it, py, px in best_set:
                    st.add(it, py, px)
                acc += 1
            else:
                for r in rem:
                    st.add(r[0], r[1], r[2], r[3])
            if verbose and (k + 1) % log_every == 0:
                print(f"  lns {k+1}/{iters}: area {st.area():.0f} mm2, accepted {acc}, {time.time()-t0:.0f}s", flush=True)
        return acc


def _overlap(a, pa, b, pb):
    (ay, ax), (by, bx) = pa, pb
    ha, wa = a.M.shape
    hb, wb = b.D.shape
    y0, y1 = max(ay, by), min(ay + ha, by + hb)
    x0, x1 = max(ax, bx), min(ax + wa, bx + wb)
    if y0 >= y1 or x0 >= x1:
        return False
    return bool((a.M[y0 - ay:y1 - ay, x0 - ax:x1 - ax] & b.D[y0 - by:y1 - by, x0 - bx:x1 - bx]).any())


def place_names(pk, avoid_geom, trials=600, line_gap=55.0, col_gap=30.0, min_gap=20.0):
    """Five Names, clear of the verse, as far apart (edge to edge) as the board allows."""
    st = pk.st
    names = [v[0] for v in pk.g["name"].values()]
    av = rasterize([avoid_geom], RES, (RES / 2, RES / 2), (st.H, st.W))
    F = st.Fwin(0, st.H, 0, st.W)
    F = np.maximum(F, av.astype(np.float32))
    cand = {}
    for it in names:
        ok = cv2.matchTemplate(F, it.Mf, cv2.TM_CCORR) < 0.5
        ys, xs = np.nonzero(ok[::4, ::4])
        ys, xs = ys * 4, xs * 4
        if len(ys) == 0:
            raise RuntimeError("no room at all for " + it.text)
        h, w = it.M.shape
        # tight box of the ink, in board px
        yy, xx = np.nonzero(it.M)
        cand[it.text] = (ys, xs, yy.min(), yy.max(), xx.min(), xx.max())
    rng = pk.rng

    def gaps(c, placed):
        ys, xs, a0, a1, b0, b1 = c
        g = np.full(len(ys), 1e9)
        for (_, (py, px), box) in placed:
            y0, y1, x0, x1 = box
            dy = np.maximum(0, np.maximum(y0 - (ys + a1), (ys + a0) - y1))
            dx = np.maximum(0, np.maximum(x0 - (xs + b1), (xs + b0) - x1))
            g = np.minimum(g, np.hypot(dx, dy) * RES)
        return g

    best = None
    for _ in range(trials):
        order = list(names)
        rng.shuffle(order)
        placed = []
        for it in order:
            c = cand[it.text]
            ys, xs, a0, a1, b0, b1 = c
            g = gaps(c, placed) if placed else np.full(len(ys), 200.0)
            edge = np.minimum((ys + a0) * RES, BOARD_H - (ys + a1) * RES)
            # hard rules: two Names sharing a line sit >= 55 mm apart; sharing a
            # column, >= 30 mm apart; never closer than 20 mm in any direction
            bad = np.zeros(len(ys), bool)
            for (_, _, (Y0, Y1, X0, X1)) in placed:
                yov = np.minimum(ys + a1, Y1) - np.maximum(ys + a0, Y0)
                xov = np.minimum(xs + b1, X1) - np.maximum(xs + b0, X0)
                xgap = np.maximum(0, np.maximum(X0 - (xs + b1), (xs + b0) - X1)) * RES
                ygap = np.maximum(0, np.maximum(Y0 - (ys + a1), (ys + a0) - Y1)) * RES
                bad |= (yov > 0.2 * (a1 - a0)) & (xgap < line_gap)
                bad |= (xov > 0.2 * (b1 - b0)) & (ygap < col_gap)
            bad |= g < min_gap
            sc = np.minimum(g, 200.0) - np.where(edge < 6.0, 30.0, 0.0) + rng.random(len(ys)) * 15
            sc[bad] = -1e9
            for i in np.argsort(-sc)[:200]:
                if sc[i] < -1e8:
                    break
                p = (ys[i], xs[i])
                if all(not _overlap(it, p, q[0], q[1]) for q in placed):
                    placed.append((it, p, (ys[i] + a0, ys[i] + a1, xs[i] + b0, xs[i] + b1)))
                    break
            else:
                break
        if len(placed) < len(names):
            continue
        dmin = min(gaps(cand[placed[i][0].text], [placed[j]])[0] if False else 0 for i in range(1))
        # recompute pairwise box gaps
        bx = [q[2] for q in placed]
        dmin = 1e9
        for i in range(len(bx)):
            for j in range(i + 1, len(bx)):
                y0, y1, x0, x1 = bx[i]
                Y0, Y1, X0, X1 = bx[j]
                dy = max(0, Y0 - y1, y0 - Y1)
                dx = max(0, X0 - x1, x0 - X1)
                dmin = min(dmin, np.hypot(dx, dy) * RES)
        if best is None or dmin > best[0]:
            best = (dmin, placed)
    if best is None:
        raise RuntimeError("could not fit all five Names clear of the verse")
    for it, (py, px), _ in best[1]:
        st.add(it, py, px, fixed=True)
    return best[0]


def support_verse(pk, verse_pieces, max_area=1e9, want=0.35, n_try=40):
    """Wood under every small verse piece (dots, harakat) before the fill."""
    st = pk.st
    for vp in sorted(verse_pieces, key=lambda p: p.area):
        if vp.area > max_area:
            continue
        S = rasterize([vp], RES, (RES / 2, RES / 2), (st.H, st.W))
        ys, xs = np.nonzero(S)
        n = float(len(ys))
        cy, cx = int(ys.mean()), int(xs.mean())
        best = None
        cands = pk.sample(n_try - 8, 8)
        for it, _ in cands:
            h, w = it.M.shape
            y0, x0 = cy - h, cx - w
            F = st.Fwin(y0, y0 + 2 * h, x0, x0 + 2 * w)
            Sw = np.zeros_like(F)
            sy0, sx0 = max(0, y0), max(0, x0)
            sub = S[sy0:y0 + 2 * h, sx0:x0 + 2 * w]
            Sw[sy0 - y0:sy0 - y0 + sub.shape[0], sx0 - x0:sx0 - x0 + sub.shape[1]] = sub
            R = cv2.matchTemplate(F, it.Mf, cv2.TM_CCORR)
            O = cv2.matchTemplate(Sw, it.Mf, cv2.TM_CCORR) / n
            K = cv2.matchTemplate(F, it.Rf, cv2.TM_CCORR) / it.ring_n
            s = np.where((R < 0.5) & (O >= want), O + K + 0.3 * (it.kind == "word"), -1e9)
            i = int(np.argmax(s))
            iy, ix = divmod(i, s.shape[1])
            if s[iy, ix] > -1e8 and (best is None or s[iy, ix] > best[0]):
                best = (s[iy, ix], it, y0 + iy, x0 + ix)
        if best is not None:
            st.add(best[1], best[2], best[3], fixed=True)


def assemble(st):
    return [{"text": it.text, "form": it.form, "kind": it.kind, "scale": it.scale, "rot": it.rot,
             "pieces": it.world_pieces(py, px)} for it, py, px, _ in st.recs]


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--verse", default="data/verse.pkl")
    ap.add_argument("--out", default="data/background.pkl")
    ap.add_argument("--lns", type=int, default=600)
    ap.add_argument("--clip", type=float, nargs=4, default=None, help="x0 y0 x1 y1 mm sub-area (testing)")
    ap.add_argument("--mixed", action="store_true", help="also allow smaller words (75-85 %%) as gap fillers")
    a = ap.parse_args()
    t = time.time()
    log = []
    groups = build_items(log=log, scales=(0.75, 0.85, 0.94, 1.0, 1.06) if a.mixed else (0.94, 1.0, 1.06))
    print("items", {k: len(v) for k, v in groups.items()}, log, "%.0fs" % (time.time() - t), flush=True)
    vp, vk, vl = pickle.load(open(a.verse, "rb"))
    verse = unary_union(vp)
    region = lettering_region()
    if a.clip:
        from shapely.geometry import box
        region = region.intersection(box(*a.clip))
    pk = Packer2(region, groups, seed=a.seed, letter_pen=0.5)
    if not a.clip:
        for lg, cg, mg in ((55, 30, 20), (45, 25, 15), (38, 20, 12), (30, 15, 8), (0, 0, 0)):
            try:
                d = place_names(pk, verse.buffer(4.0), line_gap=lg, col_gap=cg, min_gap=mg)
                print(f"  name rules: same line >= {lg} mm, same column >= {cg} mm", flush=True)
                break
            except RuntimeError:
                continue
        print("  names placed, closest pair %.0f mm" % d, flush=True)
    support_verse(pk, vp if not a.clip else [p for p in vp if p.within(region)])
    print("  supports placed", len(pk.st.recs), flush=True)
    st = pk.st
    pk.fill(0, st.H, 0, st.W, quiet=False, max_miss=6)
    print("  greedy done: %d items, area %.0f mm2 (%.3f), %.0fs" % (len(st.recs), st.area(), st.area() / region.area, time.time() - t), flush=True)
    pk.lns(a.lns)
    pk.letter_pen = 0.35
    pk.fill(0, st.H, 0, st.W, max_miss=8, k_words=20, k_letters=6)
    print("done A: %d items, area %.0f mm2 (%.3f), %.0fs" % (len(st.recs), st.area(), st.area() / region.area, time.time() - t), flush=True)
    pickle.dump(assemble(st), open(a.out, "wb"))
    fl = build_fillers(LETTERS + [w for w in WORDS + EXTRA if len(w) == 2])
    n = pk.fill_fillers(fl)
    print("done B: +%d fillers, area %.0f mm2 (%.3f), %.0fs" % (n, st.area(), st.area() / region.area, time.time() - t), flush=True)
    pickle.dump(assemble(st), open(a.out.replace(".pkl", "_fill.pkl"), "wb"))
