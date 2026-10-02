"""
The registered sizing-rule test (PREREGISTRATION-SIZING.md). Run once.

    python3 src/sizing_test.py
"""
import itertools
import os
import sys
from concurrent.futures import ProcessPoolExecutor

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import apex_rules as AR      # noqa: E402
import apex_sim as SIM       # noqa: E402
import bt                    # noqa: E402
import eval_plan as EP       # noqa: E402

ROOT = EP.ROOT
HALVES = {"2024": ("2024-02-01", "2024-12-31"), "2025": ("2025-01-01", "2025-12-31")}
RULES = {
    "S1 fixed 5": dict(size_rule="fixed", micros=5),
    "S2 cushion 1/3": dict(size_rule="cushion", size_f=1 / 3),
    "S3 cushion 1/2": dict(size_rule="cushion", size_f=1 / 2),
    "S4 cushion 1/2, need 3": dict(size_rule="cushion_need", size_f=1 / 2, size_k=3),
    "S5 cushion 1/2, need 5": dict(size_rule="cushion_need", size_f=1 / 2, size_k=5),
}
N = 6000
_D = {}


def _init(d):
    global _D
    _D = d


def cell(args):
    half, rule, q = args
    ctl = SIM.Controls(pa_micros=2, **RULES[rule])
    rng = np.random.default_rng(hash((half, q)) % 2**32)    # same paths for every rule
    samp = EP.sampler_for(_D[half], q)
    res = [SIM.simulate_path(samp(rng), AR.PRIMARY, ctl, max_days=EP.PA_HORIZON) for _ in range(N)]
    passed = np.array([r["passed"] for r in res])
    paid = np.array([len(r["payouts"]) >= 1 for r in res])
    return dict(half=half, rule=rule, skill=q, p_pass=passed.mean(),
                p_payout_per_attempt=paid.mean(), se=paid.std(ddof=1) / np.sqrt(N),
                median_days_to_pass=float(np.median([r["eval_days"] for r in res if r["passed"]]))
                if passed.any() else np.nan)


def main():
    nq = pd.read_pickle(os.path.join(ROOT, "data", "mnq_cont_1m.pkl"))
    days = {}
    for h, (a, b) in HALVES.items():
        ctx = bt.build_ctx(nq[(nq.session >= a) & (nq.session <= b)].reset_index(drop=True))
        days[h], m = EP.neutralise(EP.day_trades(ctx, 60.0, 1.0))
        print(f"{h}: {len(days[h])} sessions, coin-flip mean before neutralising ${m:+.2f}/micro")
    jobs = list(itertools.product(HALVES, RULES, EP.SKILL))
    with ProcessPoolExecutor(initializer=_init, initargs=(days,)) as ex:
        df = pd.DataFrame(list(ex.map(cell, jobs)))
    df.to_csv(os.path.join(EP.OUT, "sizing_test.csv"), index=False)
    pd.set_option("display.width", 200)
    t = df.pivot_table(index="rule", columns=["half", "skill"], values="p_payout_per_attempt")
    print("\nP(payout per attempt)\n", t.round(3).to_string())
    print("\nP(pass)\n", df.pivot_table(index="rule", columns=["half", "skill"], values="p_pass").round(3).to_string())
    base = t.loc["S1 fixed 5"]
    wins = {r: bool((t.loc[r] > base).all()) for r in RULES if r != "S1 fixed 5"}
    qual = [r for r, w in wins.items() if w]
    choice = max(qual, key=lambda r: t.loc[r].mean()) if qual else "S1 fixed 5"
    print(f"\nbeats S1 in all 6 cells: {wins}\nDECISION (registered rule): {choice}")


if __name__ == "__main__":
    main()
