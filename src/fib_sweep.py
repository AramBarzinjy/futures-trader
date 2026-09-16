"""
The method at every Fibonacci level, not just -2.0.

Requested directly. It is a PARAMETER SWEEP on data already used, which
CLAUDE.md section 7.5 says must never be reported as a finding, and section 8.2a
flags entry depth specifically as a tuning decision needing its own
pre-registration and a fresh market. So this is run and reported as
EXPLORATORY: the best level found is optimistically biased by construction,
every level is counted in a Benjamini-Hochberg correction, and ES is deliberately
left untouched so whatever comes out can be tested once on a market that has
never been looked at.

There is a real motivation rather than pure dredging. Section 4a found the -2.0
entry fills on 49% of NQ setups but only 20% of GC and 34% of CL, and a fill rate
that low is most of why the transfer test ran out of sample. Asking whether the
entry is simply too deep is a mechanical question the sweep can answer.

Levels are the standard Fibonacci extension set. The stop keeps the method's own
relationship, half a leg beyond the entry (entry -2.0 / stop -2.5 in section 3),
and the target stays at level 1.

    python3 src/fib_sweep.py            # all three instruments
    python3 src/fib_sweep.py GC         # just one
"""
import os as _os
ROOT = _os.environ.get("NQ_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import subprocess
import sys

import numpy as np
import pandas as pd
from scipy import stats

SRC = _os.path.dirname(_os.path.abspath(__file__))

#: Standard Fibonacci extensions. -2.0 is the method as specified in section 3.
LEVELS = [0.618, 1.0, 1.272, 1.618, 2.0, 2.618, 3.618, 4.236]
STOP_OFFSET = 0.5      # the method's own stop: half a leg beyond the entry
LVN_THRESHOLD = 0.25

WORKER = r'''
import os, sys
sys.path.insert(0, os.environ["SRC"])
import numpy as np, pandas as pd
from method import Cfg, setups, trade, DF, INSTRUMENT, TICK

LEVELS = [float(x) for x in os.environ["LEVELS"].split(",")]
OFFSET = float(os.environ["OFFSET"])

# Precompute per-session numpy arrays once. filters.lvn_score does a pd.concat
# of three sessions on every call, which dominates runtime across a sweep.
groups = {s: g.sort_values("ts") for s, g in DF.groupby("session", sort=True)}
keys = sorted(groups)
ki = {s: i for i, s in enumerate(keys)}
H = {s: groups[s].high.to_numpy(float) for s in keys}
L = {s: groups[s].low.to_numpy(float) for s in keys}
C = {s: groups[s].close.to_numpy(float) for s in keys}
V = {s: groups[s].volume.to_numpy(float) for s in keys}

def lvn(r, stop_k, bin_pts):
    """Same definition as filters.lvn_score, on cached arrays."""
    i = ki[r.session]; lo_i = max(i - 2, 0)
    ks = [keys[j] for j in range(lo_i, i + 1)]
    h = np.concatenate([H[k] for k in ks]); l = np.concatenate([L[k] for k in ks])
    c = np.concatenate([C[k] for k in ks]); v = np.concatenate([V[k] for k in ks])
    far = r.B + r.d_ext * stop_k * r.leg
    beyond = np.flatnonzero(h >= far) if r.d_ext > 0 else np.flatnonzero(l <= far)
    if not len(beyond):
        return np.nan
    start = int(beyond[-1])
    if len(h) - start < 60:
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

months = pd.to_datetime(DF.session).dt.to_period("M").nunique()
BIN = 40.0 * TICK
out = []
for k in LEVELS:
    cfg = Cfg(entry_k=k, stop_k=k + OFFSET)
    S = setups(cfg)
    if not len(S):
        continue
    S = S.assign(lvn=[lvn(r, cfg.stop_k, BIN) for r in S.itertuples()])
    T = trade(cfg, S)
    if len(T):
        T = T.merge(S[["session", "lvn"]], on="session", how="left")
    for tag, sub in (("geometry", T), ("lvn", T[T.lvn <= %f] if len(T) else T)):
        out.append(dict(instrument=INSTRUMENT.key, level=k, filt=tag,
                        setups=len(S), n=len(sub), months=months,
                        fill=100.0 * len(T) / len(S),
                        expR=sub.R.mean() if len(sub) else np.nan,
                        win=100.0 * (sub.R > 0).mean() if len(sub) else np.nan,
                        rr=sub.rr.median() if len(sub) else np.nan,
                        net=sub.net.sum() if len(sub) else np.nan,
                        t=stats.ttest_1samp(sub.R, 0)[0] if len(sub) > 2 else np.nan,
                        p=stats.ttest_1samp(sub.R, 0)[1] if len(sub) > 2 else np.nan))
pd.DataFrame(out).to_csv(os.environ["OUT"], index=False)
''' % LVN_THRESHOLD

WORKER = "from scipy import stats\n" + WORKER


def run(key):
    out = f"{ROOT}/results/fib_sweep_{key.lower()}.csv"
    env = dict(_os.environ, SRC=SRC, NQ_INSTRUMENT=key, OUT=out, NQ_ROOT=ROOT,
               LEVELS=",".join(str(x) for x in LEVELS), OFFSET=str(STOP_OFFSET))
    p = subprocess.run([sys.executable, "-c", WORKER], env=env, capture_output=True, text=True)
    if p.returncode != 0:
        print(p.stdout); print(p.stderr, file=sys.stderr)
        raise SystemExit(f"{key} failed")
    return pd.read_csv(out)


def main():
    keys = [a.upper() for a in sys.argv[1:]] or ["NQ", "GC", "CL"]
    all_ = pd.concat([run(k) for k in keys], ignore_index=True)
    all_.to_csv(f"{ROOT}/results/fib_sweep.csv", index=False)

    print("=" * 104)
    print("THE METHOD AT EVERY FIBONACCI LEVEL — EXPLORATORY SWEEP, NOT A FINDING")
    print("stop = entry + 0.5 leg (the method's own rule) · target = level 1")
    print("=" * 104)

    for k in keys:
        d = all_[all_.instrument == k]
        if not len(d):
            continue
        print(f"\n### {k}   (setups do not change with the level; fill rate does)\n")
        print(f"{'entry':>7}{'stop':>7}{'fill%':>8} | {'--------- geometry ---------':>30}"
              f" | {'------- LVN <= 0.25 -------':>29}")
        print(f"{'':>7}{'':>7}{'':>8} | {'n':>5}{'/mo':>6}{'win%':>7}{'expR':>7}{'medRR':>6}"
              f" | {'n':>4}{'win%':>7}{'expR':>7}{'net$':>10}")
        for lv in LEVELS:
            g = d[(d.level == lv) & (d.filt == "geometry")]
            l = d[(d.level == lv) & (d.filt == "lvn")]
            if not len(g):
                continue
            g = g.iloc[0]; l = l.iloc[0] if len(l) else None
            star = " <-- s3" if lv == 2.0 else ""
            print(f"{-lv:>7.3f}{-(lv+STOP_OFFSET):>7.3f}{g.fill:>7.0f}% | {g.n:>5.0f}"
                  f"{g.n/g.months:>6.2f}{g.win:>7.1f}{g.expR:>7.2f}{g.rr:>6.1f} | "
                  f"{(l.n if l is not None else 0):>4.0f}"
                  f"{(l.win if l is not None and l.n else float('nan')):>7.1f}"
                  f"{(l.expR if l is not None and l.n else float('nan')):>7.2f}"
                  f"{(l.net if l is not None and l.n else float('nan')):>10,.0f}{star}")

    # Benjamini-Hochberg across every level x instrument x filter actually tested
    print("\n" + "=" * 104)
    print("BENJAMINI-HOCHBERG at FDR 0.10 across EVERY cell tested in this sweep")
    print("=" * 104)
    t = all_[all_.p.notna() & (all_.n >= 5)].copy().sort_values("p")
    m = len(t)
    if m:
        t["rank"] = range(1, m + 1)
        t["crit"] = 0.10 * t["rank"] / m
        t["survives"] = t.p <= t.crit
        print(f"  {m} cells with n>=5 were tested. Showing the 12 smallest p-values.\n")
        print(f"{'instrument':>11}{'level':>8}{'filter':>10}{'n':>5}{'expR':>8}{'p':>9}{'BHcrit':>9}  ")
        for r in t.head(12).itertuples():
            print(f"{r.instrument:>11}{-r.level:>8.3f}{r.filt:>10}{r.n:>5.0f}"
                  f"{r.expR:>8.2f}{r.p:>9.4f}{r.crit:>9.4f}  "
                  f"{'PASS' if r.survives else 'fail'}")
        print(f"\n  cells surviving BH: {int(t['survives'].sum())} of {m}")
    print("\n" + "=" * 104)
    print("""Any level that looks good here was chosen AFTER seeing the data. Per CLAUDE.md
section 7.5 that is not a finding, and per section 8.2a changing the entry depth
needs its own pre-registration tested on ES, which remains untouched.""")
    print("=" * 104)


if __name__ == "__main__":
    main()
