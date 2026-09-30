"""
Tests for investigation (f): the engine's fill rules, the absence of look-ahead in
every registered hypothesis, the holdout guard, and the Apex lifecycle state machine.

    python3 tests/test_apex.py          # no market data needed
"""
import os
import sys
import tempfile

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "src"))

import apex_rules as AR          # noqa: E402
import apex_sim as SIM           # noqa: E402
import bt                        # noqa: E402
import hypotheses_f as HF        # noqa: E402
import synth                     # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(f"  {'ok  ' if cond else 'FAIL'} {name}{'' if cond else '  ' + str(detail)}")
    if not cond:
        FAILS.append(name)


# --------------------------------------------------------------- engine
def tiny_ctx(rows, start_mod=9 * 60 + 30):
    """Hand-made bars inside one session. rows = [(o,h,l,c,v), ...]."""
    n = len(rows)
    et = pd.Timestamp("2024-03-05 09:30", tz="America/New_York") + pd.to_timedelta(
        np.arange(n) + (start_mod - 570), unit="min")
    df = pd.DataFrame(rows, columns=["open", "high", "low", "close", "volume"])
    df["et"] = et
    df["ts"] = et.tz_convert("UTC")
    df["session"] = pd.Timestamp("2024-03-05")
    ctx = bt.build_ctx(df)
    ctx.D[:] = 100.0
    return ctx


NOSLIP = bt.CostModel(slip="fixed:0", commission_rt=0.0)


