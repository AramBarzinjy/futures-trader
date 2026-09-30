"""
What edge does the Apex $50K Intraday account actually require? No market data used.

The brief's closing section guesses "$2-5 per contract per day" and says to
verify it against the real rules. This does that: it runs the lifecycle simulator
on synthetic trading days of known daily Sharpe and known account-level daily
volatility, and reports pass rates, funded survival and the break-even fee.

Only two numbers matter once position size is free: the daily Sharpe (mu / sigma,
which no sizing changes) and the daily sigma in dollars (which sizing sets). So
the map is laid out on those two axes, at two trade frequencies.

    python3 src/edge_map.py            # ~5 min on 4 cores
    python3 src/edge_map.py --quick    # fewer paths

Writes results/apex/edge_map.csv.
"""
import argparse
import itertools
import os
import sys
from concurrent.futures import ProcessPoolExecutor

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import apex_rules as AR      # noqa: E402
import apex_sim as SIM       # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "results", "apex")

SHARPE = [0.0, 0.05, 0.10, 0.15, 0.20, 0.30, 0.50]
SIGMA = [150, 250, 350, 500, 650, 800, 1200]
FREQ = [1.0, 0.25]                   # share of sessions with a trade


def cell(args):
    sr, sig, p, dd_name, n = args
    cfg = AR.PRIMARY if dd_name == "2000" else AR.ALT_DD
    # sigma and mu are per ACTIVE day, so the per-session Sharpe is sr at p=1
    # and sr*sqrt(p) otherwise; the map is indexed by per-active-day values
    mu = sr * sig
    s = SIM.run(SIM.synthetic_days(mu, sig, p_trade=p), cfg, SIM.Controls(micros=1), n=n,
                seed=int(1000 * sr + sig + 7 * p))
    return dict(dd=dd_name, sharpe_active_day=sr, sigma_day=sig, p_trade=p,
                sharpe_ann=sr * np.sqrt(252 * p), mu_day=mu, **s)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    a = ap.parse_args()
    n = 300 if a.quick else 1500
    jobs = [(sr, sg, p, dd, n) for sr, sg, p, dd in
            itertools.product(SHARPE, SIGMA, FREQ, ["2000"])]
    # the $2,500 drawdown alternative was retired when Aram confirmed $2,000
    with ProcessPoolExecutor() as ex:
        rows = list(ex.map(cell, jobs))
    df = pd.DataFrame(rows)
    os.makedirs(OUT, exist_ok=True)
    df.to_csv(os.path.join(OUT, "edge_map.csv"), index=False)

    pd.set_option("display.width", 200)
    for p in FREQ:
        d = df[(df.dd == "2000") & (df.p_trade == p)]
        print(f"\n=== $2,000 trailing, trade on {p:.0%} of sessions ===")
        for col, lab in [("p_pass", "P(pass evaluation)"),
                         ("p_2_payouts_given_pass", "P(2+ payouts | passed)"),
                         ("breakeven_fee", "break-even fee $ (mean payouts per attempt)")]:
            t = d.pivot(index="sharpe_active_day", columns="sigma_day", values=col)
            print(f"\n{lab}   rows: daily Sharpe per active day   cols: daily sigma $")
            print(t.round(2 if col != "breakeven_fee" else 0).to_string())
    d = df[(df.dd == "2000") & (df.p_trade == 1.0)]
    print("\nnet value per attempt after the ~GBP 18 eval and ~GBP 40 activation fees, $")
    print(d.pivot(index="sharpe_active_day", columns="sigma_day", values="net_ev_per_attempt").round(0).to_string())


if __name__ == "__main__":
    main()
