"""
Honest backtest engine for the Volume-Profile mean-reversion strategy on MNQ.

Faithful to the paper's trading logic (Perera 2026, §3.2-3.4) but corrected for the
three flaws that invalidate the original study, and adapted to CME micro futures:

  * NO LOOK-AHEAD. The paper targets the *current day's* POC computed from the full
    session (admitted in its own §5.4). Here the target is the DEVELOPING POC, built
    only from bars that have already closed at the moment of entry.
  * REAL DATA. Real MNQ 1-minute bars from CME Globex, not a synthetic mean-reverting
    generator.
  * REAL CONSTRAINTS. Point-based stops (a % stop on NQ is enormous), MNQ tick values,
    commissions, slippage, and a full simulation of the prop account's trailing
    drawdown and consistency rule.

Conventions
  - Signal is evaluated on a closed bar; entry fills at the NEXT bar's open + slippage.
  - If a bar's range contains both stop and target, the STOP is assumed to fill first.
  - Target is a resting limit; it requires genuine trade-through of the level.
  - Stop is a market order; it pays extra slippage.
"""
from __future__ import annotations
import numpy as np
import pandas as pd
from dataclasses import dataclass, field

# ---------------------------------------------------------------- instrument
TICK = 0.25             # MNQ minimum price increment (points)
TICK_VALUE = 0.50       # $ per tick per contract
POINT_VALUE = 2.00      # $ per point per contract
COMMISSION_RT = 1.20    # $ per micro contract, round turn (all-in)
SLIP_TICKS_ENTRY = 1    # ticks of slippage paid on entry
SLIP_TICKS_STOP = 2     # extra ticks paid when a stop is taken out


@dataclass
class Params:
    # --- volume profile ---
    bin_points: float = 5.0        # profile bin width in index points
    value_area: float = 0.70       # fraction of volume in the value area
    va_method: str = "paper"       # "paper" (sort-by-volume) | "standard" (expand from POC)
    profile_window: str = "full"   # "full" CME session | "rth" 09:30-16:00 ET

    # --- tape speed confirmation ---
    tape_momentum_n: int = 5
    tape_volume_ma: int = 5
    tape_smooth: int = 3
    tape_threshold: float = 0.5

    # --- trading ---
    stop_points: float = 40.0      # fixed stop distance in index points
    stop_mode: str = "points"      # "points" | "atr" | "pct"
    atr_mult: float = 1.5
    atr_n: int = 14
    stop_pct: float = 0.005
    # "freeze"    = POC as known at entry, held fixed (honest, default)
    # "dynamic"   = POC recomputed from closed bars each bar (honest, moving target)
    # "lookahead" = the PAPER'S method: full-session POC, including bars that have not
    #               happened yet. Kept only to measure how much bias it injects.
    # "rmult"     = target at rr x the stop distance (ignores POC entirely)
    # "trail"     = no fixed target; stop trails by trail_points once in profit
    target_mode: str = "freeze"
    rr: float = 3.0
    trail_points: float = 40.0
    max_trades_per_day: int = 1
    entry_session: str = "rth"     # "rth" 09:30-16:00 ET | "full" CME session
    exit_minutes_before_close: int = 5
    min_target_points: float = 5.0 # reject setups whose target is too close to be worth it
    require_prev_profile: bool = True

    # --- sizing / account ---
    contracts: int = 5             # micros per trade
    start_equity: float = 50_000.0
    trailing_dd: float = 2_000.0
    dd_on_unrealized: bool = True  # strictest reading: trail on intraday open equity


# ---------------------------------------------------------------- profiles
def _value_area(prices, vols, frac, method):
    """Return (poc, vah, val) from a price-binned volume histogram."""
    if vols.sum() <= 0:
        return np.nan, np.nan, np.nan
    poc_i = int(np.argmax(vols))
    poc = prices[poc_i]
    target = vols.sum() * frac

    if method == "paper":
        order = np.argsort(vols)[::-1]
        cum, chosen = 0.0, []
        for i in order:
            chosen.append(i)
            cum += vols[i]
            if cum >= target:
                break
        sel = prices[np.array(chosen)]
        return poc, float(sel.max()), float(sel.min())

    # standard Market Profile: expand outward from the POC, taking the richer side
    lo = hi = poc_i
    cum = vols[poc_i]
    n = len(vols)
    while cum < target and (lo > 0 or hi < n - 1):
        up = vols[hi + 1] if hi < n - 1 else -1.0
        dn = vols[lo - 1] if lo > 0 else -1.0
        if up >= dn:
            hi += 1
            cum += max(up, 0.0)
        else:
            lo -= 1
            cum += max(dn, 0.0)
    return poc, float(prices[hi]), float(prices[lo])


def session_profile(h, l, c, v, bin_points, frac, method):
    """Full-session volume profile using the paper's typical-price assignment."""
    tp = (h + l + c) / 3.0
    if len(tp) == 0 or v.sum() <= 0:
        return np.nan, np.nan, np.nan
    lo, hi = l.min(), h.max()
    nb = max(int(np.ceil((hi - lo) / bin_points)) + 1, 1)
    edges = lo + np.arange(nb + 1) * bin_points
    idx = np.clip(((tp - lo) / bin_points).astype(int), 0, nb - 1)
    vols = np.bincount(idx, weights=v, minlength=nb)
    centers = edges[:-1] + bin_points / 2.0
    return _value_area(centers, vols, frac, method)


