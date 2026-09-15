import numpy as np, pandas as pd
from engine import Params, simulate_account, POINT_VALUE


def summarize(tr: pd.DataFrame, p: Params, label=""):
    if tr.empty:
        return dict(label=label, trades=0)
    wins = tr[tr.net > 0]
    losses = tr[tr.net <= 0]
    monthly = tr.set_index(pd.to_datetime(tr.session)).net.resample("ME").sum()
    acct = simulate_account(tr, p)

    gross_w = wins.net.sum()
    gross_l = -losses.net.sum()
    # max drawdown of the realised equity curve
    eq = p.start_equity + tr.net.cumsum()
    dd = (eq - eq.cummax()).min()

    exp = tr.net.mean()
    sd = tr.net.std(ddof=1)
    # per-trade t-stat: is the mean net P&L distinguishable from zero?
    tstat = exp / (sd / np.sqrt(len(tr))) if sd > 0 else np.nan

    return dict(
        label=label,
        trades=len(tr),
        win_rate=100 * len(wins) / len(tr),
        avg_win=wins.net.mean() if len(wins) else 0.0,
        avg_loss=losses.net.mean() if len(losses) else 0.0,
        expectancy=exp,
        t_stat=tstat,
        profit_factor=(gross_w / gross_l) if gross_l > 0 else np.inf,
        net=tr.net.sum(),
        max_dd=dd,
        months=len(monthly),
        avg_month=monthly.mean(),
        med_month=monthly.median(),
        worst_month=monthly.min(),
        pos_months=100 * (monthly > 0).mean(),
        breached=acct["breached"],
        breach_date=acct.get("breach_date"),
        target_hits=100 * (tr.reason == "target").mean(),
        stop_hits=100 * (tr.reason == "stop").mean(),
        eod_hits=100 * (tr.reason == "eod").mean(),
        monthly=monthly,
    )


def show(s):
    if s.get("trades", 0) == 0:
        print(f"{s['label']}: no trades")
        return
    b = "BREACHED " + str(s["breach_date"])[:10] if s["breached"] else "survived"
    print(
        f"{s['label']:<26} n={s['trades']:>5}  win={s['win_rate']:>5.1f}%  "
        f"exp=${s['expectancy']:>8.2f}  t={s['t_stat']:>6.2f}  PF={s['profit_factor']:>5.2f}  "
        f"net=${s['net']:>10,.0f}  maxDD=${s['max_dd']:>9,.0f}  "
        f"avgMo=${s['avg_month']:>8,.0f}  {b}"
    )
