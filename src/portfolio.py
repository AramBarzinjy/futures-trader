"""
Why six months, and what running many accounts actually changes.

One stream of trades (the strategy across 5 instruments) is generated once. Every
account is a wrapper over that same stream — which is exactly what a copy-trader
does — but each has its own equity, its own peak and its own trailing floor, and
its own start date. That last part matters: because the drawdown trails the peak,
two accounts running identical trades from different start dates are NOT the same
account. The one that is already up has a higher floor and dies on a pullback the
newer one survives. Staggered entry decorrelates copy-traded accounts for free.
"""
import os as _os
ROOT = _os.environ.get("NQ_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import numpy as np, pandas as pd

T = pd.read_csv(ROOT + "/results/lvn_trades.csv")
WINS = T[T.net > 0].net.to_numpy()
LOSSES = T[T.net <= 0].net.to_numpy()
MED_STOP = float(np.median(T.stop_usd))
RATE = 0.61          # trades/month per instrument
FEE = 18 * 1.34      # GBP 18 -> USD
DD = 2000.0
PASS = 3000.0
BUFFER = 3000.0
PAYOUT = 600.0


def trade_stream(months, n_inst, winrate, scale, rng):
    """One shared sequence of (pnl, adverse_excursion) per month."""
    out = []
    for _ in range(months):
        k = rng.poisson(RATE * n_inst)
        mo = []
        for _ in range(k):
            if rng.random() < winrate:
                pnl = rng.choice(WINS) * scale
                mae = 0.5 * MED_STOP * scale
            else:
                pnl = rng.choice(LOSSES) * scale
                mae = abs(pnl)
            mo.append((pnl, mae))
        out.append(mo)
    return out


class Account:
    """An evaluation that becomes a funded account. Dies on the trailing limit."""
    __slots__ = ("eq", "peak", "floor", "funded", "alive")

    def __init__(self):
        self.eq = 0.0; self.peak = 0.0; self.floor = -DD
        self.funded = False; self.alive = True

    def month(self, trades):
        """Apply a month of trades. Returns dollars withdrawn this month."""
        if not self.alive:
            return 0.0
        for pnl, mae in trades:
            if self.eq - mae <= self.floor:
                self.alive = False; return 0.0
            self.eq += pnl
            self.peak = max(self.peak, self.eq)
            self.floor = max(self.floor, self.peak - DD)
            if self.eq <= self.floor:
                self.alive = False; return 0.0
            if not self.funded and self.eq >= PASS:
                # passed: account resets to a funded state
                self.funded = True
                self.eq = 0.0; self.peak = 0.0; self.floor = -DD
        if self.funded and self.eq >= BUFFER + PAYOUT:
            take = ((self.eq - BUFFER) // PAYOUT) * PAYOUT
            self.eq -= take
            self.peak = self.eq; self.floor = self.eq - DD
            return float(take)
        return 0.0


def campaign(n_accounts, months=24, n_inst=5, winrate=1 / 3, scale=2.5,
             stagger=True, seed=0):
    """Maintain n_accounts at all times, replacing any that die."""
    rng = np.random.default_rng(seed)
    stream = trade_stream(months, n_inst, winrate, scale, rng)
    accounts, fees = [], 0.0
    # stagger: open accounts one per month at the start rather than all at once
    to_open = list(range(n_accounts))
    withdrawn = np.zeros(months)
    first = None

    for m in range(months):
        if stagger:
            while to_open and len([a for a in accounts if a.alive]) < min(m + 1, n_accounts):
                accounts.append(Account()); fees += FEE; to_open.pop()
        else:
            while len(accounts) < n_accounts:
                accounts.append(Account()); fees += FEE
        # replace dead accounts
        dead = [a for a in accounts if not a.alive]
        for a in dead:
            accounts.remove(a); accounts.append(Account()); fees += FEE
        got = sum(a.month(stream[m]) for a in accounts)
        withdrawn[m] = got
        if got > 0 and first is None:
            first = m + 1
    return first, withdrawn, fees


def summarise(n, runs=600, **kw):
    firsts, tot, fee = [], [], []
    for s in range(runs):
        f, w, fe = campaign(n, seed=s, **kw)
        firsts.append(f if f else np.nan); tot.append(w.sum()); fee.append(fe)
    firsts = np.array(firsts, float)
    paid = ~np.isnan(firsts)
    return dict(
        n=n,
        med_first=np.nanmedian(firsts) if paid.any() else np.nan,
        p25=np.nanpercentile(firsts, 25) if paid.any() else np.nan,
        never=100 * (1 - paid.mean()),
        per_month=np.mean(tot) / 24,
        fees_month=np.mean(fee) / 24,
    )


if __name__ == "__main__":
    print("24-month campaign · 12 micros · 5 instruments · 33% win rate (measured)")
    print("All accounts copy-traded off one signal stream, dead ones replaced.\n")
    for tag, stag in (("STAGGERED entry (one new account per month)", True),
                      ("ALL OPENED AT ONCE", False)):
        print(tag)
        print(f"{'accounts':>9}{'median mo to 1st payout':>26}{'25th pct':>10}"
              f"{'never paid':>12}{'$/month':>11}{'fees/mo':>10}")
        for n in (1, 3, 5, 10, 20):
            r = summarise(n, stagger=stag)
            print(f"{n:>9}{r['med_first']:>26.0f}{r['p25']:>10.0f}{r['never']:>11.1f}%"
                  f"{r['per_month']:>11,.0f}{r['fees_month']:>9,.0f}")
        print()
