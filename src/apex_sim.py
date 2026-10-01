"""
Apex $50K Intraday lifecycle simulator: evaluation -> Performance Account -> payouts.

The question the brief poses is not "is the backtest profitable" but "what share
of £-fee attempts get paid, and how often do funded accounts die before the second
payout". This answers it for any stream of trading days.

A trading day is represented by its trades, and each trade by its intraday path in
$ per ONE micro contract: a sequence of (favourable, adverse, close) excursions per
bar, measured from the day's starting equity. That is what the rules need, because
the trailing threshold follows the PEAK UNREALIZED equity intraday
(`apex_rules.RULES['dd_uses_unrealized']`). A daily P&L number alone would
understate breaches: a trade that runs +$800 and then stops out for -$300 has
pulled the threshold up $800 before losing, which is a breach on a $2,000 trail
that the closing P&L never shows.

Within each bar the ordering is PESSIMISTIC: the favourable extreme is assumed to
print before the adverse one, which is the order that raises the threshold first
and then tests it.

Internal controls (the brief's Step 6: do not assume the maximum is optimal):
  micros       position size, in micro contracts
  int_dll      internal daily loss limit, $, stricter than the firm's
  day_cap      internal daily profit cap, $ — no new trades once reached

Paths
  simulate_path(day_iter, cfg, ctl)  -> dict of outcomes for one account
  run(day_sampler, cfg, ctl, n)      -> summary over n Monte Carlo accounts
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

import apex_rules as AR


@dataclass(frozen=True)
class Controls:
    micros: int = 5
    int_dll: float = float("inf")   # internal daily loss limit, $ (positive number)
    day_cap: float = float("inf")   # internal daily profit cap, $
    payout_all: bool = True         # withdraw everything above the safety net when eligible
    pa_micros: int = 0              # size in the funded account; 0 = same as the evaluation


# A day is a list of trades; a trade is an (n,3) float array of per-bar
# (fav, adv, close) P&L in $ per micro, RELATIVE TO THE TRADE'S ENTRY, and
# already net of costs in the final close value.
Day = list


def _play_day(day: Day, eq0: float, thr: float, lock: float, dd: float, m: int,
              dll: float, cap: float):
    """Play one day. Returns (end_equity, threshold, breached, day_pnl).

    The threshold trails the ALL-TIME peak, so it only ever rises: a new high
    lifts it to min(high - dd, lock), and nothing lowers it. (An earlier version
    tracked the peak from the day's open, which let the threshold fall after a
    losing day. Fixed 2026-10-01; see DEVIATIONS.md.)

    `dll` is the tighter of the firm's and the internal daily loss limit (inf if
    none). Hitting it flattens at the limit and ends the day without failing.
    Hitting `cap` means no new trades; an open trade is allowed to finish.
    Within a bar the favourable extreme prints first and the threshold is tested
    before the daily loss limit: both are the pessimistic order.
    """
    eq = eq0
    for tr in day:
        if eq - eq0 >= cap or eq - eq0 <= -dll:
            break
        base = eq
        for fav, adv, cl in tr:
            hi = base + fav * m
            lo = base + adv * m
            cand = min(hi - dd, lock)
            if cand > thr:
                thr = cand
            if lo <= thr:
                return thr, thr, True, thr - eq0
            if lo - eq0 <= -dll:
                return eq0 - dll, thr, False, -dll
        eq = base + tr[-1][2] * m
        cand = min(eq - dd, lock)
        if cand > thr:
            thr = cand
    return eq, thr, False, eq - eq0


def simulate_path(days, cfg: AR.ApexConfig, ctl: Controls, max_days: int = 750):
    """One account's life. `days` is an iterator of Day objects.

    Returns a dict: passed, eval_days, pa_breached, payouts (list of $), days_used.
    """
    m = ctl.micros
    # ------------------------------------------------------------ evaluation
    eq = cfg.start
    thr = cfg.start - cfg.dd
    out = dict(passed=False, eval_days=0, pa_breached=False, payouts=[],
               pa_days=0, breach_before_2nd=False, eval_fail="timeout")
    if m > cfg.eval_max_micros:
        out["eval_fail"] = "size_over_cap"
        return out
    traded = 0
    for d in range(cfg.eval_days):
        day = next(days, None)
        if day is None:
            return out
        eq, thr, br, pnl = _play_day(day, eq, thr, cfg.eval_lock, cfg.dd, m,
                                     ctl.int_dll, ctl.day_cap)
        out["eval_days"] = d + 1
        traded += bool(day)
        if br:
            out["eval_fail"] = "drawdown"
            return out
        if eq >= cfg.start + cfg.target and traded >= cfg.eval_min_days:
            out["passed"] = True
            break
    if not out["passed"]:
        return out

    # --------------------------------------------------- performance account
    if ctl.pa_micros:
        m = ctl.pa_micros
    if m > cfg.pa_max_micros:
        # Size is illegal in the PA at Level 1: trade the cap instead.
        m = cfg.pa_max_micros
    eq = cfg.start
    thr = cfg.start - cfg.dd
    dll = min(cfg.pa_dll, ctl.int_dll)
    q_days = 0
    since = []        # day P&Ls since the last payout
    for d in range(max_days):
        day = next(days, None)
        if day is None:
            return out
        eq, thr, br, pnl = _play_day(day, eq, thr, cfg.pa_lock, cfg.dd, m, dll, ctl.day_cap)
        out["pa_days"] = d + 1
        if br:
            out["pa_breached"] = True
            out["breach_before_2nd"] = len(out["payouts"]) < 2
            return out
        since.append(pnl)
        if pnl >= cfg.pa_q_profit:
            q_days += 1
        # payout request at the close, if eligible
        avail = eq - cfg.pa_safety_net
        if q_days >= cfg.pa_q_days and avail >= cfg.pa_min_payout:
            net = sum(since)
            best = max(since)
            if net > 0 and best / net < cfg.pa_consistency:
                amt = min(avail, cfg.pa_max_payout)
                out["payouts"].append(amt)
                out.setdefault("first_payout_day", d + 1)
                eq -= amt
                q_days = 0
                since = []
                if len(out["payouts"]) >= cfg.pa_max_payouts:
                    return out
    return out


def run(sampler, cfg: AR.ApexConfig, ctl: Controls, n: int = 2000, seed: int = 0):
    """Monte Carlo over `n` accounts. `sampler(rng)` returns an infinite day iterator."""
    rng = np.random.default_rng(seed)
    R = [simulate_path(sampler(rng), cfg, ctl) for _ in range(n)]
    passed = np.array([r["passed"] for r in R])
    n_pass = passed.sum()
    pay_counts = np.array([len(r["payouts"]) for r in R])
    pay_total = np.array([sum(r["payouts"]) for r in R])
    got2 = (pay_counts >= 2)
    s = dict(
        n=n,
        p_pass=passed.mean(),
        eval_fail_dd=np.mean([r["eval_fail"] == "drawdown" for r in R]),
        eval_fail_timeout=np.mean([(not r["passed"]) and r["eval_fail"] == "timeout" for r in R]),
        median_eval_days=float(np.median([r["eval_days"] for r in R if r["passed"]])) if n_pass else np.nan,
        p_breach_before_2nd_given_pass=(np.mean([r["breach_before_2nd"] for r in R if r["passed"]])
                                        if n_pass else np.nan),
        p_any_payout_given_pass=(np.mean(pay_counts[passed] >= 1) if n_pass else np.nan),
        p_2_payouts_given_pass=(np.mean(got2[passed]) if n_pass else np.nan),
        mean_payouts_given_pass=(pay_counts[passed].mean() if n_pass else 0.0),
        median_sessions_to_1st_payout=(float(np.median([r["first_payout_day"] for r in R
                                                         if "first_payout_day" in r]))
                                       if any("first_payout_day" in r for r in R) else np.nan),
        ev_payout_per_attempt=pay_total.mean(),     # $ withdrawn per evaluation bought
        breakeven_fee=pay_total.mean(),             # fee at which an attempt is EV-neutral
        breakeven_se=pay_total.std(ddof=1) / np.sqrt(n),
        # what an attempt is worth after the evaluation fee and, if passed, activation
        net_ev_per_attempt=pay_total.mean() - cfg.eval_fee - passed.mean() * cfg.activation_fee,
    )
    return s


# ----------------------------------------------------------------- samplers
def day_bootstrap(days: list, block: int = 5):
    """Stationary-ish block bootstrap over a list of historical Day objects.

    Whole days are resampled in blocks so short runs of good or bad days (volatility
    clustering) survive. Empty days (no trades) must be included in `days` — the
    frequency of doing nothing is part of the distribution.
    """
    N = len(days)
    if N == 0:
        raise ValueError("no days to bootstrap")

    def sampler(rng):
        def it():
            while True:
                s = rng.integers(0, N)
                for k in range(block):
                    yield days[(s + k) % N]
        return it()
    return sampler


def synthetic_days(mu: float, sigma: float, p_trade: float = 1.0, excursion: float = 0.5):
    """Data-free day generator for the edge map.

    One trade per active day, net P&L ~ N(mu, sigma) in $ per micro. Intraday, the
    trade first runs favourable by max(0, X) + |N(0, excursion*sigma)| and then adverse
    by min(0, X) - |N(0, excursion*sigma)| before closing at X — a crude but
    deliberately harsh path, because the threshold trails the favourable peak.
    """
    def sampler(rng):
        def it():
            while True:
                if rng.random() >= p_trade:
                    yield []
                    continue
                x = rng.normal(mu, sigma)
                fav = max(0.0, x) + abs(rng.normal(0, excursion * sigma))
                adv = min(0.0, x) - abs(rng.normal(0, excursion * sigma))
                yield [np.array([[fav, adv, x]])]
        return it()
    return sampler
