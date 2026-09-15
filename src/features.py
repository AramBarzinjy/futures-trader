"""Per-session feature table for the edge survey.

One row per RTH session, carrying everything the pre-registered hypotheses need:
prior-session levels, the overnight Globex range, the opening range, and the
intraday path used for forward returns.
"""
import os as _os
ROOT = _os.environ.get("NQ_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import numpy as np, pandas as pd
from engine import session_profile, Params

P = Params()


def build(path=ROOT + "/data/mnq_cont_1m.pkl"):
    df = pd.read_pickle(path)
    mins = df.et.dt.hour * 60 + df.et.dt.minute
    df = df.assign(mins=mins.to_numpy())
    rows, paths = [], {}
    prev = None

    for sess, g in df.groupby("session", sort=True):
        g = g.sort_values("ts")
        m = g.mins.to_numpy()
        rth = (m >= 570) & (m < 960)                 # 09:30 - 16:00 ET
        on = ~rth                                     # Globex outside RTH
        if rth.sum() < 120:          # genuinely broken session, not a half day
            prev = None
            continue

        r = g[rth]
        h, l, c, o, v = (r[x].to_numpy(float) for x in ("high", "low", "close", "open", "volume"))
        rm = r.mins.to_numpy()

        # profile of this session's RTH (becomes tomorrow's prior levels)
        poc, vah, val = session_profile(h, l, c, v, P.bin_points, P.value_area, P.va_method)

        rec = dict(
            session=sess, roll=bool(g.roll_day.iloc[0]),
            rth_open=o[0], rth_close=c[-1], rth_high=h.max(), rth_low=l.min(),
            poc=poc, vah=vah, val=val,
        )

        # overnight Globex window preceding this RTH (same session label, mins >= 1080 or < 570)
        onb = g[on]
        pre = onb[onb.mins < 570]
        if len(pre) > 60:
            rec["on_high"] = pre.high.max(); rec["on_low"] = pre.low.min()
        else:
            rec["on_high"] = rec["on_low"] = np.nan

        # opening range (first 30 and 60 minutes of RTH)
        for win, name in ((30, "or30"), (60, "or60")):
            sel = rm < 570 + win
            rec[f"{name}_high"] = h[sel].max(); rec[f"{name}_low"] = l[sel].min()
            rec[f"{name}_close"] = c[sel][-1]

        # 11:00 and lunch references
        def at(minute):
            idx = np.flatnonzero(rm >= minute)
            return c[idx[0]] if len(idx) else np.nan
        rec["c1100"] = at(660); rec["c1130"] = at(690); rec["c1330"] = at(810)

        # prior-session context
        if prev is not None and not rec["roll"]:
            rec.update({f"p_{k}": prev[k] for k in
                        ("rth_close", "rth_high", "rth_low", "poc", "vah", "val")})
        prev = rec

        paths[sess] = dict(mins=rm, high=h, low=l, close=c)
        rows.append(rec)

    F = pd.DataFrame(rows)
    # True range; where there is no prior close (first session, roll days) fall back
    # to the session's own range rather than emitting a NaN that would then wipe out
    # the following 14 rolling windows.
    rng = F.rth_high - F.rth_low
    gapped = np.maximum((F.rth_high - F.p_rth_close).abs(), (F.rth_low - F.p_rth_close).abs())
    F["tr"] = np.where(F.p_rth_close.isna(), rng, np.maximum(rng, gapped))
    F["atr"] = F.tr.rolling(14, min_periods=10).mean().shift(1)   # shift: past data only
    F["dow"] = pd.to_datetime(F.session).dt.dayofweek
    F["year"] = pd.to_datetime(F.session).dt.year
    return F, paths


if __name__ == "__main__":
    F, paths = build()
    import pickle
    F.to_pickle(ROOT + "/data/features.pkl")
    with open(ROOT + "/data/paths.pkl", "wb") as f:
        pickle.dump(paths, f)
    print(f"sessions: {len(F)}   with prior context: {F.p_rth_close.notna().sum()}")
    print(f"median ATR: {F.atr.median():.1f} pts   median RTH range: {(F.rth_high-F.rth_low).median():.1f} pts")
    print(F[["session", "rth_open", "rth_close", "on_high", "on_low", "or30_high", "atr"]].tail(3).to_string())
