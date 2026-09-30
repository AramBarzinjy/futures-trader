"""
Investigation (f) — the pre-registered hypotheses and their fixed parameter grids.

Everything that is searched over is in REGISTRY. `registry_sha()` hashes it, the
hash is written into PREREGISTRATION-APEX.md, and `wf.py` refuses to run if the
two disagree. Changing a grid after seeing a result therefore breaks the run
loudly instead of silently.

Units
  D        median full-session high-low range of the PRIOR 20 sessions, in points.
           Known at the session open. NQ D is roughly 250-450 points in 2024-26.
  minutes  every lookback and hold is in minutes and converted to bars, so the
           same rule runs unchanged on 1-minute and 5-minute bars (the "two
           timeframes" check).
  times    ET, bar-open stamps. "Close by 15:55" means the bar opening 15:54.

No signal reads bar i+1 or later. `tests/test_apex.py` enforces this for every
hypothesis by corrupting the future and checking the past signals do not move.
"""
from __future__ import annotations

import hashlib
import itertools
import json

import numpy as np
import pandas as pd

from bt import Ctx, Order, TICK

RTH_OPEN = 9 * 60 + 30
EVE = 18 * 60


def hm(s: str) -> int:
    h, m = s.split(":")
    return int(h) * 60 + int(m)


REGISTRY = {
    "H1_volshock": dict(
        family="volume",
        needs=["NQ"],
        max_per_session=3,
        grid=dict(k=[4, 8], window=["RTH", "ALL"], direction=["continue", "fade"]),
        rule="Bar volume >= k x median volume of the same minute over the prior 20 "
             "sessions AND |close-open| >= 0.02 D -> market entry next bar in the "
             "bar's direction (continue) or against it (fade). Stop 0.05 D, target "
             "0.10 D, time exit 30 min. Signals 09:30-15:30 (RTH) or 18:00-15:30 (ALL).",
    ),
    "H2_vwap_revert": dict(
        family="volume/price",
        needs=["NQ"],
        max_per_session=2,
        grid=dict(z=[2.0, 2.5, 3.0], anchor=["RTH", "GLOBEX"]),
        rule="Anchored VWAP (09:30 or 18:00) with volume-weighted std bands; TWAP "
             "where cumulative volume is zero. Close crosses beyond +/- z sd -> fade "
             "toward VWAP. Target = VWAP at the signal bar; stop = half the distance "
             "to VWAP beyond entry (min 8 ticks); time exit 60 min. Signals "
             "10:00-15:30 (RTH anchor) or 19:00-15:30 (GLOBEX anchor).",
    ),
    "H3_nq_es_rel": dict(
        family="cross-market",
        needs=["NQ", "ES"],
        max_per_session=3,
        grid=dict(L=[15, 60], z=[2.0, 3.0], direction=["fade", "follow"]),
        rule="Spread = NQ log return over L min - beta x ES log return over L min; "
             "beta and the spread's sd from the prior 20 sessions' RTH bars. z "
             "crosses +/- z -> trade NQ against (fade) or with (follow) its relative "
             "move. Stop 0.04 D, target 0.04 D, time exit L min. Signals 10:00-15:30.",
    ),
    "H4_compress_break": dict(
        family="volatility",
        needs=["NQ"],
        max_per_session=1,
        grid=dict(q=[0.20, 0.33], target_R=[1.5, 3.0]),
        rule="Overnight range (18:00-09:29) at or below its q-quantile over the prior "
             "60 sessions -> at 09:30 place a two-sided stop bracket one tick beyond "
             "the overnight high/low, valid until 11:29. Stop at the overnight "
             "midpoint; target target_R x risk; flat by 15:55.",
    ),
    "H5_news830": dict(
        family="time-of-day/event",
        needs=["NQ"],
        max_per_session=1,
        grid=dict(m=[2.0, 4.0], direction=["continue", "fade"], exit=["09:29", "10:30"]),
        rule="The 08:30 bar's range >= m x median 08:30 range of the prior 20 "
             "sessions -> market entry at 08:31 with (continue) or against (fade) "
             "the bar's direction. Stop 1.0 x the bar's range, target 1.5 x, time "
             "exit at the close named by `exit`.",
    ),
    "H6_overnight_drift": dict(
        family="time-of-day",
        needs=["NQ"],
        max_per_session=1,
        grid=dict(window=["18:00-09:25", "18:00-02:00", "02:00-09:25", "02:00-04:00"]),
        rule="Long at the open of the first time, flat at the close of the second. "
             "Protective stop 0.10 D. No other condition.",
    ),
    "H7_delta_divergence": dict(
        family="order flow",
        needs=["NQ", "NQ_delta"],
        max_per_session=2,
        grid=dict(L=[30, 60], thr=["zero", "minus1sd"]),
        rule="High breaks the prior L-minute high while the last 15 minutes' "
             "aggressor delta is < 0 (zero) or < -1 sd of 15-min delta over the prior "
             "20 sessions (minus1sd) -> short; mirror at lows. Stop 0.02 D beyond "
             "the extreme, target 0.08 D, time exit 60 min. Signals 09:45-15:30.",
    ),
    "H8_delta_imbalance": dict(
        family="order flow",
        needs=["NQ", "NQ_delta"],
        max_per_session=3,
        grid=dict(z=[2.0, 3.0], window=["RTH", "ALL"]),
        rule="5-minute aggressor delta >= z sd (sd from the prior 20 sessions) while "
             "the close breaks the prior 30-minute range in the same direction -> "
             "continue. Stop 0.04 D, target 0.08 D, time exit 30 min. Signals "
             "09:45-15:30 (RTH) or 18:00-15:30 (ALL).",
    ),
}


