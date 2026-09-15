"""Parameter sweep. Tests whether ANY configuration of the paper's strategy has a
real edge on MNQ, and quantifies how much of the paper's result was look-ahead bias."""
import os as _os
ROOT = _os.environ.get("NQ_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import itertools, pickle, sys, time
from concurrent.futures import ProcessPoolExecutor
import pandas as pd, numpy as np
from engine import Params, run
from stats import summarize

DF = None


def _init():
    global DF
    DF = pd.read_pickle(ROOT + "/data/mnq_cont_1m.pkl")


def _one(cfg):
    p = Params(**cfg)
    tr = run(DF, p)
    s = summarize(tr, p, label=str(cfg))
    s.pop("monthly", None)
    s["cfg"] = cfg
    return s, tr


def sweep(grid, tag, workers=8):
    keys = list(grid)
    combos = [dict(zip(keys, v)) for v in itertools.product(*grid.values())]
    print(f"[{tag}] {len(combos)} configs", flush=True)
    t = time.time()
    out = []
    with ProcessPoolExecutor(max_workers=workers, initializer=_init) as ex:
        for i, (s, tr) in enumerate(ex.map(_one, combos), 1):
            out.append((s, tr))
            if i % 20 == 0:
                print(f"  {i}/{len(combos)}  {time.time()-t:.0f}s", flush=True)
    res = pd.DataFrame([s for s, _ in out])
    with open(fROOT + "/results/{tag}.pkl", "wb") as f:
        pickle.dump(out, f)
    res.to_csv(fROOT + "/results/{tag}.csv", index=False)
    print(f"[{tag}] done in {time.time()-t:.0f}s")
    return res


if __name__ == "__main__":
    import os
    os.makedirs(ROOT + "/results", exist_ok=True)
    which = sys.argv[1] if len(sys.argv) > 1 else "main"

    if which == "main":
        grid = dict(
            stop_points=[15.0, 25.0, 40.0, 60.0, 100.0, 150.0, 250.0],
            tape_threshold=[0.0, 0.3, 0.5, 0.8, 1.2],
            entry_session=["rth", "full"],
            profile_window=["rth", "full"],
        )
        r = sweep(grid, "main")
    elif which == "bias":
        grid = dict(
            target_mode=["freeze", "dynamic", "lookahead"],
            stop_points=[25.0, 40.0, 60.0, 100.0, 150.0],
            entry_session=["rth", "full"],
        )
        r = sweep(grid, "bias")
    elif which == "structure":
        grid = dict(
            va_method=["paper", "standard"],
            bin_points=[1.0, 5.0, 10.0, 25.0],
            stop_points=[40.0, 100.0, 150.0],
            max_trades_per_day=[1, 3],
        )
        r = sweep(grid, "structure")

    cols = ["trades", "win_rate", "expectancy", "t_stat", "profit_factor", "net",
            "max_dd", "avg_month", "breached"]
    print(r.sort_values("expectancy", ascending=False)[["label"] + cols].head(15).to_string())

def exits():
    import os; os.makedirs(ROOT + "/results", exist_ok=True)
    g1 = dict(target_mode=["rmult"], rr=[2.0,3.0,5.0,8.0],
              stop_points=[20.0,30.0,50.0,80.0], entry_session=["rth","full"])
    g2 = dict(target_mode=["trail"], trail_points=[20.0,40.0,80.0],
              stop_points=[30.0,50.0,80.0], entry_session=["rth","full"])
    return sweep(g1,"exit_rmult"), sweep(g2,"exit_trail")