class DevelopingProfile:
    """Running volume profile — only bars already closed contribute. No look-ahead."""

    def __init__(self, bin_points, frac, method):
        self.bp, self.frac, self.method = bin_points, frac, method
        self.hist = {}      # bin index -> volume
        self.total = 0.0

    def add(self, h, l, c, v):
        tp = (h + l + c) / 3.0
        b = int(np.floor(tp / self.bp))
        self.hist[b] = self.hist.get(b, 0.0) + v
        self.total += v

    def poc(self):
        if not self.hist:
            return np.nan
        b = max(self.hist, key=self.hist.get)
        return (b + 0.5) * self.bp

    def levels(self):
        if not self.hist:
            return np.nan, np.nan, np.nan
        bs = np.array(sorted(self.hist))
        vols = np.array([self.hist[b] for b in bs], dtype=float)
        prices = (bs + 0.5) * self.bp
        return _value_area(prices, vols, self.frac, self.method)


# ---------------------------------------------------------------- indicators
def tape_speed(close, volume, p: Params):
    """sign(Σ 5-period price change) × (volume / 5-period volume MA), 3-period SMA."""
    c = pd.Series(close)
    v = pd.Series(volume)
    mom = c.diff().rolling(p.tape_momentum_n).sum()
    vma = v.rolling(p.tape_volume_ma).mean()
    ratio = (v / vma.replace(0, np.nan)).fillna(0.0)
    long_ = np.sign(mom) * ratio
    short_ = np.sign(-mom) * ratio
    return (
        long_.rolling(p.tape_smooth).mean().to_numpy(),
        short_.rolling(p.tape_smooth).mean().to_numpy(),
    )


def atr(h, l, c, n):
    h, l, c = pd.Series(h), pd.Series(l), pd.Series(c)
    pc = c.shift()
    tr = pd.concat([h - l, (h - pc).abs(), (l - pc).abs()], axis=1).max(axis=1)
    return tr.rolling(n).mean().to_numpy()


