"""
Two independent checks that do not depend on the stop/target machinery.

1. EDGE PROBE — does the paper's core premise hold on NQ at all?
   Premise: when price trades outside the previous day's value area, it reverts
   toward the current POC. Tested directly as a conditional forward return, with
   no stops, no targets and no costs. If the premise is false here, no amount of
   parameter tuning can rescue the strategy.

2. RANDOM CONTROL — replace the strategy's direction with a coin flip at the same
   entry times. If the real signal performs no better than the coin flip, the
   signal carries no information.
"""
import os as _os
ROOT = _os.environ.get("NQ_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import numpy as np, pandas as pd
from engine import (Params, session_profile, tape_speed, run,
                    POINT_VALUE, COMMISSION_RT, TICK, SLIP_TICKS_ENTRY)

DF = pd.read_pickle(ROOT + "/data/mnq_cont_1m.pkl")
P = Params()
rng = np.random.default_rng(7)


# ------------------------------------------------------------------ 1. probe
def edge_probe(horizons=(15, 30, 60, 120, 240)):
    rows = []
    prev = None
    for sess, g in DF.groupby("session", sort=True):
        g = g.sort_values("ts")
        h, l, c, v = (g[x].to_numpy(float) for x in ("high", "low", "close", "volume"))
        et = g.et
        mins = et.dt.hour * 60 + et.dt.minute
        rth = ((mins >= 9 * 60 + 30) & (mins < 16 * 60)).to_numpy()
        n = len(g)
        if prev is not None and not np.isnan(prev[0]) and not bool(g.roll_day.iloc[0]):
            pPOC, pVAH, pVAL = prev
            ts_l, ts_s = tape_speed(c, v, P)
            for i in range(n):
                if not rth[i] or np.isnan(ts_l[i]):
                    continue
                d = 0
                if c[i] <= pVAL and ts_l[i] >= P.tape_threshold:
                    d = 1
                elif c[i] >= pVAH and ts_s[i] >= P.tape_threshold:
                    d = -1
                if d == 0:
                    continue
                r = {"session": sess, "dir": d}
                for hz in horizons:
                    j = min(i + hz, n - 1)
                    r[f"fwd{hz}"] = (c[j] - c[i]) * d      # points, signed by trade direction
                    r[f"abs{hz}"] = abs(c[j] - c[i])
                rows.append(r)
        prev = session_profile(h[rth], l[rth], c[rth], v[rth],
                               P.bin_points, P.value_area, P.va_method)
    return pd.DataFrame(rows)


# ------------------------------------------------------------------ 2. control
def random_control(n_runs=200):
    """Same engine, but each trade's direction is flipped at random."""
    import engine
    base = run(DF, P)
    if base.empty:
        return None, None
    nets = []
    for _ in range(n_runs):
        flip = rng.choice([1, -1], size=len(base))
        # a flipped trade's P&L is the mirrored move, minus the same costs
        pts = base.points.to_numpy() * flip
        net = pts * POINT_VALUE * P.contracts - base.fees.to_numpy()
        nets.append(net.sum())
    return base.net.sum(), np.array(nets)


if __name__ == "__main__":
    print("=" * 78)
    print("1. EDGE PROBE — forward move after a valid signal (points, no costs/stops)")
    print("=" * 78)
    pr = edge_probe()
    print(f"signals: {len(pr):,}   long {int((pr.dir==1).sum()):,}   short {int((pr.dir==-1).sum()):,}\n")
    print(f"{'horizon':>8} {'mean pts':>10} {'median':>9} {'t-stat':>8} {'P(up)':>8} {'mean |move|':>12}")
    for hz in (15, 30, 60, 120, 240):
        x = pr[f"fwd{hz}"]
        t = x.mean() / (x.std(ddof=1) / np.sqrt(len(x)))
        print(f"{hz:>6}m {x.mean():>10.3f} {x.median():>9.3f} {t:>8.2f} "
              f"{100*(x>0).mean():>7.1f}% {pr[f'abs{hz}'].mean():>12.2f}")
    print("\n  A real mean-reversion edge would show a positive mean move in the trade's")
    print("  direction, growing with horizon, with |t| comfortably above 2.\n")

    print("=" * 78)
    print("2. RANDOM CONTROL — strategy vs 200 coin-flip versions of itself")
    print("=" * 78)
    real, nets = random_control()
    pct = 100 * (nets < real).mean()
    print(f"strategy net      : ${real:>12,.0f}")
    print(f"coin-flip mean    : ${nets.mean():>12,.0f}")
    print(f"coin-flip 5th–95th: ${np.percentile(nets,5):>12,.0f}  to  ${np.percentile(nets,95):>12,.0f}")
    print(f"strategy percentile within the random distribution: {pct:.0f}th")
    print("\n  A signal carrying information lands in the top few percent. Near the middle")
    print("  means the entry rule is doing no better than guessing.")
    pr.to_pickle(ROOT + "/results/edge_probe.pkl")
