"""
The best evaluation plan available WITHOUT a proven edge.

Six investigations found no edge that survives out-of-sample testing. But the
Apex account is an option: the downside is capped at the fees, and the rules
reward a particular variance shape. So the question this answers is not "what
predicts NQ" but:

    Given a trader with NO edge, which trade structure and size give the best
    odds of passing a $50K Intraday evaluation in 30 days, and of reaching a
    first payout, under Aram's confirmed Apex rules, net of real costs?

It also shows how fast those odds improve if the trader has some skill.

Method
  * One trade per RTH session: market entry at 09:31 ET, a fixed stop S points
    away, a target R x S away, otherwise flat at 15:55 ET. Executed by bt.py on
    real MNQ 1-minute bars, so the trailing drawdown sees the real intraday path
    including unrealised peaks. Costs: 1 tick slippage each side plus $1.04 per
    micro round turn.
  * Direction is a COIN FLIP: zero skill by construction. "Skill q" means that on
    a fraction q of days the trader picks the side that turned out better and on
    the rest flips a coin. q = 0.10 is a modest edge, q = 0.20 a strong one.
  * Design window 2024-02-01 -> 2025-12-31. The 2026 data stays untouched; it is
    the unspent holdout of investigation (f).
  * Grid: stop S in {15, 30, 60} points, R in {1, 2, 3}, risk per trade in
    {$250, $400, $550, $700}, funded-account size equal to or half the
    evaluation size, evaluation minimum days 0 or 7 (unconfirmed).

Because direction is random, choosing the best cell is choosing a variance
shape, not fitting an edge. The best cells are close to each other, and the
report shows the spread so no single cell is oversold.

    python3 src/eval_plan.py            # ~15 min on 4 cores
"""
from __future__ import annotations

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

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "results", "apex")
DESIGN = ("2024-02-01", "2025-12-31")
STOPS = [15.0, 30.0, 60.0]
RS = [1.0, 2.0, 3.0]
RISKS = [250.0, 400.0, 550.0, 700.0]
PA_SCALE = [1.0, 0.5]
MIN_DAYS = [0, 7]
SKILL = [0.0, 0.10, 0.20]
PA_HORIZON = 126            # sessions after passing (~6 months) to look for payouts
N_PATHS = 1500
COST = bt.CostModel(slip="fixed:1", commission_rt=AR.RULES["commission_rt_mnq_tradovate"].value)


# ----------------------------------------------------------------- trades
def compress(path: np.ndarray) -> np.ndarray:
    """Keep only the bars that can move the trailing threshold or breach it.

    A bar matters if its favourable extreme is a new high (raises the threshold),
    or its adverse extreme is a new low since the last new high (the only lows
    that can touch the raised threshold, or the daily loss limit). The last rows
    carry the exit and are always kept. Exact for apex_sim._play_day.
    """
    keep = []
    hi = -np.inf
    lo_since = np.inf
    n = len(path)
    for k in range(n):
        f, a = path[k, 0], path[k, 1]
        if f > hi:
            hi = f
            lo_since = a
            keep.append(k)
        elif a < lo_since:
            lo_since = a
            keep.append(k)
    tail = [k for k in (n - 2, n - 1) if k >= 0]
    idx = sorted(set(keep) | set(tail))
    return path[idx]


def day_trades(ctx: bt.Ctx, S: float, R: float):
    """Per session: (long_path, short_path, long_net, short_net), per micro."""
    entry_mod = 9 * 60 + 30            # signal bar 09:30, fills at the 09:31 open
    exit_mod = 15 * 60 + 54            # bar closing 15:55
    longs, shorts = [], []
    for s in range(len(ctx.sess_dates)):
        a, b = ctx.s_start[s], ctx.s_end[s]
        m = ctx.mod[a:b + 1]
        ie = np.nonzero(m == entry_mod)[0]
        ix = np.nonzero(m == exit_mod)[0]
        if not len(ie) or not len(ix):
            continue
        i, x = int(a + ie[0]), int(a + ix[0])
        for side, lst in ((1, longs), (-1, shorts)):
            lst.append(bt.Order(i=i, side=side, stop_dist=S, target_dist=R * S, exit_i=x))
    L = bt.run(ctx, longs, COST)
    Sh = bt.run(ctx, shorts, COST)
    L = L.set_index(pd.to_datetime(L.session))
    Sh = Sh.set_index(pd.to_datetime(Sh.session))
    common = L.index.intersection(Sh.index)
    out = []
    for d in common:
        out.append((compress(L.loc[d, "path"]), compress(Sh.loc[d, "path"]),
                    float(L.loc[d, "net"]), float(Sh.loc[d, "net"])))
    return out