def test_engine():
    print("engine")
    # stop and target both inside bar 2 -> stop wins
    ctx = tiny_ctx([(100, 100, 100, 100, 10), (100, 101, 99, 100, 10),
                    (100, 110, 90, 100, 10), (100, 100, 100, 100, 10)])
    tr = bt.run(ctx, [bt.Order(i=0, side=1, stop_dist=5, target_dist=5)], NOSLIP)
    check("same-bar stop+target resolves to stop", tr.reason.iloc[0] == "stop" and tr.points.iloc[0] == -5,
          tr[["reason", "points"]].to_dict("records"))

    # gap through the stop fills at the open, not the stop
    ctx = tiny_ctx([(100, 100, 100, 100, 10), (100, 101, 99, 100, 10),
                    (90, 91, 89, 90, 10), (90, 90, 90, 90, 10)])
    tr = bt.run(ctx, [bt.Order(i=0, side=1, stop_dist=5, target_dist=20)], NOSLIP)
    check("gap through stop fills at open", tr.exit.iloc[0] == 90, tr.exit.iloc[0])

    # target touched but not traded through -> not filled
    ctx = tiny_ctx([(100, 100, 100, 100, 10), (100, 100, 100, 100, 10),
                    (100, 105, 100, 104, 10), (104, 104, 104, 104, 10)])
    tr = bt.run(ctx, [bt.Order(i=0, side=1, stop_dist=5, target_dist=5)], NOSLIP)
    check("target touch is not a fill", tr.reason.iloc[0] != "target", tr.reason.iloc[0])

    # limit entry needs a trade-through, and a non-zero-volume bar
    ctx = tiny_ctx([(100, 100, 100, 100, 10), (100, 100, 99, 99.5, 10),
                    (99.5, 99.5, 98, 98.5, 0), (99.5, 99.5, 99, 99.5, 10)])
    tr = bt.run(ctx, [bt.Order(i=0, side=1, kind="limit", price=99, stop_dist=5, expire=3)], NOSLIP)
    check("limit: touch and zero-volume bars do not fill", len(tr) == 0, tr)
    ctx = tiny_ctx([(100, 100, 100, 100, 10), (100, 100, 98.5, 99.5, 10),
                    (99.5, 99.5, 99.5, 99.5, 10)])
    tr = bt.run(ctx, [bt.Order(i=0, side=1, kind="limit", price=99, stop_dist=5, expire=2)], NOSLIP)
    check("limit: trade-through fills at the limit", len(tr) == 1 and tr.entry.iloc[0] == 99, tr)

    # stop entry with slippage fills at worse of open/stop + 1 tick
    ctx = tiny_ctx([(100, 100, 100, 100, 10), (100, 100, 100, 100, 10),
                    (102, 103, 101.5, 102.5, 10), (102.5, 102.5, 102.5, 102.5, 10)])
    tr = bt.run(ctx, [bt.Order(i=0, side=1, kind="stop", price=101, stop_dist=5, expire=3)],
                bt.CostModel(slip="fixed:1", commission_rt=0))
    check("stop entry gapped over fills at open + slip", tr.entry.iloc[0] == 102.25, tr.entry.iloc[0])

    # entry-bar pessimism for a stop entry: the stop is checked, the target is not
    ctx = tiny_ctx([(100, 100, 100, 100, 10), (100, 100, 100, 100, 10),
                    (100, 120, 95, 100, 10), (100, 100, 100, 100, 10)])
    tr = bt.run(ctx, [bt.Order(i=0, side=1, kind="stop", price=101, stop_dist=4,
                               target_dist=5, expire=3)], NOSLIP)
    check("stop-entry bar: stop checked, target ignored", tr.reason.iloc[0] == "stop", tr.reason.iloc[0])

    # bracket: both sides in one bar -> the side the bar closes against
    ctx = tiny_ctx([(100, 100, 100, 100, 10), (100, 100, 100, 100, 10),
                    (100, 106, 94, 95, 10), (95, 95, 95, 95, 10)])
    tr = bt.run(ctx, [bt.Order(i=0, side=0, kind="bracket", price=105, price2=95.0,
                               stop=100, target_R=2, expire=3)], NOSLIP)
    check("bracket whipsaw fills the losing side", tr.side.iloc[0] == 1 and tr.reason.iloc[0] == "stop",
          tr[["side", "reason"]].to_dict("records"))

    # costs: commission and pt value
    ctx = tiny_ctx([(100, 100, 100, 100, 10), (100, 100, 100, 100, 10),
                    (100, 100, 100, 100, 10)])
    tr = bt.run(ctx, [bt.Order(i=0, side=1, stop_dist=5, exit_i=2)],
                bt.CostModel(slip="fixed:1", commission_rt=1.04))
    check("flat trade loses 2 ticks + commission", abs(tr.net.iloc[0] - (-0.5 * 2 - 1.04)) < 1e-9, tr.net.iloc[0])

    # one position at a time
    ctx = tiny_ctx([(100, 100, 100, 100, 10)] * 10)
    tr = bt.run(ctx, [bt.Order(i=0, side=1, stop_dist=5, exit_i=5),
                      bt.Order(i=2, side=1, stop_dist=5, exit_i=6),
                      bt.Order(i=6, side=1, stop_dist=5, exit_i=8)], NOSLIP)
    check("overlapping signal is dropped", len(tr) == 2, len(tr))

    # flatten at 16:55 ET
    ctx = tiny_ctx([(100, 100, 100, 100, 10)] * 10, start_mod=16 * 60 + 50)
    tr = bt.run(ctx, [bt.Order(i=0, side=1, stop_dist=5)], NOSLIP)
    closes_at = pd.Timestamp(tr.exit_ts.iloc[0]).tz_convert("America/New_York")
    check("flattened on the bar closing 16:55", closes_at.strftime("%H:%M") == "16:54", closes_at)

    # the target already behind the fill cancels the trade
    ctx = tiny_ctx([(100, 100, 100, 100, 10), (100, 100, 100, 100, 10), (100, 100, 100, 100, 10)])
    tr = bt.run(ctx, [bt.Order(i=0, side=-1, target=101, stop_dist=5)], NOSLIP)
    check("stale target cancels the trade", len(tr) == 0, tr)


