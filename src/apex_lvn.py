"""
Aram's low-volume-node method (CLAUDE.md section 3) under the Apex $50K Intraday rules.

Not a new test of the method: it replays the 24 in-sample trades already in
results/lvn_trades.csv through the Apex lifecycle simulator to see what the
firm's rules do to a strategy of this SHAPE — about 0.5 trades a month, a win
rate near 33%, RR near 6.

Assumptions, all favourable to the method (so the result is an upper bound):
  * The 24 trades are taken at face value. They are in-sample (CLAUDE.md section 7.6),
    and section 4c estimates the out-of-sample edge at roughly half.
  * Intraday paths: winners never go against the entry, and losers never go in
    favour first. The real paths are worse for a trailing threshold.
  * Every session between the first and last trade is a tradeable day, and the
    ones with no trade are flat.

    python3 src/apex_lvn.py
"""
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import apex_rules as AR      # noqa: E402
import apex_sim as SIM       # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    T = pd.read_csv(os.path.join(ROOT, "results", "lvn_trades.csv"), parse_dates=["session"])
    per = T.net / 5.0                                   # $ per micro
    sess = pd.bdate_range("2022-08-04", "2026-09-10")   # CLAUDE.md section 5 window
    days = _days(T.session, per, sess)
    null = _days(T.session, per - per.mean(), sess)     # same shape, edge removed
    print(f"{len(T)} trades over {len(sess)} weekdays = {len(T) / len(sess) * 21:.2f} trades/month\n")
    rows = []
    for cfg_name, cfg in [("Apex as confirmed", AR.PRIMARY)]:
        for m in (5, 8, 12, 20, 30, 40, 60):
            cfg_m = cfg
            s = SIM.run(SIM.day_bootstrap(days, block=1), cfg_m, SIM.Controls(micros=m), n=4000, seed=m)
            z = SIM.run(SIM.day_bootstrap(null, block=1), cfg_m, SIM.Controls(micros=m), n=4000, seed=m)
            rows.append(dict(rules=cfg_name, micros=m, median_win=float(np.median(per[per > 0]) * m),
                             **{k: s[k] for k in ("p_pass", "eval_fail_dd", "eval_fail_timeout",
                                                  "p_any_payout_given_pass", "p_2_payouts_given_pass",
                                                  "median_sessions_to_1st_payout",
                                                  "breakeven_fee", "net_ev_per_attempt")},
                             null_breakeven_fee=z["breakeven_fee"]))
    R = pd.DataFrame(rows)
    pd.set_option("display.width", 250)
    print(R.round(3).to_string(index=False))
    out = os.path.join(ROOT, "results", "apex")
    os.makedirs(out, exist_ok=True)
    R.to_csv(os.path.join(out, "lvn_under_apex.csv"), index=False)


def _days(dates, per, sess):
    by = {}
    for d, x in zip(dates, per):
        # a winner rises to the target with no pullback: (x, x, x); a loser falls
        # to the stop with no run-up first: (0, x, x). Both favourable to the method.
        path = np.array([[x, x, x]]) if x > 0 else np.array([[0.0, x, x]])
        by.setdefault(d, []).append(path)
    return [by.get(d, []) for d in sess]


if __name__ == "__main__":
    main()
