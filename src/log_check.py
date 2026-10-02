"""
Read trade_log.csv and apply EVAL_PLAYBOOK.md's decision rule.

    python3 src/log_check.py                 # uses trade_log.csv at the repo root
    python3 src/log_check.py path/to/log.csv

What it reports
  * Directional win rate over every scored call, with a 95% interval.
    A call is scored when exit_reason is target (win), stop (loss), or time
    (win if points > 0). Untraded calls count too, if you fill in what the
    bracket would have done. That's the cleanest way to grow the sample without
    paying for it.
  * The playbook decision: keep logging, stop buying evaluations, or keep going.
  * Per account, from closed trades only: balance, an estimated trailing floor,
    and the distance to the floor and to the target. The floor really trails
    intraday peaks, so Apex's dashboard number is the true one. Use it.
  * Tomorrow's size: 5 micros in an evaluation, 2 in a funded (PA) account.
"""
import math
import os
import sys

import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
START, TARGET, DD, EVAL_LOCK, PA_LOCK, SAFETY_NET = 50_000, 3_000, 2_000, 53_000, 50_100, 52_100
PT = 2.0          # $ per point per MNQ


def wilson(k, n, z=1.96):
    if n == 0:
        return (0.0, 1.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return c - h, c + h


def load(path):
    df = pd.read_csv(path, dtype=str).fillna("")
    df = df[~df.notes.str.contains("example row", case=False)]
    df["points"] = pd.to_numeric(df.points, errors="coerce")
    df["usd"] = pd.to_numeric(df.usd, errors="coerce")
    if "micros" in df:
        m = pd.to_numeric(df.micros, errors="coerce")
        df["usd"] = df.usd.fillna(df.points * PT * m)
    df["reason"] = df.exit_reason.str.strip().str.lower()
    df["win"] = pd.NA
    df.loc[df.reason == "target", "win"] = True
    df.loc[df.reason == "stop", "win"] = False
    t = df.reason == "time"
    df.loc[t & (df.points > 0), "win"] = True
    df.loc[t & (df.points <= 0), "win"] = False
    return df


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "trade_log.csv")
    df = load(path)
    s = df[df.win.notna()]
    n, k = len(s), int(s.win.astype(bool).sum())
    lo, hi = wilson(k, n)
    print(f"scored calls: {n}   wins: {k}   win rate: {k / n:.0%}   95% interval {lo:.0%}–{hi:.0%}"
          if n else "scored calls: 0 — log your first call")
    late = (df.call_made_before_0930_ET.str.lower() == "no").sum()
    if late:
        print(f"warning: {late} call(s) made after 09:30 ET. They are not clean tests of skill.")

    if n < 30:
        print(f"\nDECISION: keep logging. {30 - n} more scored calls before the first check.")
    elif k / n <= 0.50:
        print("\nDECISION: STOP buying evaluations. At a coin-flip win rate the playbook pays out on about 3% "
              "of attempts, roughly £780 of fees per payout.")
    elif k / n >= 0.55:
        print("\nDECISION: keep going. Stagger one new evaluation every week or two, and keep logging.")
    elif n < 60:
        print(f"\nDECISION: in between. Keep logging to 60 calls ({60 - n} to go) before deciding.")
    else:
        print("\nDECISION: still between 50% and 55% after 60 calls. The edge, if any, is too small to pay "
              "for evaluations. Stop buying them.")

    traded = df[(df.traded.str.lower() == "yes") & df.usd.notna() & (df.account != "")]
    if traded.empty:
        return
    print("\nAccounts (closed trades only; Apex's dashboard shows the true trailing floor):")
    for acct, g in traded.groupby("account", sort=False):
        pa = acct.lower().startswith("pa")
        bal = START + g.usd.cumsum()
        floor = min(max((bal.cummax() - DD).max(), START - DD), PA_LOCK if pa else EVAL_LOCK)
        last = bal.iloc[-1]
        line = f"  {acct:<10} trades {len(g):>3}   balance ${last:,.0f}   est. floor ${floor:,.0f}   " \
               f"room ${last - floor:,.0f}"
        if pa:
            q = int((g.groupby('date').usd.sum() >= 200).sum())
            line += f"   qualifying days {q}   withdrawable ${max(last - SAFETY_NET, 0):,.0f}"
            size = 2
        else:
            line += f"   to target ${max(START + TARGET - last, 0):,.0f}"
            size = 5
        print(line + f"   next trade: {size} micros")


if __name__ == "__main__":
    main()