def registry_sha() -> str:
    spec = {k: dict(grid=v["grid"], rule=v["rule"], max_per_session=v["max_per_session"])
            for k, v in REGISTRY.items()}
    return hashlib.sha256(json.dumps(spec, sort_keys=True).encode()).hexdigest()[:16]


def variants(h: str):
    g = REGISTRY[h]["grid"]
    keys = list(g)
    return [dict(zip(keys, vals)) for vals in itertools.product(*(g[k] for k in keys))]


def neighbours(h: str, p: dict):
    """Variants that differ from `p` in exactly one parameter, by one grid step."""
    g = REGISTRY[h]["grid"]
    out = []
    for k, vals in g.items():
        i = vals.index(p[k])
        for j in (i - 1, i + 1):
            if 0 <= j < len(vals):
                q = dict(p)
                q[k] = vals[j]
                out.append(q)
    return out


def n_variants() -> int:
    return sum(len(variants(h)) for h in REGISTRY)


# ================================================================ helpers
def _bars(ctx: Ctx, minutes: int) -> int:
    bm = ctx.extra.get("bar_minutes", 1)
    return max(1, int(round(minutes / bm)))


def _in(mod, a: int, b: int):
    """Minute-of-day window [a, b], wrapping through midnight if a > b."""
    return (mod >= a) & (mod <= b) if a <= b else (mod >= a) | (mod <= b)


