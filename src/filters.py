"""Do Aram's additional filters — the prior-day -2.5 condition and the LVN — turn the
raw geometry from breakeven-negative into an edge? These are the only two of his
remaining conditions that can be mechanised without further interpretation."""
import numpy as np, pandas as pd
from scipy import stats
from method import DF, Cfg, setups, trade, report, POINT

groups = {s: g.sort_values("ts") for s, g in DF.groupby("session", sort=True)}
keys = sorted(groups)
ki = {s: i for i, s in enumerate(keys)}
months = pd.to_datetime(DF.session).dt.to_period("M").nunique()


def lvn_score(r, cfg, bin_pts=10.0):
    """Volume profile from when price last traded beyond the -stop_k level (looking
    back up to 2 sessions) to the BOS. Returns the entry zone's volume as a fraction
    of the profile's busiest bin. Low = a low volume node."""
    i = ki[r.session]
    lo_i = max(i - 2, 0)
    g = pd.concat([groups[keys[j]] for j in range(lo_i, i + 1)])
    h = g.high.to_numpy(float); l = g.low.to_numpy(float)
    c = g.close.to_numpy(float); v = g.volume.to_numpy(float)
    far = r.B + r.d_ext * cfg.stop_k * r.leg
    # last bar that traded beyond the far level
    beyond = np.flatnonzero(h >= far) if r.d_ext > 0 else np.flatnonzero(l <= far)
    if not len(beyond):
        return np.nan
    start = int(beyond[-1])
    if len(g) - start < 60:
        return np.nan
    tp = (h[start:] + l[start:] + c[start:]) / 3.0
    vv = v[start:]
    b = np.floor(tp / bin_pts).astype(int)
    hist = np.bincount(b - b.min(), weights=vv)
    if hist.max() <= 0:
        return np.nan
    zone_lo = min(r.entry, far); zone_hi = max(r.entry, far)
    sel = np.arange(b.min(), b.min() + len(hist)) * bin_pts
    m = (sel >= zone_lo) & (sel <= zone_hi)
    if not m.any():
        return np.nan
    return float(hist[m].mean() / hist.max())


if __name__ == "__main__":
    print("A. Prior-day condition: price must already have traded beyond -k")
    for pk in (0.0, 2.0, 2.5, 3.0):
        c = Cfg(entry_k=2.0, stop_k=2.5, require_prior=pk)
        S = setups(c)
        S2 = S[S.prior_ok] if pk else S
        report(trade(c, S2), f"  prior beyond -{pk}" if pk else "  no prior filter", months)

    print("\nB. LVN filter: entry zone volume as a fraction of the profile's busiest bin")
    c = Cfg(entry_k=2.0, stop_k=2.5)
    S = setups(c)
    S = S.assign(lvn=[lvn_score(r, c) for r in S.itertuples()])
    print(f"  setups with a computable profile: {S.lvn.notna().sum()} of {len(S)}")
    print(f"  median zone/POC volume ratio: {S.lvn.median():.3f}")
    T = trade(c, S)
    T = T.merge(S[["session", "lvn"]], on="session", how="left")
    for thr in (1.01, 0.50, 0.35, 0.25, 0.15):
        sub = T[T.lvn <= thr]
        report(sub, f"  zone volume <= {thr:.2f} x POC", months)