ROUND_TRIP_COST = 2 * bt.TICK * bt.PT_MICRO + COST.commission_rt   # $ per micro: 2 ticks + commission


def neutralise(days):
    """Remove whatever average the 2024-25 sample happened to give this bracket.

    A coin-flip trader should earn exactly minus costs on average. With R > 1 the
    raw sample does not (trend days pay both directions' winners more than their
    losers cost), and that is an untested in-sample property, not something to
    plan on. Every path of this configuration is shifted by one constant so the
    coin-flip mean equals -ROUND_TRIP_COST. A uniform shift moves the adverse
    extremes too, which is conservative whenever the shift is negative.
    """
    m = np.mean([(ln + sn) / 2 for _, _, ln, sn in days])
    d = -ROUND_TRIP_COST - m
    return [(lp + d, sp + d, ln + d, sn + d) for lp, sp, ln, sn in days], m


def sampler_for(days, q: float):
    """Random days; direction a coin flip, except a fraction q of days picks the better side."""
    N = len(days)

    def sampler(rng):
        def it():
            while True:
                lp, sp, ln, sn = days[rng.integers(0, N)]
                if rng.random() < q:
                    yield [lp] if ln >= sn else [sp]
                else:
                    yield [lp] if rng.random() < 0.5 else [sp]
        return it()
    return sampler


# ------------------------------------------------------------------- cells
_DAYS = {}


def _init(days_by_key):
    global _DAYS
    _DAYS = days_by_key


def cell(args):
    S, R, risk, pa_scale, min_days, q, raw = args
    days = _DAYS[(S, R, raw)]
    micros = int(max(1, min(60, round(risk / (S * bt.PT_MICRO)))))
    pa_micros = int(max(1, round(micros * pa_scale)))
    cfg = AR.PRIMARY if min_days == 0 else AR.ALT_MIN_DAYS
    ctl = SIM.Controls(micros=micros, pa_micros=pa_micros)
    rng = np.random.default_rng(int(S * 7 + R * 13 + risk + pa_scale * 3 + min_days * 11 + q * 100))
    samp = sampler_for(days, q)
    res = [SIM.simulate_path(samp(rng), cfg, ctl, max_days=PA_HORIZON) for _ in range(N_PATHS)]
    passed = np.array([r["passed"] for r in res])
    paid = np.array([len(r["payouts"]) >= 1 for r in res])
    total = np.array([sum(r["payouts"]) for r in res])
    eval_days = [r["eval_days"] for r in res if r["passed"]]
    first = [r["first_payout_day"] for r in res if "first_payout_day" in r]
    fees = cfg.eval_fee + passed.mean() * cfg.activation_fee
    return dict(stop_pts=S, R=R, risk=risk, micros=micros, pa_micros=pa_micros,
                min_days=min_days, skill=q, raw_sample_mean=raw,
                p_pass=passed.mean(),
                median_days_to_pass=float(np.median(eval_days)) if eval_days else np.nan,
                p_payout_per_attempt=paid.mean(),
                p_payout_given_pass=paid[passed].mean() if passed.any() else np.nan,
                median_sessions_pass_to_payout=float(np.median(first)) if first else np.nan,
                mean_payout_per_attempt=total.mean(),
                net_per_attempt=total.mean() - fees,
                fee_per_attempt=fees)


def main():
    nq = pd.read_pickle(os.path.join(ROOT, "data", "mnq_cont_1m.pkl"))
    nq = nq[(nq.session >= DESIGN[0]) & (nq.session <= DESIGN[1])].reset_index(drop=True)
    ctx = bt.build_ctx(nq)
    days_by_key = {}
    for S, R in itertools.product(STOPS, RS):
        d = day_trades(ctx, S, R)
        days_by_key[(S, R, True)] = d
        days_by_key[(S, R, False)], m = neutralise(d)
        print(f"stop {S:>4.0f} R {R:.0f}: {len(d)} sessions, coin-flip sample mean "
              f"${m:+.2f}/micro/day, neutralised to ${-ROUND_TRIP_COST:+.2f}")
    jobs = list(itertools.product(STOPS, RS, RISKS, PA_SCALE, MIN_DAYS, SKILL, [False]))
    jobs += list(itertools.product(STOPS, RS, RISKS, PA_SCALE, [0], [0.0], [True]))
    with ProcessPoolExecutor(initializer=_init, initargs=(days_by_key,)) as ex:
        rows = list(ex.map(cell, jobs, chunksize=4))
    df = pd.DataFrame(rows)
    os.makedirs(OUT, exist_ok=True)
    df.to_csv(os.path.join(OUT, "eval_plan.csv"), index=False)
    report(df)


