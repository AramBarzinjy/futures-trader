"""
Aram's method, corrected to the fib convention confirmed from his TradingView chart.

  level 1  = ORIGIN   (A) — where price changed direction to break structure
  level 0  = BREAKOUT (B) — where price ran past liquidity, confirming the break
  level -k = B + k * (B - A)   — extensions CONTINUE past the breakout

So -2.5 is 2.5 legs beyond the break, not back past the origin. The trade is a
reversal INTO the over-extension: short at -2/-2.25 after an upward break, stop
just beyond -2.5, target back down to level 1.

Structure of the setup, as mechanised:
  1. Asia range = [lo, hi] over the Asia window (London clock, ends 06:00).
  2. After Asia closes, the first break of that range is the MANIPULATION (a sweep).
     A = the extreme of that sweep.
  3. The BREAK OF STRUCTURE is the opposite side: price must then take out the other
     boundary. B = that boundary.
  4. leg = |B - A|. Extensions run from B, away from A.
  5. Entry at -entry_k, stop at -stop_k (beyond it), target at level 1 (= A).
"""
import os as _os
ROOT = _os.environ.get("NQ_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import numpy as np, pandas as pd
from dataclasses import dataclass
from scipy import stats

DF = pd.read_pickle(ROOT + "/data/mnq_cont_1m.pkl")
LON = DF.ts.dt.tz_convert("Europe/London")
DF = DF.assign(lon_min=(LON.dt.hour * 60 + LON.dt.minute).to_numpy())

POINT = 2.0
TICK = 0.25
COMMISSION_RT = 1.20
SPLIT = pd.Timestamp("2025-01-01")


@dataclass
class Cfg:
    asia_start: int = 0            # 00:00 London
    asia_end: int = 6 * 60         # 06:00 London — Aram's stated Asia close
    max_er: float = 0.30
    max_asia_range: float = 0.0    # 0 = no cap
    sweep_window: int = 240        # minutes after Asia close to find the sweep
    bos_window: int = 300          # minutes after the sweep to confirm the BOS
    fill_window: int = 900         # minutes after the BOS for the limit to fill
    trade_window: int = 900        # minutes after fill to resolve the trade
    entry_k: float = 2.0
    stop_k: float = 2.5            # stop sits beyond this level
    require_prior: float = 0.0     # 0 = off; else prior day must have traded beyond -k
    contracts: int = 5


def er(c):
    if len(c) < 2:
        return np.nan
    p = np.abs(np.diff(c)).sum()
    return abs(c[-1] - c[0]) / p if p > 0 else np.nan


def setups(cfg: Cfg):
    """Yield one dict per qualifying Asia session that produced a sweep + BOS."""
    out = []
    groups = {s: g.sort_values("ts") for s, g in DF.groupby("session", sort=True)}
    keys = sorted(groups)
    for i, sess in enumerate(keys):
        g = groups[sess]
        lm = g.lon_min.to_numpy()
        h = g.high.to_numpy(float); l = g.low.to_numpy(float); c = g.close.to_numpy(float)

        asia = np.flatnonzero((lm >= cfg.asia_start) & (lm < cfg.asia_end))
        if len(asia) < 180:
            continue
        hi, lo = h[asia].max(), l[asia].min()
        rng = hi - lo
        if er(c[asia][-30:]) > cfg.max_er:
            continue
        if cfg.max_asia_range and rng > cfg.max_asia_range:
            continue

        post = np.flatnonzero((lm >= cfg.asia_end) & (lm < cfg.asia_end + cfg.sweep_window))
        post = post[post > asia[-1]]
        if len(post) < 30:
            continue

        # --- 1. the manipulation: first break of the Asia range ---
        up = post[h[post] > hi]; dn = post[l[post] < lo]
        iu = up[0] if len(up) else np.inf
        idn = dn[0] if len(dn) else np.inf
        if iu == np.inf and idn == np.inf:
            continue
        swept_high = iu <= idn
        jsw = int(min(iu, idn))

        # --- 2. sweep extreme (A) and the structure level to break (B) ---
        # the sweep runs until price re-enters the range
        jend = jsw
        limit = min(jsw + cfg.bos_window, len(g) - 1)
        for j in range(jsw, limit):
            if swept_high:
                if l[j] < hi:
                    break
            else:
                if h[j] > lo:
                    break
            jend = j
        seg = slice(jsw, max(jend + 1, jsw + 1))
        A = h[seg].max() if swept_high else l[seg].min()
        B = lo if swept_high else hi           # BOS is the OPPOSITE side
        leg = abs(B - A)
        if leg < 10:
            continue

        # --- 3. confirm the break of structure ---
        bos_rng = np.arange(jend, min(jend + cfg.bos_window, len(g)))
        if not len(bos_rng):
            continue
        if swept_high:                          # swept the high -> BOS is downward
            hit = bos_rng[l[bos_rng] < B]
            d_ext = -1                          # extensions run DOWN from B
        else:
            hit = bos_rng[h[bos_rng] > B]
            d_ext = +1
        if not len(hit):
            continue
        jbos = int(hit[0])

        # --- 4. fib extension levels ---
        def lvl(k):                             # level -k
            return B + d_ext * k * leg
        entry = lvl(cfg.entry_k)
        stopl = lvl(cfg.stop_k)
        target = A                              # level 1

        # --- optional: prior day must have traded beyond -k ---
        prior_ok = True
        if cfg.require_prior:
            if i == 0:
                continue
            prev = groups[keys[i - 1]]
            pl = np.flatnonzero(g.lon_min.to_numpy() < cfg.asia_start)
            lo_p = min(prev.low.min(), l[pl].min() if len(pl) else np.inf)
            hi_p = max(prev.high.max(), h[pl].max() if len(pl) else -np.inf)
            want = lvl(cfg.require_prior)
            prior_ok = (hi_p >= want) if d_ext > 0 else (lo_p <= want)

        out.append(dict(session=sess, swept_high=swept_high, A=A, B=B, leg=leg,
                        d_ext=d_ext, jbos=jbos, entry=entry, stop=stopl,
                        target=target, asia_rng=rng, prior_ok=prior_ok))
    return pd.DataFrame(out)


def trade(cfg: Cfg, S: pd.DataFrame):
    """Resolve each setup: does the limit fill, and does it reach target or stop?"""
    groups = {s: g.sort_values("ts") for s, g in DF.groupby("session", sort=True)}
    keys = sorted(groups)
    ki = {s: i for i, s in enumerate(keys)}
    rows = []
    for r in S.itertuples():
        # allow the trade to run into the NEXT session too
        i = ki[r.session]
        g = pd.concat([groups[r.session], groups[keys[i + 1]]]) if i + 1 < len(keys) else groups[r.session]
        h = g.high.to_numpy(float); l = g.low.to_numpy(float)
        n = len(h)
        side = -1 if r.d_ext > 0 else +1        # extensions up -> we short into them

        fill = None
        for j in range(r.jbos, min(r.jbos + cfg.fill_window, n)):
            if (r.d_ext > 0 and h[j] >= r.entry) or (r.d_ext < 0 and l[j] <= r.entry):
                fill = j; break
        if fill is None:
            continue
        entry_px = r.entry - side * TICK        # slippage against us on a limit is 0;
        stop_px = r.stop                        # pay it on the stop instead
        stop_dist = abs(stop_px - entry_px)
        tgt_dist = abs(r.target - entry_px)
        if stop_dist < 2 or tgt_dist < stop_dist:
            continue

        res = None
        for j in range(fill + 1, min(fill + cfg.trade_window, n)):
            if side < 0:                         # short
                if h[j] >= stop_px: res = ("stop", stop_px + 2 * TICK); break
                if l[j] <= r.target: res = ("target", r.target); break
            else:
                if l[j] <= stop_px: res = ("stop", stop_px - 2 * TICK); break
                if h[j] >= r.target: res = ("target", r.target); break
        if res is None:
            continue
        reason, exit_px = res
        pts = (exit_px - entry_px) * side
        rows.append(dict(session=r.session, side=side, leg=r.leg, reason=reason,
                         points=pts, stop_pts=stop_dist, target_pts=tgt_dist,
                         rr=tgt_dist / stop_dist, prior_ok=r.prior_ok,
                         R=pts / stop_dist,
                         net=pts * POINT * cfg.contracts - COMMISSION_RT * cfg.contracts,
                         stop_usd=stop_dist * POINT * cfg.contracts))
    return pd.DataFrame(rows)


def report(T, label, months):
    if len(T) < 5:
        print(f"{label:<34} n={len(T)}  (too few)"); return
    t, p = stats.ttest_1samp(T.R, 0)
    print(f"{label:<34} n={len(T):>4} {len(T)/months:>5.2f}/mo  win={100*(T.R>0).mean():>5.1f}%  "
          f"expR={T.R.mean():>6.2f}  t={t:>5.2f}  p={p:>6.3f}  "
          f"net=${T.net.sum():>9,.0f}  medStop=${T.stop_usd.median():>6.0f}  medRR={T.rr.median():.1f}")


if __name__ == "__main__":
    cfg = Cfg()
    S = setups(cfg)
    months = pd.to_datetime(DF.session).dt.to_period("M").nunique()
    print(f"Asia window: 00:00-06:00 London | sessions with sweep + confirmed BOS: {len(S)}"
          f"  ({len(S)/months:.1f}/month)")
    print(f"median leg: {S.leg.median():.0f} pts   median Asia range: {S.asia_rng.median():.0f} pts\n")

    print("ENTRY DEPTH — where in the extension to place the limit")
    print(f"{'entry / stop':<34}{'':>4}")
    for ek, sk in ((1.0, 1.5), (1.5, 2.0), (2.0, 2.5), (2.25, 2.75), (2.5, 3.0)):
        c = Cfg(entry_k=ek, stop_k=sk)
        report(trade(c, setups(c)), f"-{ek} entry, stop -{sk}", months)
