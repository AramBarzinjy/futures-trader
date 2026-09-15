"""
Reactive zones on 1H and 4H, per Aram's definition: fair value gaps, order blocks,
rejection wicks, and equal highs/lows.

Every zone is built only from bars that CLOSED BEFORE the break of structure, so
nothing here can see the trade it is being asked to judge. A zone also has to be
unmitigated — if price has already traded cleanly through it since it formed, it is
spent and gets dropped.

The question being tested: does a reactive zone overlapping the -2.0/-2.5 entry
window improve on the low volume node alone?
"""
import numpy as np, pandas as pd

ET = "America/New_York"


def resample(df, hours):
    """1-minute bars -> hourly bars aligned to the CME session open (18:00 ET)."""
    g = df.set_index("et")
    o = g.open.resample(f"{hours}h", origin=pd.Timestamp("2022-08-01 18:00", tz=ET)).first()
    h = g.high.resample(f"{hours}h", origin=pd.Timestamp("2022-08-01 18:00", tz=ET)).max()
    l = g.low.resample(f"{hours}h", origin=pd.Timestamp("2022-08-01 18:00", tz=ET)).min()
    c = g.close.resample(f"{hours}h", origin=pd.Timestamp("2022-08-01 18:00", tz=ET)).last()
    v = g.volume.resample(f"{hours}h", origin=pd.Timestamp("2022-08-01 18:00", tz=ET)).sum()
    out = pd.DataFrame(dict(open=o, high=h, low=l, close=c, volume=v)).dropna()
    return out


def zones_from(bars, lookback=120, disp_mult=1.5, wick_ratio=2.0, eq_tol=0.15):
    """Return [(lo, hi, kind, idx)] for every reactive zone in the final `lookback`
    bars. `bars` must already be truncated to what was known at decision time."""
    b = bars.tail(lookback)
    if len(b) < 10:
        return []
    o = b.open.to_numpy(); h = b.high.to_numpy()
    l = b.low.to_numpy(); c = b.close.to_numpy()
    n = len(b)
    rng = h - l
    atr = pd.Series(rng).rolling(14).mean().to_numpy()
    out = []

    for i in range(2, n):
        a = atr[i] if not np.isnan(atr[i]) else np.nanmean(atr)
        if not a or np.isnan(a):
            continue

        # --- fair value gap: 3-bar imbalance, bar1 and bar3 do not overlap ---
        if h[i - 2] < l[i]:
            out.append((h[i - 2], l[i], "fvg", i))
        if l[i - 2] > h[i]:
            out.append((h[i], l[i - 2], "fvg", i))

        # --- order block: last opposing candle before a displacement move ---
        body = abs(c[i] - o[i])
        if body > disp_mult * a:
            j = i - 1
            up = c[i] > o[i]
            while j >= 0 and ((c[j] > o[j]) == up):
                j -= 1
            if j >= 0:
                out.append((min(o[j], c[j], l[j]), max(o[j], c[j], h[j]), "ob", i))

        # --- rejection wick: wick dominates the body ---
        body = max(abs(c[i] - o[i]), 1e-9)
        up_w = h[i] - max(o[i], c[i])
        dn_w = min(o[i], c[i]) - l[i]
        if up_w > wick_ratio * body and up_w > 0.3 * a:
            out.append((max(o[i], c[i]), h[i], "wick", i))
        if dn_w > wick_ratio * body and dn_w > 0.3 * a:
            out.append((l[i], min(o[i], c[i]), "wick", i))

    # --- equal highs / lows: two swing points within tolerance ---
    for k, arr in (("eqh", h), ("eql", l)):
        sw = []
        for i in range(2, n - 2):
            if k == "eqh" and arr[i] == max(arr[i - 2:i + 3]):
                sw.append(i)
            if k == "eql" and arr[i] == min(arr[i - 2:i + 3]):
                sw.append(i)
        for x in range(len(sw)):
            for y in range(x + 1, len(sw)):
                i, j = sw[x], sw[y]
                a = atr[j] if not np.isnan(atr[j]) else np.nanmean(atr)
                if a and abs(arr[i] - arr[j]) <= eq_tol * a:
                    lo, hi = sorted((arr[i], arr[j]))
                    out.append((lo - 0.05 * a, hi + 0.05 * a, k, j))

    # --- drop mitigated zones: price has since closed cleanly through them ---
    live = []
    for lo, hi, kind, i in out:
        after = slice(i + 1, n)
        if n - i - 1 < 1:
            live.append((lo, hi, kind)); continue
        through = (c[after] < lo).any() and (c[after] > hi).any()
        if not through:
            live.append((lo, hi, kind))
    return live


def overlap(zones, lo, hi, kinds=None):
    """Does any zone intersect [lo, hi]? Returns (bool, list of kinds that hit)."""
    hits = [k for (zl, zh, k) in zones
            if (kinds is None or k in kinds) and zh >= lo and zl <= hi]
    return bool(hits), hits