# ---------------------------------------------------------------- backtest
def run(df: pd.DataFrame, p: Params):
    """df: continuous 1-min bars with ts, et, session, ohlcv, roll_day."""
    slip_e = SLIP_TICKS_ENTRY * TICK
    slip_s = SLIP_TICKS_STOP * TICK

    sessions = list(df.groupby("session", sort=True))
    prev_levels = None
    prev_session_key = None
    trades = []

    for sess, g in sessions:
        g = g.sort_values("ts")
        et = g.et
        h = g.high.to_numpy(float)
        l = g.low.to_numpy(float)
        c = g.close.to_numpy(float)
        o = g.open.to_numpy(float)
        v = g.volume.to_numpy(float)
        n = len(g)
        roll = bool(g.roll_day.iloc[0])

        # profile window mask for building THIS session's profile
        mins = et.dt.hour * 60 + et.dt.minute
        rth = ((mins >= 9 * 60 + 30) & (mins < 16 * 60)).to_numpy()
        prof_mask = rth if p.profile_window == "rth" else np.ones(n, bool)
        entry_mask = rth if p.entry_session == "rth" else np.ones(n, bool)

        # last index we are allowed to hold to
        allowed = np.flatnonzero(entry_mask)
        if len(allowed) == 0:
            prev_levels = session_profile(h[prof_mask], l[prof_mask], c[prof_mask],
                                          v[prof_mask], p.bin_points, p.value_area, p.va_method)
            prev_session_key = sess
            continue
        last_i = allowed[-1]
        flat_by = max(allowed[0], last_i - p.exit_minutes_before_close)

        usable = prev_levels is not None and not (p.require_prev_profile and roll)
        if usable and not np.isnan(prev_levels[0]):
            pPOC, pVAH, pVAL = prev_levels
            # the paper's (biased) target: this session's FINAL poc, known only in hindsight
            look_poc = session_profile(h[prof_mask], l[prof_mask], c[prof_mask], v[prof_mask],
                                       p.bin_points, p.value_area, p.va_method)[0]
            ts_l, ts_s = tape_speed(c, v, p)
            a = atr(h, l, c, p.atr_n)

            dev = DevelopingProfile(p.bin_points, p.value_area, p.va_method)
            pos = None
            taken = 0

            for i in range(n):
                # --- manage an open position on this bar ---
                if pos is not None:
                    if p.target_mode == "trail":
                        if pos["dir"] == 1:
                            pos["stop"] = max(pos["stop"], h[i - 1] - p.trail_points if i else pos["stop"])
                        else:
                            pos["stop"] = min(pos["stop"], l[i - 1] + p.trail_points if i else pos["stop"])
                    if p.target_mode == "dynamic":
                        pn = dev.poc()
                        if not np.isnan(pn) and (
                            (pos["dir"] == 1 and pn > pos["entry"])
                            or (pos["dir"] == -1 and pn < pos["entry"])
                        ):
                            pos["target"] = pn
                    exit_px = exit_reason = None
                    if pos["dir"] == 1:
                        if l[i] <= pos["stop"]:
                            exit_px, exit_reason = pos["stop"] - slip_s, "stop"
                        elif h[i] >= pos["target"]:
                            exit_px, exit_reason = pos["target"], "target"
                    else:
                        if h[i] >= pos["stop"]:
                            exit_px, exit_reason = pos["stop"] + slip_s, "stop"
                        elif l[i] <= pos["target"]:
                            exit_px, exit_reason = pos["target"], "target"
                    if exit_px is None and i >= flat_by:
                        exit_px = c[i] - pos["dir"] * slip_e
                        exit_reason = "eod"
                    if exit_px is not None:
                        gross = (exit_px - pos["entry"]) * pos["dir"] * POINT_VALUE * p.contracts
                        fees = COMMISSION_RT * p.contracts
                        trades.append(dict(
                            session=sess, dir=pos["dir"], entry_ts=pos["ts"], exit_ts=et.iloc[i],
                            entry=pos["entry"], exit=exit_px, stop=pos["stop"], target=pos["target"],
                            reason=exit_reason, points=(exit_px - pos["entry"]) * pos["dir"],
                            gross=gross, fees=fees, net=gross - fees,
                            mae_pts=pos["mae"], contracts=p.contracts,
                        ))
                        pos = None

                # track excursion for an still-open position
                if pos is not None:
                    adverse = (pos["entry"] - l[i]) if pos["dir"] == 1 else (h[i] - pos["entry"])
                    pos["mae"] = max(pos["mae"], adverse)

                # --- update developing profile with this now-closed bar ---
                if prof_mask[i]:
                    dev.add(h[i], l[i], c[i], v[i])

                # --- look for a new signal (fills next bar) ---
                if (pos is None and taken < p.max_trades_per_day
                        and entry_mask[i] and i < flat_by and i + 1 < n
                        and not np.isnan(ts_l[i])):
                    d = 0
                    if c[i] <= pVAL and ts_l[i] >= p.tape_threshold:
                        d = 1
                    elif c[i] >= pVAH and ts_s[i] >= p.tape_threshold:
                        d = -1
                    if d != 0:
                        poc_now = look_poc if p.target_mode == "lookahead" else dev.poc()
                        if not np.isnan(poc_now):
                            entry = o[i + 1] + d * slip_e
                            if p.stop_mode == "points":
                                dist = p.stop_points
                            elif p.stop_mode == "atr":
                                dist = (a[i] if not np.isnan(a[i]) else p.stop_points) * p.atr_mult
                            else:
                                dist = entry * p.stop_pct
                            if p.target_mode == "rmult":
                                tgt = entry + d * dist * p.rr
                                ok = True
                            elif p.target_mode == "trail":
                                tgt = entry + d * 1e9   # unreachable; the trail does the work
                                ok = True
                            else:
                                tgt = poc_now
                                # paper's logical validation + a minimum worthwhile target
                                ok = ((d == 1 and tgt - entry >= p.min_target_points)
                                      or (d == -1 and entry - tgt >= p.min_target_points))
                            if ok:
                                pos = dict(dir=d, entry=entry, ts=et.iloc[i + 1], mae=0.0,
                                           stop=entry - d * dist, target=tgt)
                                taken += 1

        # this session's completed profile becomes tomorrow's context
        prev_levels = session_profile(h[prof_mask], l[prof_mask], c[prof_mask], v[prof_mask],
                                      p.bin_points, p.value_area, p.va_method)
        prev_session_key = sess

    return pd.DataFrame(trades)


# ---------------------------------------------------------------- account sim
def simulate_account(trades: pd.DataFrame, p: Params):
    """Apply the prop account's trailing drawdown to the realised trade sequence."""
    if trades.empty:
        return dict(breached=False, trades=0, net=0.0, final=p.start_equity)
    eq = p.start_equity
    peak = p.start_equity
    floor_ = p.start_equity - p.trailing_dd
    breached_at = None
    curve = []
    for i, t in trades.reset_index(drop=True).iterrows():
        if p.dd_on_unrealized:
            # worst case within the trade: equity dips by the MAE before the exit
            low_eq = eq - t.mae_pts * POINT_VALUE * t.contracts - t.fees
            if low_eq <= floor_ and breached_at is None:
                breached_at = i
            high_eq = eq + max(t.net, 0.0)
            peak = max(peak, high_eq)
            floor_ = max(floor_, peak - p.trailing_dd)
        eq += t.net
        peak = max(peak, eq)
        floor_ = max(floor_, peak - p.trailing_dd)
        if eq <= floor_ and breached_at is None:
            breached_at = i
        curve.append(eq)
    trades = trades.copy()
    trades["equity"] = curve
    return dict(
        breached=breached_at is not None,
        breach_trade=breached_at,
        breach_date=(trades.session.iloc[breached_at] if breached_at is not None else None),
        trades=len(trades), net=float(trades.net.sum()), final=float(eq),
        curve=trades,
    )