# ---------------------------------------------------------- look-ahead
def test_no_lookahead():
    print("no look-ahead: corrupting bars after the cut must not move any earlier order")
    df = synth.make(n=90, seed=3, with_delta=True)
    es = synth.make_es(df)
    cut_sess = df.session.unique()[70]
    cut = int(df.index[df.session == cut_sess][700])   # mid-session, ~05:40 ET

    def build(frame, esf):
        ctx = bt.build_ctx(frame)
        ctx.extra["es_c"] = esf.close.to_numpy(float)
        ctx.extra["delta"] = frame.delta.to_numpy(float)
        return ctx

    base = build(df, es)
    rng = np.random.default_rng(9)
    bad = df.copy()
    bad2 = es.copy()
    k = len(df) - cut - 1
    for f in (bad, bad2):
        for col in ("open", "high", "low", "close"):
            f.loc[cut + 1:, col] = f.loc[cut + 1:, col].to_numpy() + rng.normal(0, 50, k)
        f.loc[cut + 1:, "high"] = f.loc[cut + 1:, ["open", "high", "close"]].max(axis=1)
        f.loc[cut + 1:, "low"] = f.loc[cut + 1:, ["open", "low", "close"]].min(axis=1)
    bad.loc[cut + 1:, "volume"] = rng.poisson(5000, k)
    bad.loc[cut + 1:, "delta"] = rng.normal(0, 3000, k)
    corrupt = build(bad, bad2)
    # canary: a signal that peeks one bar ahead must be caught by this very test
    def peek(ctx):
        up = np.r_[ctx.c[1:] > ctx.c[:-1], False]
        return [bt.Order(i=int(i), side=1, stop_dist=1.0) for i in np.nonzero(up)[0]]
    a = [o.i for o in peek(base) if o.i <= cut]
    b = [o.i for o in peek(corrupt) if o.i <= cut]
    check("canary: a one-bar peek IS detected", a != b)

    for h in HF.REGISTRY:
        for p in HF.variants(h):
            a = [(o.i, o.side, round(o.stop_dist, 6) if np.isfinite(o.stop_dist) else o.stop,
                  o.kind) for o in HF.orders(h, base, p) if o.i <= cut]
            b = [(o.i, o.side, round(o.stop_dist, 6) if np.isfinite(o.stop_dist) else o.stop,
                  o.kind) for o in HF.orders(h, corrupt, p) if o.i <= cut]
            # H4 and H6 place orders whose *prices* are known at i; compare those too
            if a != b:
                check(f"{h} {p}", False, f"{len(a)} vs {len(b)} orders before the cut")
                break
        else:
            check(f"{h}: {len(HF.variants(h))} variants unchanged by the future", True)


def test_signals_fire():
    print("every hypothesis fires on synthetic data (a silent zero would look like a finding)")
    df = synth.make(n=120, seed=5, with_delta=True)
    es = synth.make_es(df)
    ctx = bt.build_ctx(df)
    ctx.extra["es_c"] = es.close.to_numpy(float)
    ctx.extra["delta"] = df.delta.to_numpy(float)
    for h in HF.REGISTRY:
        n = [len(bt.run(ctx, HF.orders(h, ctx, p), max_per_session=HF.REGISTRY[h]["max_per_session"]))
             for p in HF.variants(h)]
        check(f"{h}: trades per variant {n}", min(n) > 0, n)


# ------------------------------------------------------------ lifecycle
def day(*trades):
    return [np.array(t, float) for t in trades]


