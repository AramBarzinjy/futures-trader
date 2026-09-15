"""
What the account rules do to this strategy — the two constraints portfolio.py
does not model.

`portfolio.py` models the trailing drawdown and answers "how long to a payout".
It omits two things named in CLAUDE.md section 1 that turn out to dominate:

  1. **Position size is not free.** Too small and the trailing drawdown grinds the
     account out before it ever reaches the buffer; too large and variance kills
     it. There is an interior optimum, and it moves with trade frequency.
  2. **The 40% consistency rule.** No single day may exceed 40% of total profit.
     A 6RR strategy at a 33% win rate earns nearly everything on a handful of
     days, which is precisely what that rule forbids.

Constraint 2 is the binding one and it was never modelled.

    python3 src/constraints.py

IMPORTANT — the consistency rule is modelled on an ASSUMED interpretation:
"at payout, the largest single winning day must be <= 40% of accumulated
profit". Firms word this differently — some apply it only to the evaluation,
some only to a first payout, some measure against gross rather than net. The
conclusion here flips entirely on which applies, so CLAUDE.md section 8.4 (ask
the firm) is the prerequisite for taking any of it seriously.
"""
import os as _os
ROOT = _os.environ.get("NQ_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import numpy as np
import pandas as pd

T = pd.read_csv(ROOT + "/results/lvn_trades.csv")
WINS = T[T.net > 0].net.to_numpy()
LOSSES = T[T.net <= 0].net.to_numpy()
MED_STOP = float(np.median(T.stop_usd))

DD = 2000.0          # trailing drawdown
PASS = 3000.0        # evaluation target
BUFFER = 3000.0      # funded buffer before withdrawing
PAYOUT = 600.0       # minimum payout
CONSISTENCY = 0.40   # no single day above this share of total profit
WINRATE = 1 / 3      # measured on the 24 NQ trades

MEASURED_RATE = 0.81     # NQ 0.61 + GC 0.04 + CL 0.16, see CLAUDE.md section 4a
ASSUMED_8 = 4.88         # what CLAUDE.md section 4 assumed 8 instruments would give


def first_payout(scale, rate, enforce_consistency, max_months=48, seed=0):
    """Months to a first payout, or None if the account dies first.

    `scale` multiplies the 5-micro trade list, so scale 4 is 20 micros.
    Returns (months, profit_at_payout).
    """
    rng = np.random.default_rng(seed)
    eq = peak = 0.0
    floor = -DD
    funded = False
    days = []

    for m in range(max_months):
        for _ in range(rng.poisson(rate)):
            win = rng.random() < WINRATE
            pnl = (rng.choice(WINS) if win else rng.choice(LOSSES)) * scale
            # a winner still draws down intraday before it resolves
            mae = (0.5 * MED_STOP * scale) if win else abs(pnl)
            if eq - mae <= floor:
                return None, None
            eq += pnl
            peak = max(peak, eq)
            floor = max(floor, peak - DD)
            if eq <= floor:
                return None, None
            if funded:
                days.append(pnl)
            if not funded and eq >= PASS:
                funded = True
                eq = peak = 0.0
                floor = -DD
                days = []
        if funded and eq >= BUFFER + PAYOUT:
            if not enforce_consistency or (days and max(days) / eq <= CONSISTENCY):
                return m + 1, eq
    return None, None


def sweep(rate, scales, enforce, runs=3000):
    rows = []
    for sc in scales:
        res = [first_payout(sc, rate, enforce, seed=s) for s in range(runs)]
        months = [r[0] for r in res if r[0]]
        profit = [r[1] for r in res if r[1]]
        rows.append(dict(
            micros=int(5 * sc), scale=sc,
            median=np.median(months) if months else np.nan,
            p2=100 * np.mean([1 if (r[0] and r[0] <= 2) else 0 for r in res]),
            died=100 * (1 - len(months) / runs),
            payout=np.median(profit) if profit else np.nan,
        ))
    return pd.DataFrame(rows)


def main():
    print("=" * 94)
    print("CONSTRAINT 1 — position size has an interior optimum")
    print("=" * 94)
    for label, rate in (("measured NQ+GC+CL", MEASURED_RATE), ("assumed 8 instruments", ASSUMED_8)):
        d = sweep(rate, (1, 2, 2.5, 4, 6, 8, 12), enforce=False)
        print(f"\n{label}, {rate} trades/month — consistency rule NOT enforced")
        print(f"{'micros':>8}{'median months':>16}{'P(<=2mo)':>11}{'account dies':>14}")
        for r in d.itertuples():
            print(f"{r.micros:>8}{r.median:>16.0f}{r.p2:>10.1f}%{r.died:>13.1f}%")
        best = d.loc[d.p2.idxmax()]
        print(f"  -> fastest at {int(best.micros)} micros: P(<=2mo) {best.p2:.1f}%, "
              f"{best.died:.0f}% of accounts die")

    print("\n" + "=" * 94)
    print("CONSTRAINT 2 — the 40% consistency rule, which portfolio.py omits")
    print("=" * 94)
    print(f"\nA 6RR strategy concentrates profit into single days. Median win vs the")
    print(f"${BUFFER + PAYOUT:,.0f} funded leg:\n")
    print(f"{'micros':>8}{'median win':>13}{'as % of the funded leg':>26}")
    for sc in (1, 2.5, 4, 6):
        mw = np.median(WINS) * sc
        print(f"{int(5*sc):>8}{mw:>13,.0f}{100*mw/(BUFFER+PAYOUT):>25.0f}%")
    print(f"\nAnything above {100*CONSISTENCY:.0f}% means one day carries the whole payout.")

    print("\nEnforcing the rule — the account must keep trading to dilute its best day:")
    for label, rate in (("measured NQ+GC+CL", MEASURED_RATE), ("assumed 8 instruments", ASSUMED_8)):
        print(f"\n{label}, {rate} trades/month")
        print(f"{'micros':>8}{'rule OFF':>11}{'rule ON':>10}{'payout needed':>16}{'dies with rule':>17}")
        off = sweep(rate, (2.5, 4, 6), enforce=False)
        on = sweep(rate, (2.5, 4, 6), enforce=True)
        for a, b in zip(off.itertuples(), on.itertuples()):
            print(f"{a.micros:>8}{a.median:>9.0f}mo{b.median:>8.0f}mo"
                  f"{b.payout:>15,.0f}${b.died:>16.1f}%")

    print("\n" + "=" * 94)
    print("READ THIS BEFORE ACTING ON ANY OF IT")
    print("=" * 94)
    print("""
The consistency rule is modelled on an assumed interpretation (largest winning
day <= 40% of accumulated profit, checked at payout). Under that reading the
plan is close to infeasible: the account must accumulate several times the
minimum payout to dilute one winning day below the threshold, and the $2,000
trailing drawdown kills it first in the large majority of runs.

Under a looser reading — evaluation phase only, or first payout only, or gross
rather than net — the picture reverts to the CONSTRAINT 1 tables and the plan is
merely slow rather than broken.

Confirming which applies is CLAUDE.md section 8.4. It is a free question to the
firm and it is now the highest-leverage unknown in the project. Do not size up
on the CONSTRAINT 1 optimum until it is answered.
""")


if __name__ == "__main__":
    main()
