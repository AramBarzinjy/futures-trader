"""
The GC/CL transfer test, exactly as registered in PREREGISTRATION-MULTI.md.

Runs the method — fixed, nothing re-fitted — on two markets it was never
developed on, and applies the endpoints declared before the data was pulled:

  primary      pooled GC+CL, LVN <= 0.25 x POC, mean R > 0, one-sided t
  secondary 1  LVN tertile monotonicity, Jonckheere-Terpstra trend test
  secondary 2  filtered expR vs unfiltered geometry, bootstrap interval
  correction   Benjamini-Hochberg at FDR 0.10 across the three

Each instrument runs in its own subprocess because method.py binds its bar data
at import. Per-instrument R breakdowns are printed but are underpowered by
construction (PREREGISTRATION-MULTI.md section 4) and are descriptive only.

    python3 src/transfer_test.py
"""
import os as _os
ROOT = _os.environ.get("NQ_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import subprocess
import sys

import numpy as np
import pandas as pd
from scipy import stats

SRC = _os.path.dirname(_os.path.abspath(__file__))
MARKETS = ["GC", "CL"]
LVN_THRESHOLD = 0.25          # the NQ value. NOT re-fitted. See section 2.
ALPHA = 0.05
FDR = 0.10

WORKER = r'''
import os, sys
sys.path.insert(0, os.environ["SRC"])
import pandas as pd
from method import Cfg, setups, trade, DF, INSTRUMENT
import filters

cfg = Cfg()
S = setups(cfg)
S = S.assign(lvn=[filters.lvn_score(r, cfg) for r in S.itertuples()])
T = trade(cfg, S)
T = T.merge(S[["session", "lvn"]], on="session", how="left")
T["instrument"] = INSTRUMENT.key
T.to_csv(os.environ["OUT"], index=False)

months = pd.to_datetime(DF.session).dt.to_period("M").nunique()
print("MONTHS %d" % months)
print("SESSIONS %d" % DF.session.nunique())
print("SETUPS %d" % len(S))
print("PROFILED %d" % int(S.lvn.notna().sum()))
'''


def run_market(key):
    out = f"{ROOT}/results/transfer_{key.lower()}_trades.csv"
    env = dict(_os.environ, SRC=SRC, NQ_INSTRUMENT=key, OUT=out, NQ_ROOT=ROOT)
    p = subprocess.run([sys.executable, "-c", WORKER], env=env,
                       capture_output=True, text=True)
    if p.returncode != 0:
        print(p.stdout)
        print(p.stderr, file=sys.stderr)
        raise SystemExit(f"{key}: failed")
    meta = dict(l.split() for l in p.stdout.strip().splitlines() if l.startswith(
        ("MONTHS", "SESSIONS", "SETUPS", "PROFILED")))
    return pd.read_csv(out), {k: int(v) for k, v in meta.items()}


def jonckheere(groups):
    """Jonckheere-Terpstra trend test for an ordered alternative.

    `groups` is a list of arrays in the hypothesised increasing order. Returns
    (J, z, one-sided p). Not in scipy, so implemented here: J counts, over every
    ordered pair of groups, how often a later-group value exceeds an earlier one.
    """
    k = len(groups)
    J = 0.0
    for i in range(k - 1):
        for j in range(i + 1, k):
            a, b = np.asarray(groups[i]), np.asarray(groups[j])
            J += (b[:, None] > a[None, :]).sum() + 0.5 * (b[:, None] == a[None, :]).sum()
    n = np.array([len(g) for g in groups], float)
    N = n.sum()
    EJ = (N ** 2 - (n ** 2).sum()) / 4.0
    VJ = (N ** 2 * (2 * N + 3) - (n ** 2 * (2 * n + 3)).sum()) / 72.0
    z = (J - EJ) / np.sqrt(VJ)
    return J, z, 1 - stats.norm.cdf(z)


def bootstrap_diff(a, b, n=20000, seed=0):
    """Bootstrap interval for mean(a) - mean(b), resampled independently."""
    rng = np.random.default_rng(seed)
    d = (rng.choice(a, (n, len(a))).mean(1) - rng.choice(b, (n, len(b))).mean(1))
    return d.mean(), np.percentile(d, 2.5), np.percentile(d, 97.5)


def describe(T, label, months):
    """Declared descriptive block. No significance attached."""
    if not len(T):
        print(f"  {label:<26} no trades")
        return
    dd = (T.net.cumsum().cummax() - T.net.cumsum()).max()
    print(f"  {label:<26} n={len(T):>3}  {len(T)/months:>4.2f}/mo  "
          f"win={100*(T.R>0).mean():>5.1f}%  expR={T.R.mean():>6.2f}  "
          f"net=${T.net.sum():>9,.0f}  maxDD=${dd:>7,.0f}  "
          f"medStop=${T.stop_usd.median():>6.0f}  medRR={T.rr.median():>4.1f}")


def main():
    print("=" * 100)
    print("GC/CL TRANSFER TEST — protocol fixed in PREREGISTRATION-MULTI.md before the pull")
    print("=" * 100)

    frames, meta = {}, {}
    print("\nPER-INSTRUMENT (descriptive; underpowered by construction — section 4)\n")
    for k in MARKETS:
        T, m = run_market(k)
        frames[k], meta[k] = T, m
        print(f"{k}: {m['SESSIONS']} sessions over {m['MONTHS']} months, "
              f"{m['SETUPS']} setups ({m['SETUPS']/m['MONTHS']:.2f}/mo), "
              f"{m['PROFILED']} with a computable volume profile")
        describe(T, "geometry alone", m["MONTHS"])
        describe(T[T.lvn <= LVN_THRESHOLD], f"LVN <= {LVN_THRESHOLD}", m["MONTHS"])
        print()

    pooled = pd.concat(frames.values(), ignore_index=True)
    pooled.to_csv(f"{ROOT}/results/transfer_pooled_trades.csv", index=False)
    months = max(m["MONTHS"] for m in meta.values())

    print("=" * 100)
    print("POOLED GC + CL — the registered primary sample")
    print("=" * 100)
    describe(pooled, "geometry alone", months)
    describe(pooled[pooled.lvn <= LVN_THRESHOLD], f"LVN <= {LVN_THRESHOLD}", months)

    tests = []

    # ---- PRIMARY ----
    F = pooled[pooled.lvn <= LVN_THRESHOLD]
    R = F.R.to_numpy()
    print(f"\n--- PRIMARY: pooled LVN <= {LVN_THRESHOLD}, mean R > 0, one-sided ---")
    if len(R) < 3:
        print(f"  n={len(R)} — too few to test")
        p1 = np.nan
    else:
        t, p2 = stats.ttest_1samp(R, 0)
        p1 = p2 / 2 if t > 0 else 1 - p2 / 2
        print(f"  n = {len(R)}   mean R = {R.mean():+.3f}   sd = {R.std(ddof=1):.3f}")
        print(f"  t = {t:+.3f}   one-sided p = {p1:.4f}   (two-sided {p2:.4f})")
        print(f"  registered power at this n: ~{'75' if len(R) >= 40 else '45-60'}% "
              f"against the full NQ effect")
        tests.append(("primary: pooled expR > 0", p1))

    # ---- SECONDARY 1: tertile monotonicity ----
    print("\n--- SECONDARY 1: LVN tertile monotonicity (fits no threshold) ---")
    P = pooled[pooled.lvn.notna()].copy()
    if len(P) >= 9:
        P["tertile"] = pd.qcut(P.lvn, 3, labels=["emptiest", "middle", "busiest"])
        for name in ("emptiest", "middle", "busiest"):
            g = P[P.tertile == name]
            print(f"  {name:<9} n={len(g):>3}  win={100*(g.R>0).mean():>5.1f}%  "
                  f"expR={g.R.mean():>+6.2f}")
        ordered = [P[P.tertile == n].R.to_numpy() for n in ("busiest", "middle", "emptiest")]
        J, z, pj = jonckheere(ordered)
        print(f"  Jonckheere-Terpstra (busiest -> emptiest increasing): "
              f"z = {z:+.3f}, one-sided p = {pj:.4f}")
        print(f"  NQ reference: emptiest +2.53R, middle +0.16R, busiest -1.02R")
        tests.append(("secondary 1: tertile trend", pj))
    else:
        print(f"  n={len(P)} — too few to split")

    # ---- SECONDARY 2: does filtering beat not filtering ----
    print("\n--- SECONDARY 2: filtered vs unfiltered geometry ---")
    U = pooled[pooled.lvn.notna()]
    if len(F) >= 3 and len(U) >= 3:
        d, lo, hi = bootstrap_diff(F.R.to_numpy(), U.R.to_numpy())
        print(f"  filtered expR {F.R.mean():+.3f} (n={len(F)})  vs  "
              f"unfiltered {U.R.mean():+.3f} (n={len(U)})")
        print(f"  difference {d:+.3f}  95% bootstrap CI [{lo:+.3f}, {hi:+.3f}]")
        print(f"  NQ reference: +1.34 vs -0.21, a difference of +1.55")
        # one-sided p via the bootstrap: how often the difference is <= 0
        rng = np.random.default_rng(1)
        a, b = F.R.to_numpy(), U.R.to_numpy()
        diffs = (rng.choice(a, (20000, len(a))).mean(1)
                 - rng.choice(b, (20000, len(b))).mean(1))
        pb = (diffs <= 0).mean()
        print(f"  one-sided bootstrap p = {pb:.4f}")
        tests.append(("secondary 2: filter beats geometry", pb))

    # ---- BENJAMINI-HOCHBERG ----
    print("\n" + "=" * 100)
    print(f"BENJAMINI-HOCHBERG at FDR {FDR} across the {len(tests)} registered tests")
    print("=" * 100)
    if tests:
        tests.sort(key=lambda x: x[1])
        m = len(tests)
        passed = []
        for i, (name, p) in enumerate(tests, 1):
            crit = FDR * i / m
            ok = p <= crit
            if ok:
                passed = tests[:i]
            print(f"  {name:<40} p={p:.4f}  BH crit={crit:.4f}  "
                  f"{'PASS' if ok else 'fail'}")
        names = {n for n, _ in passed}
        print(f"\n  surviving BH: {', '.join(names) if names else 'none'}")

    print("\n" + "=" * 100)
    print("Read the verdict against the decision rule in PREREGISTRATION-MULTI.md section 7.")
    print("=" * 100)


if __name__ == "__main__":
    main()