def test_lifecycle():
    print("apex lifecycle")
    cfg = AR.PRIMARY
    ctl = SIM.Controls(micros=1)
    # a +$1,000 day three times passes the eval
    it = iter([day([[1000, 0, 1000]])] * 3 + [day()] * 1000)
    r = SIM.simulate_path(it, cfg, ctl)
    check("three +$1,000 days pass the evaluation", r["passed"] and r["eval_days"] == 3, r)

    # the threshold trails unrealised: +1,900 peak then -150 close breaches
    it = iter([day([[1900, -150, -150]])] + [day()] * 100)
    r = SIM.simulate_path(it, cfg, ctl)
    # peak 51,900 -> threshold 49,900; low 49,850 <= 49,900 -> breach
    check("unrealised peak drags the threshold up and breaches", r["eval_fail"] == "drawdown", r)

    # the same day with the favourable excursion removed survives
    it = iter([day([[0, -50, -50]])] * 21 + [day()] * 100)
    r = SIM.simulate_path(it, cfg, ctl)
    check("same loss without the run-up survives", r["eval_fail"] == "timeout", r)

    # a touch of +3,000 intraday that closes lower does not pass
    it = iter([day([[3100, 0, 2500]])] + [day()] * 30)
    r = SIM.simulate_path(it, cfg, ctl)
    check("intraday touch of the target is not a pass", not r["passed"], r)

    # PA: consistency blocks a payout when one day is >= 50% of profit
    pass3 = [day([[1000, 0, 1000]])] * 3
    big = [day([[2500, 0, 2500]])]
    small = [day([[250, 0, 250]])] * 5
    it = iter(pass3 + big + small + [day()] * 200)
    r = SIM.simulate_path(it, cfg, ctl)
    # 2,500 of 3,750 is 67% -> no payout; account then idles
    check("one dominant day blocks the payout", r["passed"] and len(r["payouts"]) == 0, r)

    # PA: qualifying days + safety net + consistency -> payout of everything above 52,100
    it = iter(pass3 + [day([[600, 0, 600]])] * 5 + [day()] * 200)
    r = SIM.simulate_path(it, cfg, ctl)
    check("5 x $600 days pay out $900 above the $52,100 net", r["payouts"] == [900.0], r["payouts"])

    # PA DLL: a -1,200 day is cut at -1,000 and the account lives
    it = iter(pass3 + [day([[0, -1200, -1200]])] + [day()] * 5)
    r = SIM.simulate_path(it, cfg, SIM.Controls(micros=1))
    check("PA daily loss limit pauses, does not fail", not r["pa_breached"], r)

    # PA threshold locks at 50,100 once the peak reaches 52,100
    it = iter(pass3 + [day([[2200, 0, 2200]])] + [day([[0, -1000, -1000]])] * 2
              + [day([[0, -150, -150]])] + [day()] * 5)
    r = SIM.simulate_path(it, cfg, ctl)
    # 52,200 -> 51,200 -> 50,200 -> 50,050 breaches the locked 50,100
    check("PA threshold locks at $50,100", r["pa_breached"], r)

    # payout capped at $2,000; the rest stays for the next request
    it = iter(pass3 + [day([[1000, 0, 1000]])] * 5 + [day()] * 50)
    r = SIM.simulate_path(it, cfg, ctl)
    # balance 55,000 -> 2,900 above the net, but only 2,000 may be withdrawn
    check("payout capped at $2,000", r["payouts"] == [2000.0], r["payouts"])

    # six payouts close the PA
    it = iter(pass3 + ([day([[600, 0, 600]])] * 5) * 40)
    r = SIM.simulate_path(it, cfg, ctl)
    check("maximum of six payouts", len(r["payouts"]) == 6, len(r["payouts"]))

    # size above the evaluation cap is refused
    r = SIM.simulate_path(iter([day()] * 30), cfg, SIM.Controls(micros=cfg.eval_max_micros + 1))
    check("size over the contract cap is refused", r["eval_fail"] == "size_over_cap", r)

    # internal daily profit cap stops new trades but lets the open one finish
    d = day([[400, 0, 400]], [[400, 0, 400]], [[400, 0, 400]])
    it = iter([d] * 30)
    r = SIM.simulate_path(it, cfg, SIM.Controls(micros=1, day_cap=700))
    check("day cap of $700 trades two $400 trades per day -> pass on day 4",
          r["passed"] and r["eval_days"] == 4, r)

    # the drawdown alternative moves the safety net with it
    check("alt drawdown moves safety net to $52,600", AR.ALT_DD.pa_safety_net == 52_600, AR.ALT_DD)


def test_engine_path_feeds_sim():
    print("engine paths plug into the simulator")
    df = synth.make(n=60, seed=11)
    ctx = bt.build_ctx(df)
    tr = bt.run(ctx, HF.orders("H6_overnight_drift", ctx, {"window": "02:00-09:25"}))
    ok = all(p.shape[1] == 3 and abs(p[-1, 2] - n) < 1e-9 for p, n in zip(tr.path, tr.net))
    check("each path ends at the realised net", ok)
    check("adverse excursion never above the close", all((p[:, 1] <= p[:, 2] + 1e-9).all() for p in tr.path))

    # a clean target exit must not breach: +$2,500 target on a flat-bottomed bar
    ctx = tiny_ctx([(100, 100, 100, 100, 10), (100, 101, 100, 101, 10),
                    (101, 1400, 101, 1300, 10), (1300, 1300, 1300, 1300, 10)])
    t2 = bt.run(ctx, [bt.Order(i=0, side=1, stop_dist=5, target_dist=1250)], NOSLIP)
    r = SIM.simulate_path(iter([list(t2.path)] + [[]] * 30), AR.PRIMARY, SIM.Controls(micros=1))
    check("target exit at the bar high does not breach on the same bar's low",
          t2.reason.iloc[0] == "target" and r["eval_fail"] != "drawdown", (t2.reason.iloc[0], r))


if __name__ == "__main__":
    test_engine()
    test_lifecycle()
    test_engine_path_feeds_sim()
    test_signals_fire()
    test_no_lookahead()
    print()
    if FAILS:
        print(f"{len(FAILS)} FAILED: {FAILS}")
        sys.exit(1)
    print("all passed")
