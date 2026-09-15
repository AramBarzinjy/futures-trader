"""
Out-of-sample validation and prop-account feasibility.

The sweeps picked the best of ~240 configurations on the whole history. That is
exactly how a backtest lies: the winner is partly fitted to the noise. The only
honest test is whether the chosen settings keep working on data they were never
tuned on. Split: fit on 2022-08 -> 2024-12, validate on 2025-01 -> 2026-09.
"""
import os as _os
ROOT = _os.environ.get("NQ_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import pandas as pd, numpy as np, pickle
from engine import Params, run, POINT_VALUE, simulate_account
from stats import summarize

DF = pd.read_pickle(ROOT + "/data/mnq_cont_1m.pkl")
SPLIT = pd.Timestamp("2025-01-01")
IS = DF[DF.session < SPLIT]
OOS = DF[DF.session >= SPLIT]

CANDIDATES = {
    "paper as written (POC target, 40pt stop)":
        dict(target_mode="freeze", stop_points=40.0, entry_session="rth"),
    "paper's own 'optimal' 2% stop":
        dict(target_mode="freeze", stop_mode="pct", stop_pct=0.02, entry_session="rth"),
    "best POC-target config found":
        dict(target_mode="freeze", stop_points=40.0, tape_threshold=1.2,
             entry_session="rth", profile_window="full"),
    "best R-multiple exit (8R / 20pt)":
        dict(target_mode="rmult", rr=8.0, stop_points=20.0, entry_session="rth"),
    "best R-multiple exit (5R / 20pt)":
        dict(target_mode="rmult", rr=5.0, stop_points=20.0, entry_session="rth"),
    "best trailing exit (20pt trail)":
        dict(target_mode="trail", trail_points=20.0, stop_points=30.0, entry_session="rth"),
}


def block(df, cfg, label):
    p = Params(**cfg)
    tr = run(df, p)
    if tr.empty:
        return None
    s = summarize(tr, p, label)
    s.pop("monthly")
    return s, tr


def main():
    rows = []
    for name, cfg in CANDIDATES.items():
        r_is = block(IS, cfg, name)
        r_oos = block(OOS, cfg, name)
        r_all = block(DF, cfg, name)
        if not (r_is and r_oos):
            continue
        rows.append(dict(
            config=name,
            is_n=r_is[0]["trades"], is_exp=r_is[0]["expectancy"], is_pf=r_is[0]["profit_factor"],
            is_net=r_is[0]["net"],
            oos_n=r_oos[0]["trades"], oos_exp=r_oos[0]["expectancy"], oos_pf=r_oos[0]["profit_factor"],
            oos_net=r_oos[0]["net"], oos_t=r_oos[0]["t_stat"],
            all_net=r_all[0]["net"], all_dd=r_all[0]["max_dd"],
        ))
    res = pd.DataFrame(rows)
    pd.set_option("display.width", 200)
    print("=" * 118)
    print("OUT-OF-SAMPLE VALIDATION   (fit 2022-08→2024-12  |  validate 2025-01→2026-09)")
    print("=" * 118)
    print(f"{'configuration':<42}{'IS exp':>9}{'IS PF':>7}{'IS net':>11}"
          f"{'OOS exp':>10}{'OOS PF':>8}{'OOS net':>11}{'OOS t':>7}")
    print("-" * 118)
    for _, r in res.iterrows():
        print(f"{r.config:<42}{r.is_exp:>9.2f}{r.is_pf:>7.2f}{r.is_net:>11,.0f}"
              f"{r.oos_exp:>10.2f}{r.oos_pf:>8.2f}{r.oos_net:>11,.0f}{r.oos_t:>7.2f}")
    res.to_csv(ROOT + "/results/oos.csv", index=False)
    return res


if __name__ == "__main__":
    main()
