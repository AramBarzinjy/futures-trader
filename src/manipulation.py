"""
Stage 2: testing the premise underneath Aram's method, without needing his fib
convention settled.

After the Asia range is swept ("manipulation"), the method assumes price reverses and
travels a long way back — far enough to reach a level 2 to 2.5 leg-lengths beyond the
origin of the sweep. That is measurable directly. Working in LEG UNITS makes it
convention-independent: whatever platform labels it -2.5, it is 2.5 x the A->B leg
beyond A, and this measures how often price actually gets there and what happens next.

  A    = swing origin: the extreme opposite the break, before the break
  B    = extreme of the sweep leg (extended until price retraces `retrace_frac`)
  leg  = |B - A|
  k    = excursion beyond A in the reversal direction, in leg units
         (k = 2.5 is the level Aram calls -2.5)
"""
import os as _os
ROOT = _os.environ.get("NQ_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import numpy as np, pandas as pd
from asia import DF, AsiaCfg, asia_windows, consolidation, first_bos

FORWARD_MIN = 15 * 60      # track 15 hours forward: covers London + full NY session
RETRACE_FRAC = 0.33        # the sweep leg ends when price gives back this much of it


def build(cfg: AsiaCfg, er_max=0.30, range_cap=0.0):
    ses = {s: g.sort_values("ts") for s, g in DF.groupby("session", sort=True)}
    keys = list(ses)
    rows = []

    for i, (sess, a, post) in enumerate(asia_windows(cfg)):
        ok, info = consolidation(a, cfg)
        if info["er_tail"] > er_max:
            continue
        if range_cap and info["rng"] > range_cap:
            continue
        b = first_bos(post, info["hi"], info["lo"])
        if b is None:
            continue
        d, bos_min, bos_px = b            # d=+1 swept the high

        g = ses[sess]
        m = g.mins.to_numpy(); h = g.high.to_numpy(float)
        l = g.low.to_numpy(float); c = g.close.to_numpy(float)

        # index of the break inside the full session
        after = np.flatnonzero((m >= bos_min) & (m < cfg.end + cfg.bos_window_min))
        if not len(after):
            continue
        j0 = after[0]

        # --- A: the origin of the sweep leg (extreme opposite the break, in Asia) ---
        asia_sel = np.flatnonzero((m >= cfg.start) | (m < cfg.end))
        asia_sel = asia_sel[asia_sel < j0]
        if len(asia_sel) < 30:
            continue
        A = l[asia_sel].min() if d > 0 else h[asia_sel].max()

        # --- B: extend the leg until price gives back RETRACE_FRAC of it ---
        B = h[j0] if d > 0 else l[j0]
        jB = j0
        for j in range(j0, min(j0 + 240, len(m))):
            if d > 0:
                if h[j] > B:
                    B, jB = h[j], j
                if B > A and (B - l[j]) >= RETRACE_FRAC * (B - A):
                    break
            else:
                if l[j] < B:
                    B, jB = l[j], j
                if A > B and (h[j] - B) >= RETRACE_FRAC * (A - B):
                    break
        leg = abs(B - A)
        if leg < 5:
            continue

        # --- forward excursion beyond A, in leg units (the reversal direction) ---
        fw = np.flatnonzero((m >= m[jB]) & (m <= m[jB] + FORWARD_MIN)) if m[jB] + FORWARD_MIN <= m.max() \
            else np.arange(jB, len(m))
        fw = fw[fw >= jB]
        if len(fw) < 60:
            continue
        # how far past A does price travel, against the sweep?
        if d > 0:      # swept the high -> reversal is down, beyond A means below A
            k_max = (A - l[fw].min()) / leg
        else:
            k_max = (h[fw].max() - A) / leg

        rows.append(dict(session=sess, dir=d, A=A, B=B, leg=leg, k_max=k_max,
                         asia_rng=info["rng"], er=info["er_tail"], jB=jB, j0=j0))
    return pd.DataFrame(rows)


def entry_test(cfg, df, k_entry, stop_pts_list=(10, 15, 20, 25, 30), target_R=5.0):
    """If you place a limit at k legs beyond A and it fills, what happens?
    Entry is a reversal: long when the sweep took the high (price came down to you)."""
    ses = {s: g.sort_values("ts") for s, g in DF.groupby("session", sort=True)}
    out = []
    for stop_pts in stop_pts_list:
        wins = losses = neither = 0
        R = []
        for r in df.itertuples():
            g = ses[r.session]
            m = g.mins.to_numpy(); h = g.high.to_numpy(float); l = g.low.to_numpy(float)
            d = r.dir
            lvl = r.A - k_entry * r.leg if d > 0 else r.A + k_entry * r.leg
            # scan forward from the leg extreme for the limit to fill
            fill = None
            end = min(r.jB + FORWARD_MIN, len(m) - 1)
            for j in range(r.jB, end):
                if (d > 0 and l[j] <= lvl) or (d < 0 and h[j] >= lvl):
                    fill = j; break
            if fill is None:
                continue
            side = +1 if d > 0 else -1        # long after a high sweep
            stop = lvl - side * stop_pts
            target = lvl + side * stop_pts * target_R
            res = None
            for j in range(fill + 1, end):
                if side > 0:
                    if l[j] <= stop: res = -1.0; break
                    if h[j] >= target: res = target_R; break
                else:
                    if h[j] >= stop: res = -1.0; break
                    if l[j] <= target: res = target_R; break
            if res is None:
                neither += 1; continue
            R.append(res)
            wins += res > 0; losses += res < 0
        n = len(R)
        if n < 10:
            out.append(dict(stop=stop_pts, n=n)); continue
        exp_R = float(np.mean(R))
        out.append(dict(stop=stop_pts, n=n, fills=n + neither, win=100 * wins / n,
                        exp_R=exp_R, open_=neither,
                        exp_usd=exp_R * stop_pts * 2.0 * 5))   # 5 micros
    return pd.DataFrame(out)


if __name__ == "__main__":
    cfg = AsiaCfg()
    df = build(cfg)
    df.to_pickle(ROOT + "/results/manip.pkl")
    print(f"qualifying setups: {len(df)}   median leg: {df.leg.median():.1f} pts")
    print(f"sweeps of the high: {int((df.dir>0).sum())}   of the low: {int((df.dir<0).sum())}")
    print()
    print("How far does price travel back past A, in leg units? (k = Aram's -k level)")
    print(f"{'k reached':>10}{'count':>8}{'% of setups':>13}")
    for k in (0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0):
        s = (df.k_max >= k).sum()
        print(f"{k:>10.1f}{s:>8}{100*s/len(df):>12.1f}%")
    print(f"\nmedian k reached: {df.k_max.median():.2f}   mean: {df.k_max.mean():.2f}")