def report(df):
    pd.set_option("display.width", 250)
    cols = ["stop_pts", "R", "risk", "micros", "pa_micros", "p_pass", "median_days_to_pass",
            "p_payout_given_pass", "p_payout_per_attempt", "median_sessions_pass_to_payout",
            "net_per_attempt"]
    raw = df[df.raw_sample_mean].sort_values("p_payout_per_attempt", ascending=False)
    print("\n=== FOR COMPARISON ONLY: raw 2024-25 sample, not neutralised, min days 0, skill 0 ===")
    print(raw[cols].head(4).round(3).to_string(index=False))
    df = df[~df.raw_sample_mean]
    for md in MIN_DAYS:
        for q in SKILL:
            d = df[(df.min_days == md) & (df.skill == q)].sort_values("p_payout_per_attempt", ascending=False)
            print(f"\n=== eval minimum days {md}, skill {q:.0%}: top 6 by P(payout per attempt) ===")
            print(d[cols].head(6).round(3).to_string(index=False))


if __name__ == "__main__" and "--final" not in sys.argv:
    main()


# ------------------------------------------------------------- the chosen plan
PLAN = dict(stop_pts=60.0, R=1.0, micros=5, pa_micros=2)


def final(n=6000):
    """The chosen plan, more paths, both min-day readings, three skill levels, two cost levels."""
    nq = pd.read_pickle(os.path.join(ROOT, "data", "mnq_cont_1m.pkl"))
    nq = nq[(nq.session >= DESIGN[0]) & (nq.session <= DESIGN[1])].reset_index(drop=True)
    ctx = bt.build_ctx(nq)
    global COST
    rows = []
    for slip in ("fixed:1", "fixed:2"):
        COST = bt.CostModel(slip=slip, commission_rt=AR.RULES["commission_rt_mnq_tradovate"].value)
        days, _ = neutralise(day_trades(ctx, PLAN["stop_pts"], PLAN["R"]))
        if slip == "fixed:2":   # neutralise() targets 1-tick costs; charge the extra tick each side
            extra = 2 * bt.TICK * bt.PT_MICRO
            days = [(lp - extra, sp - extra, ln - extra, sn - extra) for lp, sp, ln, sn in days]
        for md, q in itertools.product(MIN_DAYS, SKILL):
            cfg = AR.PRIMARY if md == 0 else AR.ALT_MIN_DAYS
            ctl = SIM.Controls(micros=PLAN["micros"], pa_micros=PLAN["pa_micros"])
            rng = np.random.default_rng(1000 + md + int(q * 100) + (7 if slip == "fixed:2" else 0))
            samp = sampler_for(days, q)
            res = [SIM.simulate_path(samp(rng), cfg, ctl, max_days=PA_HORIZON) for _ in range(n)]
            passed = np.array([r["passed"] for r in res])
            paid = np.array([len(r["payouts"]) >= 1 for r in res])
            first_amt = [r["payouts"][0] for r in res if r["payouts"]]
            total = np.array([sum(r["payouts"]) for r in res])
            fees = cfg.eval_fee + passed.mean() * cfg.activation_fee
            p = paid.mean()
            rows.append(dict(
                slippage=slip, min_days=md, skill=q, p_pass_30d=passed.mean(),
                median_days_to_pass=float(np.median([r["eval_days"] for r in res if r["passed"]])),
                p_fail_drawdown=np.mean([r["eval_fail"] == "drawdown" for r in res if not r["passed"]]) * (1 - passed.mean()),
                p_payout_given_pass=paid[passed].mean(),
                p_payout_per_attempt=p,
                median_sessions_pass_to_1st=float(np.median([r["first_payout_day"] for r in res if "first_payout_day" in r])),
                median_first_payout=float(np.median(first_amt)) if first_amt else np.nan,
                attempts_per_payout=1 / p if p > 0 else np.inf,
                gbp_fees_per_payout=(18 + passed.mean() * 40) / p if p > 0 else np.inf,
                net_usd_per_attempt=total.mean() - fees))
    df = pd.DataFrame(rows)
    df.to_csv(os.path.join(OUT, "eval_plan_final.csv"), index=False)
    pd.set_option("display.width", 250)
    print(df.round(3).to_string(index=False))


if __name__ == "__main__" and "--final" in sys.argv:
    final()