def _slot(ctx: Ctx):
    bm = ctx.extra.get("bar_minutes", 1)
    return (((ctx.mod - EVE) % 1440) // bm).astype(int)


def _prior_sessions_stat(ctx: Ctx, values: np.ndarray, slots: np.ndarray, how: str, n=20):
    """Per bar: a statistic of `values` at the same slot over the PRIOR n sessions."""
    S = len(ctx.sess_dates)
    W = int(slots.max()) + 1
    M = np.full((S, W), np.nan)
    M[ctx.sess, slots] = values
    df = pd.DataFrame(M).shift(1).rolling(n, min_periods=max(5, n // 2))
    R = (df.median() if how == "median" else df.mean()).to_numpy()
    return R[ctx.sess, slots]


def _prior_sessions_scalar(ctx: Ctx, per_session: np.ndarray, how="median", n=20):
    s = pd.Series(per_session).shift(1).rolling(n, min_periods=max(5, n // 2))
    return getattr(s, how)().to_numpy()


def _rolling_max(x, L):
    return pd.Series(x).shift(1).rolling(L, min_periods=L).max().to_numpy().copy()


def _rolling_min(x, L):
    return pd.Series(x).shift(1).rolling(L, min_periods=L).min().to_numpy().copy()


def _session_sum_lagged(ctx: Ctx, x: np.ndarray, L: int):
    """Sum of x over the last L bars, but never reaching into the previous session."""
    cs = np.cumsum(np.nan_to_num(x))
    prev = np.r_[np.zeros(L), cs[:-L]] if L < len(cs) else np.zeros(len(cs))
    out = cs - prev
    first = ctx.s_start[ctx.sess]
    out[np.arange(len(x)) - first + 1 < L] = np.nan
    return out


def _cross_up(z, thr):
    zp = np.r_[np.nan, z[:-1]]
    return (zp < thr) & (z >= thr)


def _cross_dn(z, thr):
    zp = np.r_[np.nan, z[:-1]]
    return (zp > thr) & (z <= thr)


# ============================================================== signals
def sig_H1(ctx: Ctx, k, window, direction):
    slot = _slot(ctx)
    med = _prior_sessions_stat(ctx, ctx.v, slot, "median")
    D = ctx.D[ctx.sess]
    body = ctx.c - ctx.o
    a = RTH_OPEN if window == "RTH" else EVE
    ok = _in(ctx.mod, a, hm("15:30")) & (ctx.v >= k * med) & (np.abs(body) >= 0.02 * D) & (med > 0)
    sgn = np.sign(body) * (1 if direction == "continue" else -1)
    hold = _bars(ctx, 30)
    return [Order(i=int(i), side=int(sgn[i]), stop_dist=0.05 * D[i], target_dist=0.10 * D[i],
                  exit_i=int(i) + hold, tag="H1")
            for i in np.nonzero(ok & (sgn != 0) & np.isfinite(D))[0]]


def _anchored_vwap(ctx: Ctx, anchor_mod: int | None):
    """VWAP and weighted sd from the anchor within each session. Before the anchor: nan."""
    tp = (ctx.h + ctx.l + ctx.c) / 3.0
    n = ctx.n
    vw = np.full(n, np.nan)
    sd = np.full(n, np.nan)
    for s in range(len(ctx.sess_dates)):
        a, b = ctx.s_start[s], ctx.s_end[s]
        if anchor_mod is not None:
            idx = np.nonzero(ctx.mod[a:b + 1] == anchor_mod)[0]
            if not len(idx):
                continue
            a = a + idx[0]
        p = tp[a:b + 1]
        w = ctx.v[a:b + 1]
        cw = np.cumsum(w)
        cpw = np.cumsum(p * w)
        cp2w = np.cumsum(p * p * w)
        k = np.arange(1, len(p) + 1)
        twap = np.cumsum(p) / k
        twap2 = np.cumsum(p * p) / k
        use_v = cw > 0
        m1 = np.where(use_v, cpw / np.where(use_v, cw, 1), twap)
        m2 = np.where(use_v, cp2w / np.where(use_v, cw, 1), twap2)
        vw[a:b + 1] = m1
        sd[a:b + 1] = np.sqrt(np.maximum(m2 - m1 * m1, 0.0))
    return vw, sd


def sig_H2(ctx: Ctx, z, anchor):
    if anchor == "RTH":
        vw, sd = _anchored_vwap(ctx, RTH_OPEN)
        win = _in(ctx.mod, hm("10:00"), hm("15:30"))
    else:
        vw, sd = _anchored_vwap(ctx, None)
        win = _in(ctx.mod, hm("19:00"), hm("15:30"))
    with np.errstate(invalid="ignore", divide="ignore"):
        zz = (ctx.c - vw) / sd
    sh = _cross_up(zz, z) & win
    lg = _cross_dn(zz, -z) & win
    hold = _bars(ctx, 60)
    out = []
    for i in np.nonzero(sh | lg)[0]:
        side = -1 if sh[i] else 1
        dist = max(0.5 * abs(ctx.c[i] - vw[i]), 8 * TICK)
        out.append(Order(i=int(i), side=side, target=vw[i], stop_dist=dist,
                         exit_i=int(i) + hold, tag="H2"))
    return out


def _beta_and_sd(ctx: Ctx, rn1, re1, L):
    """Per-session beta of NQ on ES (1-bar returns) and spread sd, from the prior 20 sessions."""
    S = len(ctx.sess_dates)
    rth = _in(ctx.mod, RTH_OPEN, hm("15:59"))
    ok = rth & np.isfinite(rn1) & np.isfinite(re1)
    sxy = np.bincount(ctx.sess[ok], rn1[ok] * re1[ok], S)
    sxx = np.bincount(ctx.sess[ok], re1[ok] ** 2, S)
    beta = pd.Series(sxy).shift(1).rolling(20, min_periods=10).sum() / \
        pd.Series(sxx).shift(1).rolling(20, min_periods=10).sum()
    beta = beta.to_numpy()
    return beta, rth


def sig_H3(ctx: Ctx, L, z, direction):
    es = ctx.extra["es_c"]
    Lb = _bars(ctx, L)
    with np.errstate(invalid="ignore", divide="ignore"):
        ln = np.log(ctx.c)
        le = np.log(es)
    rn1 = np.r_[np.nan, np.diff(ln)]
    re1 = np.r_[np.nan, np.diff(le)]
    rn1[ctx.s_start] = np.nan
    re1[ctx.s_start] = np.nan
    beta, rth = _beta_and_sd(ctx, rn1, re1, Lb)
    rnL = _session_sum_lagged(ctx, rn1, Lb)
    reL = _session_sum_lagged(ctx, re1, Lb)
    spread = rnL - beta[ctx.sess] * reL
    ok = rth & np.isfinite(spread)
    S = len(ctx.sess_dates)
    ss = np.bincount(ctx.sess[ok], spread[ok] ** 2, S)
    cnt = np.bincount(ctx.sess[ok], None, S)
    sd = np.sqrt(pd.Series(ss).shift(1).rolling(20, min_periods=10).sum() /
                 pd.Series(cnt).shift(1).rolling(20, min_periods=10).sum()).to_numpy()
    with np.errstate(invalid="ignore", divide="ignore"):
        zz = spread / sd[ctx.sess]
    win = _in(ctx.mod, hm("10:00"), hm("15:30"))
    up = _cross_up(zz, z) & win
    dn = _cross_dn(zz, -z) & win
    D = ctx.D[ctx.sess]
    sgn = 1 if direction == "follow" else -1
    return [Order(i=int(i), side=sgn * (1 if up[i] else -1), stop_dist=0.04 * D[i],
                  target_dist=0.04 * D[i], exit_i=int(i) + Lb, tag="H3")
            for i in np.nonzero((up | dn) & np.isfinite(D))[0]]


def sig_H4(ctx: Ctx, q, target_R):
    S = len(ctx.sess_dates)
    on = _in(ctx.mod, EVE, RTH_OPEN - 1)
    hi = np.full(S, np.nan)
    lo = np.full(S, np.nan)
    last_on = np.full(S, -1)
    for s in range(S):
        a, b = ctx.s_start[s], ctx.s_end[s]
        idx = np.nonzero(on[a:b + 1])[0]
        if len(idx) < 60:
            continue
        hi[s] = ctx.h[a + idx].max()
        lo[s] = ctx.l[a + idx].min()
        last_on[s] = a + idx[-1]
    R = hi - lo
    thr = pd.Series(R).shift(1).rolling(60, min_periods=40).quantile(q).to_numpy()
    out = []
    for s in np.nonzero((R <= thr) & (last_on >= 0))[0]:
        i = last_on[s]
        a, b = ctx.s_start[s], ctx.s_end[s]
        m = ctx.mod[a:b + 1]
        bm = ctx.extra.get("bar_minutes", 1)
        exp = np.nonzero(m == hm("11:30") - bm)[0]     # bar closing at 11:30
        fl = np.nonzero(m == hm("15:55") - bm)[0]      # bar closing at 15:55
        if not len(exp) or not len(fl):
            continue
        mid = 0.5 * (hi[s] + lo[s])
        out.append(Order(i=int(i), side=0, kind="bracket", price=hi[s] + TICK,
                         price2=lo[s] - TICK, expire=int(a + exp[0]), stop=mid,
                         target_R=target_R, exit_i=int(a + fl[0]), tag="H4"))
    return out


def sig_H5(ctx: Ctx, m, direction, exit):
    bm = ctx.extra.get("bar_minutes", 1)
    is830 = ctx.mod == hm("08:30")
    rng = ctx.h - ctx.l
    S = len(ctx.sess_dates)
    r830 = np.full(S, np.nan)
    r830[ctx.sess[is830]] = rng[is830]
    med = _prior_sessions_scalar(ctx, r830, "median")
    x = hm(exit) - bm            # bar that closes at `exit`
    out = []
    for i in np.nonzero(is830)[0]:
        s = ctx.sess[i]
        if not np.isfinite(med[s]) or med[s] <= 0 or rng[i] < m * med[s]:
            continue
        body = ctx.c[i] - ctx.o[i]
        if body == 0:
            continue
        side = int(np.sign(body)) * (1 if direction == "continue" else -1)
        a, b = ctx.s_start[s], ctx.s_end[s]
        ex = np.nonzero(ctx.mod[a:b + 1] == x)[0]
        if not len(ex):
            continue
        out.append(Order(i=int(i), side=side, stop_dist=1.0 * rng[i], target_dist=1.5 * rng[i],
                         exit_i=int(a + ex[0]), tag="H5"))
    return out


def sig_H6(ctx: Ctx, window):
    bm = ctx.extra.get("bar_minutes", 1)
    e, x = window.split("-")
    E, X = hm(e), hm(x) - bm
    out = []
    for s in range(len(ctx.sess_dates)):
        a, b = ctx.s_start[s], ctx.s_end[s]
        m = ctx.mod[a:b + 1]
        ie = np.nonzero(m == E)[0]
        ix = np.nonzero(m == X)[0]
        if not len(ie) or not len(ix) or not np.isfinite(ctx.D[s]):
            continue
        j = a + ie[0]            # entry bar; signal bar is the one before it
        out.append(Order(i=int(j - 1), side=1, stop_dist=0.10 * ctx.D[s],
                         exit_i=int(a + ix[0]), cross=(j == a), tag="H6"))
    return out


def sig_H7(ctx: Ctx, L, thr):
    d = ctx.extra["delta"]
    Lb = _bars(ctx, L)
    d15 = pd.Series(d).rolling(_bars(ctx, 15), min_periods=_bars(ctx, 15)).sum().to_numpy().copy()
    first = ctx.s_start[ctx.sess]
    d15[np.arange(ctx.n) - first + 1 < _bars(ctx, 15)] = np.nan
    S = len(ctx.sess_dates)
    ok = np.isfinite(d15)
    sd = np.sqrt(pd.Series(np.bincount(ctx.sess[ok], d15[ok] ** 2, S)).shift(1).rolling(20, min_periods=10).sum()
                 / pd.Series(np.bincount(ctx.sess[ok], None, S)).shift(1).rolling(20, min_periods=10).sum()).to_numpy()
    cut = 0.0 if thr == "zero" else -1.0
    hiL = _rolling_max(ctx.h, Lb)
    loL = _rolling_min(ctx.l, Lb)
    young = np.arange(ctx.n) - first < Lb
    hiL[young] = np.nan
    loL[young] = np.nan
    win = _in(ctx.mod, hm("09:45"), hm("15:30"))
    sdb = sd[ctx.sess]
    with np.errstate(invalid="ignore"):
        sh = win & (ctx.h > hiL) & (d15 < cut * sdb)
        lg = win & (ctx.l < loL) & (-d15 < cut * sdb)
    D = ctx.D[ctx.sess]
    hold = _bars(ctx, 60)
    out = []
    for i in np.nonzero((sh | lg) & np.isfinite(D) & np.isfinite(sdb))[0]:
        if sh[i]:
            out.append(Order(i=int(i), side=-1, stop=ctx.h[i] + 0.02 * D[i],
                             target_dist=0.08 * D[i], exit_i=int(i) + hold, tag="H7"))
        else:
            out.append(Order(i=int(i), side=1, stop=ctx.l[i] - 0.02 * D[i],
                             target_dist=0.08 * D[i], exit_i=int(i) + hold, tag="H7"))
    return out


def sig_H8(ctx: Ctx, z, window):
    d = ctx.extra["delta"]
    n5 = _bars(ctx, 5)
    d5 = pd.Series(d).rolling(n5, min_periods=n5).sum().to_numpy().copy()
    first = ctx.s_start[ctx.sess]
    d5[np.arange(ctx.n) - first + 1 < n5] = np.nan
    S = len(ctx.sess_dates)
    ok = np.isfinite(d5)
    sd = np.sqrt(pd.Series(np.bincount(ctx.sess[ok], d5[ok] ** 2, S)).shift(1).rolling(20, min_periods=10).sum()
                 / pd.Series(np.bincount(ctx.sess[ok], None, S)).shift(1).rolling(20, min_periods=10).sum()).to_numpy()
    zz = d5 / sd[ctx.sess]
    L30 = _bars(ctx, 30)
    hi = _rolling_max(ctx.h, L30)
    lo = _rolling_min(ctx.l, L30)
    young = np.arange(ctx.n) - first < L30          # window would reach the prior session
    hi[young] = np.nan
    lo[young] = np.nan
    a = hm("09:45") if window == "RTH" else EVE
    win = _in(ctx.mod, a, hm("15:30"))
    with np.errstate(invalid="ignore"):
        lg = win & (zz >= z) & (ctx.c > hi)
        sh = win & (zz <= -z) & (ctx.c < lo)
    D = ctx.D[ctx.sess]
    hold = _bars(ctx, 30)
    return [Order(i=int(i), side=(1 if lg[i] else -1), stop_dist=0.04 * D[i],
                  target_dist=0.08 * D[i], exit_i=int(i) + hold, tag="H8")
            for i in np.nonzero((lg | sh) & np.isfinite(D))[0]]


SIGNALS = dict(H1_volshock=sig_H1, H2_vwap_revert=sig_H2, H3_nq_es_rel=sig_H3,
               H4_compress_break=sig_H4, H5_news830=sig_H5, H6_overnight_drift=sig_H6,
               H7_delta_divergence=sig_H7, H8_delta_imbalance=sig_H8)


def orders(h: str, ctx: Ctx, p: dict):
    return SIGNALS[h](ctx, **p)


if __name__ == "__main__":
    print(f"registry sha {registry_sha()}   hypotheses {len(REGISTRY)}   variants {n_variants()}")
    for h, v in REGISTRY.items():
        print(f"  {h:<22}{v['family']:<20}{len(variants(h)):>3} variants   needs {', '.join(v['needs'])}")
