"""
Deterministic 1-minute bar backtest engine for investigation (f).

Fill rules, as registered in PREREGISTRATION-APEX.md section 4:

  * Bars are stamped at their OPEN (Databento ohlcv-1m convention). A signal
    computed from bar i is known at the close of bar i, which is the open of
    bar i+1. Nothing a strategy uses may come from bar i+1 or later.
  * Market entry  -> open of bar i+1, plus adverse slippage.
  * Stop entry    -> first bar whose range reaches the stop; fill at the worse of
                     the stop and the bar's open, plus adverse slippage.
  * Limit entry   -> only when price TRADES THROUGH the limit by at least one
                     tick, on a bar with non-zero volume. A touch is not a fill:
                     OHLCV carries no queue position, so a touch fill cannot be
                     modelled realistically and is excluded (brief, Step 3).
                     Filled at the limit price, no improvement.
  * Two-sided stop bracket, both sides touched in one bar -> the side the bar
    closes AGAINST is assumed to have filled first (the whipsaw case).
  * Protective stop -> if the bar opens through it, fill at the open; otherwise
    at the stop. Adverse slippage on both.
  * Target (limit)  -> trade-through by one tick required; filled at the target.
  * Stop and target both reachable in one bar -> STOP. Always.
  * On the bar a stop or limit ENTRY fills, the stop is checked and the target
    is not (the order of prints inside that bar is unknown, and this is the
    pessimistic reading). Market entries fill at the open, so the whole bar is
    after the fill and both are checked, stop first.
  * Time exit       -> close of the named bar, plus adverse slippage.
  * Flatten         -> close of the bar that ends at FLAT_ET (16:55 ET), or the
                       last bar of the session, whichever comes first. Apex
                       requires flat by 16:59 ET.
  * Exits are resolved before any new entry: one position at a time, and an
    order whose signal bar falls inside an open trade is dropped.

Costs are applied per micro contract: points x $/pt - commission round turn.
Slippage models (points, per side):
  fixed:n    n ticks on every market/stop fill
  vol:n      n ticks + 1 tick per 20 ticks of the fill bar's range
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

TICK = 0.25          # NQ / MNQ
PT_MICRO = 2.0       # MNQ $/pt
FLAT_ET = 16 * 60 + 55


# ------------------------------------------------------------------ context
@dataclass
class Ctx:
    """Everything a signal may look at, as flat numpy arrays over 1-minute bars."""
    ts: np.ndarray
    o: np.ndarray
    h: np.ndarray
    l: np.ndarray
    c: np.ndarray
    v: np.ndarray
    mod: np.ndarray          # minute of day, ET, bar open
    sess: np.ndarray         # session index 0..S-1 per bar
    sess_dates: np.ndarray   # CME session date per session index
    s_start: np.ndarray      # first bar index per session
    s_end: np.ndarray        # last bar index per session (inclusive)
    flat_i: np.ndarray       # per session: bar index at whose close we must be flat
    D: np.ndarray            # per session: median full-session range of the PRIOR 20 sessions
    extra: dict = field(default_factory=dict)

    @property
    def n(self):
        return len(self.c)


def build_ctx(df: pd.DataFrame) -> Ctx:
    """`df` has columns ts, et, session, open, high, low, close, volume (sorted)."""
    df = df.sort_values("ts").reset_index(drop=True)
    et = pd.to_datetime(df["et"])
    mod = (et.dt.hour * 60 + et.dt.minute).to_numpy()
    sess_codes, sess_dates = pd.factorize(df["session"], sort=True)
    sess = sess_codes.astype(np.int64)
    S = len(sess_dates)
    idx = np.arange(len(df))
    s_start = np.full(S, -1)
    s_end = np.full(S, -1)
    first = np.r_[True, sess[1:] != sess[:-1]]
    last = np.r_[sess[1:] != sess[:-1], True]
    s_start[sess[first]] = idx[first]
    s_end[sess[last]] = idx[last]

    h = df.high.to_numpy(float)
    l = df.low.to_numpy(float)
    # flatten bar: the last bar opening at or before 16:54 ET, so it closes by
    # 16:55. Evening bars (>= 18:00) have larger minute-of-day and never qualify.
    flat_i = s_end.copy()
    for s in range(S):
        a, b = s_start[s], s_end[s]
        valid = np.nonzero(mod[a:b + 1] <= FLAT_ET - 1)[0]
        flat_i[s] = a + (valid[-1] if len(valid) else b - a)

    # D: median full-session high-low range over the previous 20 sessions
    rng_s = np.array([h[s_start[s]:s_end[s] + 1].max() - l[s_start[s]:s_end[s] + 1].min()
                      for s in range(S)])
    D = pd.Series(rng_s).shift(1).rolling(20, min_periods=10).median().to_numpy().copy()

    return Ctx(ts=df.ts.to_numpy(), o=df.open.to_numpy(float), h=h, l=l,
               c=df.close.to_numpy(float), v=df.volume.to_numpy(float), mod=mod,
               sess=sess, sess_dates=np.asarray(sess_dates), s_start=s_start,
               s_end=s_end, flat_i=flat_i, D=D)


# ------------------------------------------------------------------ orders
@dataclass
class Order:
    i: int                       # signal bar; known at the open of i+1
    side: int                    # +1 long, -1 short, 0 = two-sided stop bracket
    kind: str = "market"         # market | stop | limit | bracket
    price: float = np.nan        # stop/limit entry price (bracket: upper)
    price2: float = np.nan       # bracket: lower
    expire: int = -1             # last bar an entry order may fill (inclusive)
    stop: float = np.nan         # absolute protective stop (bracket: use stop_dist)
    target: float = np.nan       # absolute target
    stop_dist: float = np.nan    # points from fill, used when stop is nan
    target_dist: float = np.nan  # points from fill, used when target is nan
    target_R: float = np.nan     # target as a multiple of the realised risk |entry - stop|
    exit_i: int = -1             # time exit at close of this bar (-1: none)
    cross: bool = False          # signal bar may sit in the previous session (18:00 entries)
    tag: str = ""


def slip_array(ctx: Ctx, model: str) -> np.ndarray:
    kind, n = model.split(":")
    n = float(n)
    if kind == "fixed":
        return np.full(ctx.n, n * TICK)
    if kind == "vol":
        rng_ticks = (ctx.h - ctx.l) / TICK
        return (n + np.floor(rng_ticks / 20.0)) * TICK
    raise ValueError(model)


@dataclass
class CostModel:
    slip: str = "fixed:1"
    commission_rt: float = 1.04     # $ per micro round turn, Apex/Tradovate MNQ
    pt_value: float = PT_MICRO      # $ per point per contract (MNQ 2, MES 5)


def run(ctx: Ctx, orders: list, cost: CostModel = CostModel(), keep_path: bool = True,
        max_per_session: int = 10**9):
    """Execute `orders` in time order. Returns a trades DataFrame."""
    o, h, l, c, v = ctx.o, ctx.h, ctx.l, ctx.c, ctx.v
    slip = slip_array(ctx, cost.slip)
    orders = sorted(orders, key=lambda z: z.i)
    busy_until = -1
    rows = []
    per_sess = {}
    for od in orders:
        j0 = od.i + 1
        if j0 >= ctx.n or od.i < 0 and not od.cross or od.i <= busy_until:
            continue
        s = ctx.sess[j0]
        if od.i >= 0 and ctx.sess[od.i] != s and not od.cross:
            continue
        if per_sess.get(s, 0) >= max_per_session:
            continue
        flat = ctx.flat_i[s]
        if j0 > flat:
            continue
        # ---------------------------------------------------------- entry
        side = od.side
        fill_j = -1
        entry = np.nan
        if od.kind == "market":
            fill_j, side = j0, od.side
            entry = o[j0] + side * slip[j0]
        else:
            last = min(od.expire if od.expire >= 0 else flat, flat)
            if last < j0:
                continue
            seg = slice(j0, last + 1)
            if od.kind == "stop":
                hit = (h[seg] >= od.price) if side > 0 else (l[seg] <= od.price)
                k = _first(hit)
                if k < 0:
                    continue
                fill_j = j0 + k
                px = max(o[fill_j], od.price) if side > 0 else min(o[fill_j], od.price)
                entry = px + side * slip[fill_j]
            elif od.kind == "limit":
                thru = ((l[seg] <= od.price - TICK) if side > 0 else (h[seg] >= od.price + TICK)) & (v[seg] > 0)
                k = _first(thru)
                if k < 0:
                    continue
                fill_j = j0 + k
                entry = od.price
            elif od.kind == "bracket":
                up = h[seg] >= od.price
                dn = l[seg] <= od.price2
                ku, kd = _first(up), _first(dn)
                if ku < 0 and kd < 0:
                    continue
                if ku >= 0 and (kd < 0 or ku < kd):
                    side, k = 1, ku
                elif kd >= 0 and (ku < 0 or kd < ku):
                    side, k = -1, kd
                else:  # both in the same bar: the side the bar closes against filled first
                    k = ku
                    side = 1 if c[j0 + k] < o[j0 + k] else -1
                fill_j = j0 + k
                if side > 0:
                    px = max(o[fill_j], od.price)
                else:
                    px = min(o[fill_j], od.price2)
                entry = px + side * slip[fill_j]
            else:
                raise ValueError(od.kind)

        stop = od.stop if not np.isnan(od.stop) else entry - side * od.stop_dist
        if not np.isnan(od.target):
            target = od.target
        elif not np.isnan(od.target_dist):
            target = entry + side * od.target_dist
        elif not np.isnan(od.target_R):
            target = entry + side * od.target_R * abs(entry - stop)
        else:
            target = np.nan
        # a target already behind the fill is a signal that has expired: price did
        # the whole move before the order could be placed. No trade.
        if not np.isnan(target) and side * (target - entry) <= 0:
            continue
        if np.isnan(stop):
            raise ValueError("every trade needs a protective stop")
        # a stop on the wrong side of the fill (gap through it) exits immediately
        end = flat if od.exit_i < 0 else min(od.exit_i, flat)
        if end < fill_j:
            end = fill_j

        # --------------------------------------------------------- exit scan
        J = np.arange(fill_j, end + 1)
        hh, ll, oo = h[J], l[J], o[J]
        if side > 0:
            stop_hit = ll <= stop
            gap_stop = oo <= stop
            tgt_hit = hh >= target + TICK if not np.isnan(target) else np.zeros(len(J), bool)
            gap_tgt = oo >= target if not np.isnan(target) else np.zeros(len(J), bool)
        else:
            stop_hit = hh >= stop
            gap_stop = oo >= stop
            tgt_hit = ll <= target - TICK if not np.isnan(target) else np.zeros(len(J), bool)
            gap_tgt = oo <= target if not np.isnan(target) else np.zeros(len(J), bool)
        # on a non-market entry bar: the open preceded the fill, and the target is unchecked
        if od.kind != "market":
            gap_stop[0] = False
            gap_tgt[0] = False
            tgt_hit[0] = False
        ks = _first(stop_hit)
        kt = _first(tgt_hit | gap_tgt)
        if ks >= 0 and (kt < 0 or ks <= kt):
            k = ks
            px = oo[k] if gap_stop[k] else stop
            exit_px = px - side * slip[J[k]]
            reason = "stop"
        elif kt >= 0:
            k = kt
            exit_px = target  # a favourable gap is filled at the target, not the open
            reason = "target"
        else:
            k = len(J) - 1
            exit_px = c[J[k]] - side * slip[J[k]]
            reason = "time" if (od.exit_i >= 0 and J[k] == od.exit_i) else "flat"
        exit_j = J[k]
        pts = side * (exit_px - entry)
        PV = cost.pt_value
        net = pts * PV - cost.commission_rt

        path = None
        if keep_path:
            Jp = J[:k + 1]
            if side > 0:
                fav = (h[Jp] - entry) * PV
                adv = (l[Jp] - entry) * PV
            else:
                fav = (entry - l[Jp]) * PV
                adv = (entry - h[Jp]) * PV
            cl = side * (c[Jp] - entry) * PV
            # The exit bar. The simulator plays each row favourable-extreme first,
            # which is right for a bar the trade lives through, but not for the bar
            # it leaves on:
            #   stop    high first, then down to the stop: (high, net, net)
            #   target  the fill is AT the high, so any low came before it: split
            #           into (low, low, low) then (net, net, net)
            #   time    high, low, then the close: (max(high, net), min(low, net), net)
            if reason == "stop":
                adv[-1] = net
                cl[-1] = net
                path = np.column_stack([fav, adv, cl])
            elif reason == "target":
                a = min(adv[-1], net)
                path = np.column_stack([fav, adv, cl])
                path[-1] = (a, a, a)
                path = np.vstack([path, (net, net, net)])
            else:
                adv[-1] = min(adv[-1], net)
                fav[-1] = max(fav[-1], net)
                cl[-1] = net
                path = np.column_stack([fav, adv, cl])

        rows.append((ctx.sess_dates[s], ctx.ts[fill_j], ctx.ts[exit_j], side, entry,
                     exit_px, pts, net, reason, od.tag, path))
        busy_until = exit_j
        per_sess[s] = per_sess.get(s, 0) + 1
    cols = ["session", "entry_ts", "exit_ts", "side", "entry", "exit", "points",
            "net", "reason", "tag", "path"]
    return pd.DataFrame(rows, columns=cols)


def _first(mask) -> int:
    if len(mask) == 0:
        return -1
    k = int(np.argmax(mask))
    return k if mask[k] else -1


# ------------------------------------------------------------------ stats
def daily(tr: pd.DataFrame, sessions) -> pd.Series:
    """Net $ per micro per session, zeros on sessions without trades."""
    idx = pd.Index(pd.to_datetime(sessions), name="session")
    if tr.empty:
        return pd.Series(0.0, index=idx)
    d = tr.groupby(pd.to_datetime(tr.session)).net.sum()
    return d.reindex(idx, fill_value=0.0)


def metrics(tr: pd.DataFrame, sessions) -> dict:
    """The per-trial statistics the brief requires, on the daily P&L series."""
    d = daily(tr, sessions)
    n_days = len(d)
    out = dict(trades=len(tr), days=n_days, active_days=int((d != 0).sum()))
    if n_days < 2:
        return out
    mu = d.mean()
    sd = d.std(ddof=1)
    t = mu / (sd / np.sqrt(n_days)) if sd > 0 else np.nan
    eq = d.cumsum()
    dd = float((eq - eq.cummax()).min())
    total = d.sum()
    k = max(1, int(np.ceil(0.01 * n_days)))
    top = d.sort_values(ascending=False).head(k).sum()
    conc = top / total if total > 0 else np.nan
    wins = (tr.net > 0).mean() if len(tr) else np.nan
    # longest losing streak in trades
    streak = best = 0
    for x in tr.net.to_numpy():
        streak = streak + 1 if x <= 0 else 0
        best = max(best, streak)
    yearly = d.groupby(d.index.year).mean()
    out.update(
        win_rate=wins,
        mean_trade=tr.net.mean() if len(tr) else np.nan,
        mean_day=mu,
        sd_day=sd,
        t=t,
        sharpe_ann=(mu / sd * np.sqrt(252)) if sd > 0 else np.nan,
        max_dd=dd,
        top1pct_share=conc,
        net=total,
        max_losing_streak=best,
        pos_years=int((yearly > 0).sum()),
        n_years=int(len(yearly)),
    )
    return out
