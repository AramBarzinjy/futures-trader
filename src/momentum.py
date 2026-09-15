"""
Event-driven backtest of the one effect that survived the survey: intraday momentum
(first-hour RTH direction continues into the close).

The survey measured the raw edge with no stop — +14.6 net points, but with a 121-point
standard deviation per trade. At 5 micros that is $1,210 of noise per trade against a
$2,000 trailing drawdown. This script asks the question the survey cannot: does the
edge survive being shaped to fit the account, or does the stop eat it?

Discovery set only until the configuration is fixed.
"""
import os as _os
ROOT = _os.environ.get("NQ_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import numpy as np, pandas as pd, pickle
from dataclasses import dataclass
from scipy import stats

POINT = 2.00
COMMISSION_RT = 1.20
TICK = 0.25
SPLIT = pd.Timestamp("2025-01-01")

F = pd.read_pickle(ROOT + "/data/features.pkl")
PATHS = pickle.load(open(ROOT + "/data/paths.pkl", "rb"))
F = F[F.p_rth_close.notna() & F.atr.notna()].reset_index(drop=True)


@dataclass
class Cfg:
    trigger: int = 630          # minutes from midnight ET: 630 = 10:30
    conviction: float = 0.0     # require |first-hour move| >= conviction * ATR
    stop_pts: float = 60.0
    target_pts: float = 0.0     # 0 = hold to the close
    trail_pts: float = 0.0      # 0 = no trail
    contracts: int = 5
    flat_min: int = 955         # 15:55 ET
    max_stop_dollars: float = 0.0   # 0 = no cap


def run(frame, c: Cfg):
    trades = []
    for row in frame.itertuples():
        p = PATHS.get(row.session)
        if p is None:
            continue
        m, hi, lo, cl = p["mins"], p["high"], p["low"], p["close"]
        i0 = np.flatnonzero(m >= c.trigger)
        if not len(i0):
            continue
        i0 = i0[0]
        move = cl[i0] - row.rth_open
        if move == 0 or abs(move) < c.conviction * row.atr:
            continue
        d = int(np.sign(move))
        entry = cl[i0] + d * TICK            # one tick of entry slippage

        stop = entry - d * c.stop_pts
        target = entry + d * c.target_pts if c.target_pts else None
        exit_px = exit_reason = None
        peak = entry

        for j in range(i0 + 1, len(m)):
            if c.trail_pts:
                peak = max(peak, hi[j - 1]) if d > 0 else min(peak, lo[j - 1])
                stop = max(stop, peak - c.trail_pts) if d > 0 else min(stop, peak + c.trail_pts)
            if d > 0:
                if lo[j] <= stop:
                    exit_px, exit_reason = stop - 2 * TICK, "stop"; break
                if target and hi[j] >= target:
                    exit_px, exit_reason = target, "target"; break
            else:
                if hi[j] >= stop:
                    exit_px, exit_reason = stop + 2 * TICK, "stop"; break
                if target and lo[j] <= target:
                    exit_px, exit_reason = target, "target"; break
            if m[j] >= c.flat_min:
                exit_px, exit_reason = cl[j] - d * TICK, "close"; break
        if exit_px is None:
            exit_px, exit_reason = cl[-1] - d * TICK, "close"

        pts = (exit_px - entry) * d
        # worst adverse excursion while the position was open (for the trailing DD)
        seg = slice(i0 + 1, len(m))
        mae = (entry - lo[seg].min()) if d > 0 else (hi[seg].max() - entry)
        trades.append(dict(
            session=row.session, year=row.year, dir=d, entry=entry, exit=exit_px,
            reason=exit_reason, points=pts, mae_pts=max(mae, 0.0),
            net=pts * POINT * c.contracts - COMMISSION_RT * c.contracts,
        ))
    return pd.DataFrame(trades)


def evaluate(tr, c: Cfg, label=""):
    if tr.empty or len(tr) < 20:
        return dict(label=label, n=len(tr))
    x = tr.net.to_numpy()
    t, p = stats.ttest_1samp(x, 0.0)
    months = pd.to_datetime(tr.session).dt.to_period("M")
    mo = tr.groupby(months).net.sum()
    eq = np.cumsum(x)
    dd = float((eq - np.maximum.accumulate(eq)).min())
    yrs = tr.groupby("year").net.sum()
    return dict(
        label=label, n=len(tr), win=100 * (x > 0).mean(),
        exp=x.mean(), sd=x.std(ddof=1), t=t, p=p,
        net=x.sum(), max_dd=dd,
        avg_month=mo.mean(), med_month=mo.median(), worst_month=mo.min(),
        pos_months=100 * (mo > 0).mean(), pos_years=f"{int((yrs>0).sum())}/{len(yrs)}",
        stop_rate=100 * (tr.reason == "stop").mean(),
    )


def evaluation_mc(tr, contracts, n=4000, month_len=21, seed=3):
    """P(reach +$3,000 before the $2,000 trailing limit) in a one-month window."""
    rng = np.random.default_rng(seed)
    per = tr.net.to_numpy() / 5 * contracts          # trades were sized at 5
    mae = tr.mae_pts.to_numpy() * POINT * contracts
    ntr = int(round(month_len * len(tr) / pd.to_datetime(tr.session).nunique()))
    ntr = max(ntr, 1)
    wins = blow = 0
    for _ in range(n):
        idx = rng.integers(0, len(per), ntr)
        eq = peak = 0.0; floor_ = -2000.0; done = False
        for k in idx:
            if eq - mae[k] <= floor_:
                blow += 1; done = True; break
            eq += per[k]; peak = max(peak, eq); floor_ = max(floor_, peak - 2000.0)
            if eq <= floor_:
                blow += 1; done = True; break
            if eq >= 3000:
                wins += 1; done = True; break
        if not done and eq >= 3000:
            wins += 1
    return 100 * wins / n, 100 * blow / n


def show(r):
    if r.get("n", 0) < 20:
        print(f"{r['label']:<34} too few trades ({r.get('n',0)})"); return
    print(f"{r['label']:<34}n={r['n']:>4} win={r['win']:>5.1f}% exp=${r['exp']:>7.2f} "
          f"t={r['t']:>5.2f} net=${r['net']:>9,.0f} DD=${r['max_dd']:>8,.0f} "
          f"mo=${r['avg_month']:>7,.0f} yrs={r['pos_years']}")


if __name__ == "__main__":
    disc = F[F.session < SPLIT]
    print(f"discovery: {len(disc)} sessions\n")
    print("=" * 108)
    print("STOP SIZE — does the edge survive a stop tight enough for the account?")
    print("=" * 108)
    for s in (20, 30, 40, 60, 80, 120, 200, 400):
        c = Cfg(stop_pts=s)
        show(evaluate(run(disc, c), c, f"stop {s}pt, hold to close"))

    print("\n" + "=" * 108)
    print("CONVICTION FILTER — trade only when the first-hour move is decisive")
    print("=" * 108)
    for k in (0.0, 0.10, 0.15, 0.20, 0.30):
        c = Cfg(stop_pts=60, conviction=k)
        show(evaluate(run(disc, c), c, f"conviction {k:.2f}xATR, stop 60pt"))

    print("\n" + "=" * 108)
    print("EXIT STYLE")
    print("=" * 108)
    for lbl, c in [
        ("hold to close, stop 60", Cfg(stop_pts=60)),
        ("trail 60pt", Cfg(stop_pts=60, trail_pts=60)),
        ("trail 40pt", Cfg(stop_pts=60, trail_pts=40)),
        ("target 2R (120pt)", Cfg(stop_pts=60, target_pts=120)),
        ("target 3R (180pt)", Cfg(stop_pts=60, target_pts=180)),
    ]:
        show(evaluate(run(disc, c), c, lbl))
