"""
Investigation (f) runner: hybrid walk-forward, the screening gate, the holdout lock,
and the Apex lifecycle for anything that survives. Protocol: PREREGISTRATION-APEX.md.

    python3 src/wf.py                    # the registered run (needs data/nq_cont_1m.pkl ...)
    python3 src/wf.py --synthetic 3      # null calibration on edge-free synthetic data
    python3 src/wf.py --holdout          # ONCE, finalists only, after the run is final

Guards, each of which fails loudly rather than quietly:
  * the hypothesis grid must hash to the value written in the pre-registration;
  * sessions on or after HOLDOUT_START are removed at load time unless --holdout;
  * --holdout refuses to run without a finalists file, and refuses a second time;
  * every trial is appended to an append-only ledger (results/apex/ledger.jsonl)
    with its window, parameters, costs and metrics — including the dull ones;
  * validation-window metrics are computed ONLY for the variant each fold's
    development window selected. The other variants' validation numbers are
    never computed, so they cannot be looked at.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import re
import sys

import numpy as np
import pandas as pd
from scipy import stats as st

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import apex_rules as AR          # noqa: E402
import apex_sim as SIM           # noqa: E402
import bt                        # noqa: E402
import hypotheses_f as HF        # noqa: E402

ROOT = os.environ.get("NQ_ROOT", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# ------------------------------------------------------------ registered split
DATA_START = "2021-10-01"      # first session that can be traded (warm-up data precedes it)
HOLDOUT_START = "2025-10-01"   # everything from here on is the final holdout
FOLDS = [  # (dev_start, dev_end, val_start, val_end), inclusive session dates
    ("2021-10-01", "2023-09-30", "2023-10-01", "2024-03-31"),
    ("2022-04-01", "2024-03-31", "2024-04-01", "2024-09-30"),
    ("2022-10-01", "2024-09-30", "2024-10-01", "2025-03-31"),
    ("2023-04-01", "2025-03-31", "2025-04-01", "2025-09-30"),
]
MIN_DEV_TRADES = 30
BH_Q = 0.10
N_REGISTERED = len(HF.REGISTRY)   # BH denominator: untested hypotheses count as p = 1

BASE = bt.CostModel(slip="fixed:1", commission_rt=AR.RULES["commission_rt_mnq_tradovate"].value)
STRESS = bt.CostModel(slip="fixed:2", commission_rt=2 * BASE.commission_rt)
REPORT_COSTS = {"fixed:3": bt.CostModel("fixed:3", BASE.commission_rt),
                "fixed:4": bt.CostModel("fixed:4", BASE.commission_rt),
                "vol:1": bt.CostModel("vol:1", BASE.commission_rt)}
ES_COST = bt.CostModel(slip="fixed:1", commission_rt=AR.RULES["commission_rt_mnq_tradovate"].value,
                       pt_value=5.0)


def out_dir():
    return os.environ.get("APEX_OUT", os.path.join(ROOT, "results", "apex"))


# ------------------------------------------------------------------ guards
def check_registry():
    txt = open(os.path.join(ROOT, "PREREGISTRATION-APEX.md")).read()
    m = re.search(r"REGISTRY_SHA:\s*`?([0-9a-f]{16})", txt)
    if not m:
        raise SystemExit("PREREGISTRATION-APEX.md carries no REGISTRY_SHA")
    if m.group(1) != HF.registry_sha():
        raise SystemExit(f"Grid changed after registration: file {m.group(1)} != code {HF.registry_sha()}.\n"
                         "Any change is a deviation: record it in DEVIATIONS.md and re-register.")


class Ledger:
    def __init__(self, path):
        self.path = path
        os.makedirs(os.path.dirname(path), exist_ok=True)

    def add(self, **rec):
        rec["logged_at"] = _dt.datetime.utcnow().isoformat(timespec="seconds") + "Z"
        rec["registry_sha"] = HF.registry_sha()
        with open(self.path, "a") as f:
            f.write(json.dumps(rec, default=_json) + "\n")

    def records(self):
        if not os.path.exists(self.path):
            return []
        return [json.loads(x) for x in open(self.path)]


def _json(x):
    if isinstance(x, (np.integer,)):
        return int(x)
    if isinstance(x, (np.floating,)):
        return None if np.isnan(x) else float(x)
    if isinstance(x, (pd.Timestamp, np.datetime64)):
        return str(pd.Timestamp(x).date())
    return str(x)


# -------------------------------------------------------------------- data
def _read(key):
    p = os.path.join(ROOT, "data", f"{key}_cont_1m.pkl")
    if not os.path.exists(p):
        return None
    return pd.read_pickle(p)


def load(holdout=False):
    """Full-size NQ, ES and NQ aggressor delta. Holdout sessions removed unless unlocked."""
    nq = _read("nq")
    if nq is None:
        raise SystemExit("data/nq_cont_1m.pkl missing. Full-size NQ is required (signals use "
                         "full-size volume). Fetch it:\n"
                         "  python3 src/databento_fetch.py --start 2021-06-01 --end <latest> NQ ES\n"
                         "  python3 src/databento_fetch.py --delta --start 2021-06-01 --end <latest> NQ")
    es = _read("es")
    dp = os.path.join(ROOT, "data", "nq_delta_1m.pkl")
    delta = pd.read_pickle(dp) if os.path.exists(dp) else None
    return _assemble(nq, es, delta, holdout)


def _assemble(nq, es, delta, holdout):
    cut = pd.Timestamp(HOLDOUT_START)
    if not holdout:
        nq = nq[nq.session < cut]
        es = es[es.session < cut] if es is not None else None
    nq = nq.reset_index(drop=True)
    if delta is not None:
        d = delta.set_index("ts").delta
        nq["delta"] = d.reindex(nq.ts).to_numpy()
    return nq, es


def resample(df, minutes):
    if minutes == 1:
        return df
    g = df.copy()
    g["bucket"] = g.et.dt.floor(f"{minutes}min")
    agg = dict(ts="first", open="first", high="max", low="min", close="last", volume="sum")
    if "delta" in g:
        agg["delta"] = "sum"
    out = g.groupby(["session", "bucket"], sort=True).agg(agg).reset_index()
    out = out.rename(columns={"bucket": "et"})
    out["ts"] = out.et.dt.tz_convert("UTC")
    return out


def make_ctx(nq, es, minutes=1):
    nq_r = resample(nq, minutes)
    ctx = bt.build_ctx(nq_r)
    ctx.extra["bar_minutes"] = minutes
    if es is not None:
        es_r = resample(es, minutes)
        ctx.extra["es_c"] = es_r.set_index("ts").close.reindex(pd.DatetimeIndex(nq_r.ts)) \
            .ffill(limit=5).to_numpy(float)
    if "delta" in nq_r and nq_r["delta"].notna().mean() > 0.9:
        ctx.extra["delta"] = nq_r["delta"].fillna(0.0).to_numpy(float)
    return ctx


def available(h, ctx):
    need = HF.REGISTRY[h]["needs"]
    if "ES" in need and "es_c" not in ctx.extra:
        return False, "ES bars missing"
    if "NQ_delta" in need and "delta" not in ctx.extra:
        return False, "NQ aggressor delta (Databento trades schema) missing"
    return True, ""


def sessions_between(ctx, a, b):
    d = pd.to_datetime(ctx.sess_dates)
    return d[(d >= pd.Timestamp(a)) & (d <= pd.Timestamp(b))]


def window(tr, a, b):
    s = pd.to_datetime(tr.session)
    return tr[(s >= pd.Timestamp(a)) & (s <= pd.Timestamp(b))]


def key(p):
    return json.dumps(p, sort_keys=True)


# ---------------------------------------------------------------- the run
def trades_for(h, ctx, p, cost=None):
    return bt.run(ctx, HF.orders(h, ctx, p), cost or BASE,
                  max_per_session=HF.REGISTRY[h]["max_per_session"])


def walk_forward(h, ctx, ledger, mode):
    """Select on each fold's development window; record only the selected variant's
    validation window. Returns the selection and the stitched OOS trades."""
    V = HF.variants(h)
    full = {key(p): trades_for(h, ctx, p) for p in V}
    folds = []
    oos = []
    for k, (da, db, va, vb) in enumerate(FOLDS):
        dev_s = sessions_between(ctx, da, db)
        dev = {}
        for p in V:
            m = bt.metrics(window(full[key(p)], da, db), dev_s)
            dev[key(p)] = m
            ledger.add(mode=mode, kind="dev", hypothesis=h, fold=k + 1, window=[da, db],
                       params=p, cost="base", **_clean(m))
        elig = [p for p in V if dev[key(p)].get("trades", 0) >= MIN_DEV_TRADES
                and np.isfinite(dev[key(p)].get("t", np.nan))]
        if not elig:
            folds.append(dict(fold=k + 1, selected=None, dev_t=np.nan, neigh_pos=np.nan,
                              val=None))
            ledger.add(mode=mode, kind="select", hypothesis=h, fold=k + 1, selected=None,
                       reason=f"no variant with >= {MIN_DEV_TRADES} dev trades")
            val_s = sessions_between(ctx, va, vb)
            oos.append((pd.DataFrame(columns=full[key(V[0])].columns), val_s, None))
            continue
        best = max(elig, key=lambda p: dev[key(p)]["t"])
        nb = HF.neighbours(h, best)
        neigh_pos = np.mean([dev[key(q)].get("mean_day", -1) > 0 for q in nb]) if nb else np.nan
        ledger.add(mode=mode, kind="select", hypothesis=h, fold=k + 1, selected=best,
                   dev_t=dev[key(best)]["t"], dev_mean_day=dev[key(best)]["mean_day"],
                   neighbours_positive=neigh_pos, n_eligible=len(elig))
        val_s = sessions_between(ctx, va, vb)
        vt = window(full[key(best)], va, vb)
        vm = bt.metrics(vt, val_s)
        ledger.add(mode=mode, kind="val", hypothesis=h, fold=k + 1, window=[va, vb],
                   params=best, cost="base", **_clean(vm))
        folds.append(dict(fold=k + 1, selected=best, dev_t=dev[key(best)]["t"],
                          neigh_pos=neigh_pos, val=vm))
        oos.append((vt, val_s, best))
    return folds, oos


def _clean(m):
    return {k: v for k, v in m.items() if k not in ("monthly",)}


def stitched(oos):
    trs = [t for t, _, _ in oos if len(t)]
    tr = pd.concat(trs, ignore_index=True) if trs else pd.DataFrame(
        columns=["session", "net", "path"])
    sess = pd.DatetimeIndex(np.concatenate([np.asarray(s) for _, s, _ in oos]))
    return tr, sess


def rerun_oos(h, ctx, oos, cost=None):
    """The selected variants re-run under another cost model or context (5-minute, ES)."""
    parts = []
    for (tr, sess, p), (da, db, va, vb) in zip(oos, FOLDS):
        if p is None:
            parts.append((tr.iloc[0:0], sessions_between(ctx, va, vb), None))
            continue
        t = window(trades_for(h, ctx, p, cost), va, vb)
        parts.append((t, sessions_between(ctx, va, vb), p))
    return stitched(parts)


def gate(h, ctx, ctx5, ctx_es, folds, oos, ledger, mode):
    tr, sess = stitched(oos)
    m = bt.metrics(tr, sess)
    n = m.get("days", 0)
    t = m.get("t", np.nan)
    p1 = float(st.t.sf(t, n - 1)) if np.isfinite(t) else 1.0
    fold_pos = sum(1 for f in folds if f["val"] and f["val"].get("mean_day", 0) > 0)
    neigh = np.nanmean([f["neigh_pos"] for f in folds]) if folds else np.nan
    s_tr, s_sess = rerun_oos(h, ctx, oos, STRESS)
    ms = bt.metrics(s_tr, s_sess)
    extra = {}
    for name, c in REPORT_COSTS.items():
        a, b = rerun_oos(h, ctx, oos, c)
        extra[f"mean_day_{name}"] = bt.metrics(a, b).get("mean_day", np.nan)
    ok5, _ = available(h, ctx5)
    m5 = bt.metrics(*rerun_oos(h, ctx5, oos, None)) if ok5 else {}
    if ctx_es is not None and available(h, ctx_es)[0] and h != "H3_nq_es_rel":
        mes = bt.metrics(*rerun_oos(h, ctx_es, oos, ES_COST))
    else:
        mes = None
    row = dict(
        hypothesis=h, oos_days=n, oos_trades=m.get("trades", 0),
        mean_day=m.get("mean_day", np.nan), t=t, p_one_sided=p1,
        sharpe_ann=m.get("sharpe_ann", np.nan), max_dd=m.get("max_dd", np.nan),
        top1pct_share=m.get("top1pct_share", np.nan), win_rate=m.get("win_rate", np.nan),
        max_losing_streak=m.get("max_losing_streak", np.nan),
        folds_positive=fold_pos, neighbours_positive=neigh,
        stress_mean_day=ms.get("mean_day", np.nan), **extra,
        tf5_mean_day=m5.get("mean_day", np.nan), es_mean_day=(mes or {}).get("mean_day", np.nan),
        selected=[f["selected"] for f in folds],
    )
    row["G1_mean_pos"] = row["mean_day"] > 0
    row["G2_t_gt_2"] = bool(np.isfinite(t) and t > 2.0)
    row["G3_concentration"] = bool(np.isfinite(row["top1pct_share"]) and row["top1pct_share"] < 0.5)
    row["G4_folds"] = fold_pos >= 3
    row["G5_stress"] = bool(row["stress_mean_day"] > 0)
    row["G6_neighbours"] = bool(np.isfinite(neigh) and neigh >= 0.5)
    row["G7_timeframe"] = bool(row["tf5_mean_day"] > 0)
    row["G8_market"] = (bool(row["es_mean_day"] > 0) if mes is not None else None)
    ledger.add(mode=mode, kind="gate", **{k: v for k, v in row.items()})
    return row, tr, sess


def bh(pvals, q=BH_Q, m=N_REGISTERED):
    """Benjamini-Hochberg with m = number REGISTERED (untested count as p=1)."""
    p = np.asarray(pvals, float)
    order = np.argsort(p)
    passed = np.zeros(len(p), bool)
    k_max = 0
    for rank, i in enumerate(order, 1):
        if p[i] <= q * rank / m:
            k_max = rank
    passed[order[:k_max]] = True
    return passed


# ------------------------------------------------------------ lifecycle
CONTROLS = [SIM.Controls(micros=mi, int_dll=dl, day_cap=cp)
            for mi in (1, 2, 3, 5, 8, 10, 15, 20, 30, 40)
            for dl in (float("inf"), 400.0, 800.0)
            for cp in (float("inf"), 600.0, 1200.0)]


def to_days(tr, sess, demean=False):
    """Trades -> list of Day objects over every session (empty days included)."""
    by = {}
    mu = tr.net.mean() if (demean and len(tr)) else 0.0
    for d, path in zip(pd.to_datetime(tr.session), tr.path):
        p = path.copy()
        if demean:
            p = p - mu
        by.setdefault(d, []).append(p)
    return [by.get(d, []) for d in pd.to_datetime(sess)]


def lifecycle(tr, sess, n=1000, seed=0, cfg=AR.PRIMARY):
    days = to_days(tr, sess)
    null = to_days(tr, sess, demean=True)
    rows = []
    for ctl in CONTROLS:
        s = SIM.run(SIM.day_bootstrap(days), cfg, ctl, n=n, seed=seed)
        z = SIM.run(SIM.day_bootstrap(null), cfg, ctl, n=n, seed=seed)
        rows.append(dict(micros=ctl.micros, int_dll=ctl.int_dll, day_cap=ctl.day_cap,
                         **{k: s[k] for k in ("p_pass", "median_eval_days",
                                              "p_breach_before_2nd_given_pass",
                                              "p_2_payouts_given_pass", "breakeven_fee")},
                         null_breakeven_fee=z["breakeven_fee"],
                         uplift=s["breakeven_fee"] - z["breakeven_fee"],
                         uplift_se=float(np.hypot(s["breakeven_se"], z["breakeven_se"]))))
    L = pd.DataFrame(rows)
    L["G9"] = L.uplift > 2 * L.uplift_se
    return L


# ------------------------------------------------------------------- main
def run_all(nq, es, mode, ledger, out):
    ctx = make_ctx(nq, es, 1)
    ctx5 = make_ctx(nq, es, 5)
    ctx_es = None
    if es is not None:
        ctx_es = bt.build_ctx(es)
        ctx_es.extra["bar_minutes"] = 1
    rows = []
    oos_store = {}
    for h in HF.REGISTRY:
        ok, why = available(h, ctx)
        if not ok:
            ledger.add(mode=mode, kind="skip", hypothesis=h, reason=why)
            rows.append(dict(hypothesis=h, skipped=why, p_one_sided=1.0))
            print(f"{h:<22} SKIPPED: {why}")
            continue
        folds, oos = walk_forward(h, ctx, ledger, mode)
        row, tr, sess = gate(h, ctx, ctx5, ctx_es, folds, oos, ledger, mode)
        oos_store[h] = (tr, sess)
        rows.append(row)
        print(f"{h:<22} OOS n={row['oos_trades']:>5}  mean/day=${row['mean_day']:>7.2f}  "
              f"t={row['t']:>5.2f}  top1%={row['top1pct_share'] if np.isfinite(row['top1pct_share']) else float('nan'):>5.2f}  "
              f"folds+={row['folds_positive']}/4")
    G = pd.DataFrame(rows)
    G["BH"] = bh(G.p_one_sided.fillna(1.0).to_numpy())
    gates = ["G1_mean_pos", "G2_t_gt_2", "G3_concentration", "G4_folds", "G5_stress",
             "G6_neighbours", "G7_timeframe"]
    for g in gates:
        if g not in G:
            G[g] = False
    G["finalist"] = G.BH & G[gates].fillna(False).all(axis=1) & \
        G.get("G8_market", pd.Series([None] * len(G))).map(lambda x: x is not False)
    os.makedirs(out, exist_ok=True)
    G.to_csv(os.path.join(out, f"gate_{mode}.csv"), index=False)
    # lifecycle for every hypothesis with OOS trades, finalist or not; G9 decides finalists
    controls = {}
    G["G9_uplift"] = False
    for h, (tr, sess) in oos_store.items():
        if len(tr) == 0:
            continue
        L = lifecycle(tr, sess, n=400 if mode != "registered" else 1000)
        L.to_csv(os.path.join(out, f"lifecycle_{mode}_{h}.csv"), index=False)
        best = L.sort_values("uplift", ascending=False).iloc[0]
        G.loc[G.hypothesis == h, "G9_uplift"] = bool(best.G9)
        G.loc[G.hypothesis == h, "best_uplift"] = best.uplift
        controls[h] = dict(micros=int(best.micros), int_dll=best.int_dll, day_cap=best.day_cap)
    G["finalist"] = G.finalist & G.G9_uplift
    G.to_csv(os.path.join(out, f"gate_{mode}.csv"), index=False)
    fin = G[G.finalist].hypothesis.tolist()
    ledger.add(mode=mode, kind="run_complete", finalists=fin,
               bh_passed=G[G.BH].hypothesis.tolist())
    print(f"\nBH survivors: {G[G.BH].hypothesis.tolist()}   finalists: {fin}")
    if mode == "registered":
        with open(os.path.join(out, "finalists.json"), "w") as f:
            json.dump(dict(finalists=fin,
                           selected={h: G.set_index('hypothesis').loc[h, 'selected'] for h in fin},
                           controls={h: controls[h] for h in fin}), f, indent=1, default=_json)
    return G


def holdout(ledger, out):
    fp = os.path.join(out, "finalists.json")
    if not os.path.exists(fp):
        raise SystemExit("No finalists.json: the registered run has not produced finalists.")
    if any(r.get("kind") == "holdout" for r in ledger.records()):
        raise SystemExit("The holdout has already been run. It is spent. (PREREGISTRATION-APEX.md 3)")
    F = json.load(open(fp))
    if not F["finalists"]:
        raise SystemExit("No finalists. Nothing is allowed to touch the holdout.")
    nq, es = load(holdout=True)
    ctx = make_ctx(nq, es, 1)
    hs = pd.Timestamp(HOLDOUT_START)
    sess = pd.to_datetime(ctx.sess_dates)
    sess = sess[sess >= hs]
    for h in F["finalists"]:
        p = F["selected"][h][-1]          # the most recent fold's selection, frozen
        tr = trades_for(h, ctx, p)
        tr = tr[pd.to_datetime(tr.session) >= hs]
        m = bt.metrics(tr, sess)
        ledger.add(mode="registered", kind="holdout", hypothesis=h, params=p, **_clean(m))
        print(h, json.dumps(_clean(m), default=_json, indent=1))
        L = lifecycle(tr, sess)
        L.to_csv(os.path.join(out, f"lifecycle_holdout_{h}.csv"), index=False)
        c = F["controls"][h]
        row = L[(L.micros == c["micros"]) & (L.int_dll == c["int_dll"]) & (L.day_cap == c["day_cap"])]
        verdict = (m.get("mean_day", 0) > 0 and m.get("t", 0) > 1.5
                   and m.get("top1pct_share", 1) < 0.5 and bool(row.G9.iloc[0]))
        ledger.add(mode="registered", kind="holdout_verdict", hypothesis=h, passed=verdict,
                   controls=c, **{k: row.iloc[0][k] for k in ("p_pass", "uplift", "uplift_se")})
        print(f"{h}: holdout {'PASSED' if verdict else 'FAILED'} at frozen controls {c}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--synthetic", type=int, default=0, help="null calibration: N edge-free datasets")
    ap.add_argument("--seed0", type=int, default=0, help="first synthetic seed")
    ap.add_argument("--costfree", action="store_true",
                    help="synthetic only: zero costs, to isolate selection bias from cost drag")
    ap.add_argument("--holdout", action="store_true")
    a = ap.parse_args()
    check_registry()
    if a.synthetic:
        import synth
        global BASE
        if a.costfree:
            BASE = bt.CostModel(slip="fixed:0", commission_rt=0.0)
        out = os.path.join(out_dir(), "null_calibration",
                           f"{'costfree' if a.costfree else 'costs'}_seed{a.seed0}")
        ledger = Ledger(os.path.join(out, "ledger.jsonl"))
        allg = []
        for seed in range(a.seed0, a.seed0 + a.synthetic):
            print(f"\n=== synthetic dataset {seed} (no edge by construction) ===")
            n_sess = len(pd.bdate_range("2021-06-01", HOLDOUT_START))
            nq = synth.make("2021-06-01", n_sess, seed=100 + seed, with_delta=True)
            es = synth.make_es(nq, seed=200 + seed)
            nq = nq[nq.session < pd.Timestamp(HOLDOUT_START)].reset_index(drop=True)
            es = es[es.session < pd.Timestamp(HOLDOUT_START)].reset_index(drop=True)
            G = run_all(nq, es, f"synthetic{seed}", ledger, out)
            G["seed"] = seed
            allg.append(G)
        pd.concat(allg).to_csv(os.path.join(out, "null_gates.csv"), index=False)
        return
    out = out_dir()
    ledger = Ledger(os.path.join(out, "ledger.jsonl"))
    if a.holdout:
        holdout(ledger, out)
        return
    nq, es = load(holdout=False)
    run_all(nq, es, "registered", ledger, out)


if __name__ == "__main__":
    main()
