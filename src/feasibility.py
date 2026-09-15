"""Year-by-year stability, and whether the $3k/month goal is reachable at all
inside a $2,000 trailing drawdown."""
import os as _os
ROOT = _os.environ.get("NQ_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import pandas as pd, numpy as np
from engine import Params, run, simulate_account, POINT_VALUE, COMMISSION_RT

DF = pd.read_pickle(ROOT + "/data/mnq_cont_1m.pkl")
rng = np.random.default_rng(11)

BEST = dict(target_mode="rmult", rr=8.0, stop_points=20.0, entry_session="rth")
PAPER = dict(target_mode="freeze", stop_points=40.0, entry_session="rth")


def yearly(cfg, label, contracts=5):
    p = Params(contracts=contracts, **cfg)
    tr = run(DF, p)
    tr["year"] = pd.to_datetime(tr.session).dt.year
    g = tr.groupby("year").agg(
        trades=("net", "size"), win=("net", lambda x: 100 * (x > 0).mean()),
        exp=("net", "mean"), net=("net", "sum"))
    g["per_month"] = g.net / 12
    print(f"\n--- {label}  ({contracts} micros) ---")
    print(g.round(2).to_string())
    print(f"  full period net ${tr.net.sum():,.0f}   "
          f"positive years {int((g.net>0).sum())}/{len(g)}")
    return tr


def sizing(tr, p):
    """What contract size would be needed for $3k/month, and what it does to risk."""
    months = pd.to_datetime(tr.session).dt.to_period("M").nunique()
    per_micro_per_month = tr.net.sum() / p.contracts / months
    print(f"\n  net per micro per month      : ${per_micro_per_month:,.2f}")
    if per_micro_per_month > 0:
        need = 3000 / per_micro_per_month
        print(f"  micros needed for $3,000/mo  : {need:,.0f}   (account cap: 60)")
    else:
        print("  micros needed for $3,000/mo  : impossible — expectancy is negative")


def mc_pass_rate(tr, p, n=5000, month_len=21):
    """Bootstrap one-month evaluations: P(reach +$3,000 before breaching -$2,000)."""
    net = tr.net.to_numpy() / p.contracts      # per-micro P&L
    mae = tr.mae_pts.to_numpy() * POINT_VALUE  # per-micro adverse excursion
    per_day = len(tr) / pd.to_datetime(tr.session).nunique()
    ntr = max(int(round(month_len * per_day)), 1)
    for size in (2, 3, 5, 6, 10, 20):
        passes = breaches = 0
        for _ in range(n):
            idx = rng.integers(0, len(net), ntr)
            eq, peak, floor_ = 0.0, 0.0, -2000.0
            done = False
            for k in idx:
                if eq - mae[k] * size <= floor_:
                    breaches += 1; done = True; break
                eq += net[k] * size
                peak = max(peak, eq)
                floor_ = max(floor_, peak - 2000.0)
                if eq <= floor_:
                    breaches += 1; done = True; break
                if eq >= 3000:
                    passes += 1; done = True; break
            if not done and eq >= 3000:
                passes += 1
        print(f"    {size:>3} micros :  pass {100*passes/n:>5.1f}%   "
              f"blow-up {100*breaches/n:>5.1f}%   neither {100*(n-passes-breaches)/n:>5.1f}%")


if __name__ == "__main__":
    print("=" * 70)
    print("YEAR-BY-YEAR STABILITY")
    print("=" * 70)
    t_paper = yearly(PAPER, "paper as written (POC target)")
    t_best = yearly(BEST, "best exit variant found (8R / 20pt stop)")

    print("\n" + "=" * 70)
    print("CAN THE $3,000/MONTH TARGET BE REACHED?")
    print("=" * 70)
    p5 = Params(contracts=5, **BEST)
    print("\n  [best variant found]")
    sizing(t_best, p5)
    print("\n  [paper as written]")
    sizing(t_paper, Params(contracts=5, **PAPER))

    print("\n" + "=" * 70)
    print("ONE-MONTH EVALUATION SIMULATION — best variant, 5,000 runs per size")
    print("  pass = +$3,000 reached   |   blow-up = -$2,000 trailing limit hit")
    print("=" * 70)
    mc_pass_rate(t_best, p5)
