"""
Synthetic CME-session 1-minute bars with NO edge, for tests and the null calibration.

Each session runs 18:00 ET to 16:59 ET the next day (1,380 bars), Sunday through
Thursday evenings, like Globex. Prices are a driftless random walk with a U-shaped
intraday volatility and volume profile and an 08:30 volatility spike, so every
hypothesis has something to fire on — and nothing to profit from. Running the full
pipeline on this data measures how often the protocol passes a strategy that has
no edge by construction.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

NY = "America/New_York"


def sessions(start: str, n: int):
    """CME session dates (the day the session ENDS), weekdays only."""
    d = pd.bdate_range(start, periods=n)
    return d


def make(start="2021-06-01", n=300, seed=0, px0=15000.0, vol_pts=1.2, es_beta=None,
         with_delta=False):
    rng = np.random.default_rng(seed)
    days = sessions(start, n)
    minutes = np.arange(1380)                     # 0 = 18:00 ET
    mod = (18 * 60 + minutes) % 1440
    # intraday vol shape: quiet overnight, loud at the RTH open/close and 08:30
    shape = np.full(1380, 0.5)
    rth = (mod >= 570) & (mod < 960)
    shape[rth] = 1.0
    shape[(mod >= 570) & (mod < 600)] = 2.0
    shape[(mod >= 930) & (mod < 960)] = 1.5
    shape[mod == 510] = 4.0
    vol_shape = shape * 200
    frames = []
    px = px0
    for d in days:
        start_et = (pd.Timestamp(d) - pd.Timedelta(days=1)).tz_localize(NY) + pd.Timedelta(hours=18)
        et = start_et + pd.to_timedelta(minutes, unit="min")
        sh = shape.copy()
        if rng.random() < 0.15:                     # a news day: big 08:30 bar
            sh[mod == 510] *= rng.uniform(2, 5)
        r = rng.standard_normal(1380) * vol_pts * sh
        c = px + np.cumsum(r)
        o = np.r_[px, c[:-1]]
        wig = np.abs(rng.standard_normal((2, 1380))) * vol_pts * sh * 0.6
        h = np.maximum(o, c) + wig[0]
        l = np.minimum(o, c) - wig[1]
        v = np.maximum(0, rng.poisson(vol_shape)).astype(float)
        spike = rng.random(1380) < 0.004            # rare volume shocks, direction-free
        v[spike] *= rng.uniform(5, 12, spike.sum())
        f = pd.DataFrame(dict(et=et, open=o, high=h, low=l, close=c, volume=v))
        f["session"] = pd.Timestamp(d)
        if with_delta:
            f["delta"] = np.round(v * np.clip(rng.normal(0, 0.2, 1380), -1, 1))
        frames.append(f)
        px = c[-1] + rng.normal(0, vol_pts * 3)   # overnight gap
    df = pd.concat(frames, ignore_index=True)
    # round to the tick
    for k in ("open", "high", "low", "close"):
        df[k] = np.round(df[k] * 4) / 4
    df["high"] = df[["open", "high", "close"]].max(axis=1)
    df["low"] = df[["open", "low", "close"]].min(axis=1)
    df["ts"] = df.et.dt.tz_convert("UTC")
    df["symbol"] = "SYN"
    df["roll_day"] = False
    return df


def make_es(nq: pd.DataFrame, beta=0.8, noise=0.6, seed=1):
    """An ES series correlated with `nq`: ES returns = beta x NQ returns / 4 + noise."""
    rng = np.random.default_rng(seed)
    r = np.r_[0.0, np.diff(nq.close.to_numpy())] / 4.0
    esr = beta * r + rng.standard_normal(len(r)) * noise * np.abs(r).mean()
    c = 4500 + np.cumsum(esr)
    o = np.r_[4500, c[:-1]]
    w = np.abs(rng.standard_normal((2, len(c)))) * np.abs(esr).mean()
    es = nq[["ts", "et", "session", "volume", "symbol", "roll_day"]].copy()
    es["open"], es["close"] = o, c
    es["high"] = np.maximum(o, c) + w[0]
    es["low"] = np.minimum(o, c) - w[1]
    for k in ("open", "high", "low", "close"):
        es[k] = np.round(es[k] * 4) / 4
    es["high"] = es[["open", "high", "close"]].max(axis=1)
    es["low"] = es[["open", "low", "close"]].min(axis=1)
    return es
