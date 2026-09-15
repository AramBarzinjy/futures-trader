"""
Pre-registered intraday edge survey for NQ. See PREREGISTRATION.md.

Every hypothesis produces at most one trade per session, so each observation is its
own cluster and the ordinary t-test is already session-clustered. Results are
reported on the DISCOVERY set only; the holdout is evaluated separately, once,
for candidates that pass the decision rule.
"""
import os as _os
ROOT = _os.environ.get("NQ_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import numpy as np, pandas as pd, pickle
from scipy import stats

COST_PTS = 1.2          # round-trip slippage + commission, in index points
FDR = 0.10
SPLIT = pd.Timestamp("2025-01-01")

F = pd.read_pickle(ROOT + "/data/features.pkl")
PATHS = pickle.load(open(ROOT + "/data/paths.pkl", "rb"))
F = F[F.p_rth_close.notna() & F.atr.notna()].reset_index(drop=True)


# ----------------------------------------------------------------- helpers
def first_break(sess, after_min, level, side):
    """First RTH bar at/after `after_min` where price breaks `level`.
    side=+1 -> break above, -1 -> break below. Returns (minute, close) or None."""
    p = PATHS.get(sess)
    if p is None or np.isnan(level):
        return None
    m, hi, lo, c = p["mins"], p["high"], p["low"], p["close"]
    sel = m >= after_min
    idx = np.flatnonzero(sel & ((hi > level) if side > 0 else (lo < level)))
    return (m[idx[0]], c[idx[0]]) if len(idx) else None


def close_at(sess, minute):
    p = PATHS.get(sess)
    if p is None:
        return np.nan
    idx = np.flatnonzero(p["mins"] >= minute)
    return p["close"][idx[0]] if len(idx) else np.nan


def fwd(sess, from_min, entry, direction, horizon=None):
    """Signed forward move in points from `entry` to the horizon (or RTH close)."""
    p = PATHS.get(sess)
    if p is None or np.isnan(entry):
        return np.nan
    if horizon is None:
        exit_px = p["close"][-1]
    else:
        idx = np.flatnonzero(p["mins"] >= from_min + horizon)
        exit_px = p["close"][idx[0]] if len(idx) else p["close"][-1]
    return (exit_px - entry) * direction


# ----------------------------------------------------------------- signals
def signals(row):
    """Yield (hypothesis_id, trigger_minute, entry_price, direction)."""
    s, atr = row.session, row.atr
    out = []

    # --- A: overnight gap ---
    gap = row.rth_open - row.p_rth_close
    if abs(gap) > 0.25 * atr:
        d = int(np.sign(gap))
        out.append(("A1_gap_fade", 570, row.rth_open, -d))
        out.append(("A2_gap_cont", 570, row.rth_open, d))

    # --- B: opening range break (after 10:00) ---
    up = first_break(s, 600, row.or30_high, +1)
    dn = first_break(s, 600, row.or30_low, -1)
    b = None
    if up and dn:
        b = (up, +1) if up[0] <= dn[0] else (dn, -1)
    elif up:
        b = (up, +1)
    elif dn:
        b = (dn, -1)
    if b:
        (mn, px), d = b
        out.append(("B1_or30_cont", mn, px, d))
        out.append(("B2_or30_fade", mn, px, -d))

    # --- C: overnight range break ---
    up = first_break(s, 570, row.on_high, +1)
    dn = first_break(s, 570, row.on_low, -1)
    cbk = None
    if up and dn:
        cbk = (up, +1) if up[0] <= dn[0] else (dn, -1)
    elif up:
        cbk = (up, +1)
    elif dn:
        cbk = (dn, -1)
    if cbk:
        (mn, px), d = cbk
        out.append(("C1_globex_cont", mn, px, d))
        out.append(("C2_globex_fade", mn, px, -d))

    # --- D: prior-day high/low break ---
    up = first_break(s, 570, row.p_rth_high, +1)
    dn = first_break(s, 570, row.p_rth_low, -1)
    dbk = None
    if up and dn:
        dbk = (up, +1) if up[0] <= dn[0] else (dn, -1)
    elif up:
        dbk = (up, +1)
    elif dn:
        dbk = (dn, -1)
    if dbk:
        (mn, px), d = dbk
        out.append(("D1_pdh_pdl_cont", mn, px, d))
        out.append(("D2_pdh_pdl_fade", mn, px, -d))

    # --- E: time of day ---
    if not np.isnan(row.or60_close):
        d = int(np.sign(row.or60_close - row.rth_open))
        if d != 0:
            out.append(("E1_hour1_cont", 630, row.or60_close, d))
            out.append(("E2_hour1_fade", 630, row.or60_close, -d))
    if not (np.isnan(row.c1330) or np.isnan(row.c1130)):
        dl = int(np.sign(row.c1330 - row.c1130))
        if dl != 0:
            out.append(("E3_lunch_fade", 810, row.c1330, -dl))

    # --- F: extended move by 11:00 ---
    mv = row.c1100 - row.rth_open
    if not np.isnan(mv):
        d = int(np.sign(mv))
        if abs(mv) > 1.0 * atr:
            out.append(("F1_ext10atr_fade", 660, row.c1100, -d))
            out.append(("F2_ext10atr_cont", 660, row.c1100, d))
        if abs(mv) > 0.5 * atr:
            out.append(("F3_ext05atr_fade", 660, row.c1100, -d))
            out.append(("F4_ext05atr_cont", 660, row.c1100, d))

    # --- G: value area ---
    if not (np.isnan(row.p_vah) or np.isnan(row.p_val) or np.isnan(row.p_poc)):
        if row.rth_open > row.p_vah or row.rth_open < row.p_val:
            d = int(np.sign(row.p_poc - row.rth_open))
            if d != 0:
                out.append(("G1_outside_va_revert", 570, row.rth_open, d))
        elif not np.isnan(row.or30_close):
            d = int(np.sign(row.or30_close - row.rth_open))
            if d != 0:
                out.append(("G2_inside_va_breakout", 600, row.or30_close, d))

    # --- H: day of week (long bias) ---
    out.append((f"H1_dow{int(row.dow)}", 570, row.rth_open, +1))
    return out


# ----------------------------------------------------------------- run
def collect(frame):
    recs = []
    for row in frame.itertuples():
        for hid, mn, px, d in signals(row):
            recs.append(dict(
                hid=hid, session=row.session, year=row.year, minute=mn, entry=px, dir=d,
                to_close=fwd(row.session, mn, px, d),
                h60=fwd(row.session, mn, px, d, 60),
                h120=fwd(row.session, mn, px, d, 120),
            ))
    return pd.DataFrame(recs).dropna(subset=["to_close"])


def evaluate(R, label):
    out = []
    for hid, g in R.groupby("hid"):
        x = g.to_close.to_numpy() - COST_PTS      # net of costs
        n = len(x)
        if n < 30:
            out.append(dict(hid=hid, n=n, net_mean=np.nan, t=np.nan, p=np.nan,
                            note="too few observations"))
            continue
        t, p = stats.ttest_1samp(x, 0.0)
        yrs = g.assign(net=x).groupby("year").net.mean()
        half = len(g) // 2
        s1 = np.mean(x[:half]); s2 = np.mean(x[half:])
        out.append(dict(
            hid=hid, n=n, net_mean=x.mean(), sd=x.std(ddof=1), t=t, p=p,
            win=100 * (x > 0).mean(),
            pos_years=int((yrs > 0).sum()), n_years=len(yrs),
            sign_stable=bool(np.sign(s1) == np.sign(s2)),
        ))
    res = pd.DataFrame(out).sort_values("p")

    # Benjamini-Hochberg across all testable hypotheses
    m = res.p.notna()
    k = int(m.sum())
    res["bh_crit"] = np.nan
    res.loc[m, "bh_crit"] = FDR * (np.arange(1, k + 1)) / k
    res["bh_pass"] = res.p <= res.bh_crit
    # step-up: everything up to the largest passing index passes
    passing = np.flatnonzero(res.bh_pass.fillna(False).to_numpy())
    res["bh_pass"] = False
    if len(passing):
        res.iloc[: passing.max() + 1, res.columns.get_loc("bh_pass")] = res.iloc[: passing.max() + 1].p.notna()
    res.attrs["label"] = label
    return res


if __name__ == "__main__":
    disc = F[F.session < SPLIT]
    print(f"discovery sessions: {len(disc)}  ({disc.session.min()} -> {disc.session.max()})")
    R = collect(disc)
    R.to_pickle(ROOT + "/results/survey_disc.pkl")
    res = evaluate(R, "discovery")
    pd.set_option("display.width", 200)
    print(f"\n{len(res)} hypotheses tested, {int(res.p.notna().sum())} testable\n")
    print(f"{'hypothesis':<24}{'n':>6}{'net pts':>10}{'sd':>8}{'t':>8}{'p':>9}"
          f"{'win%':>7}{'yrs+':>6}{'stable':>8}{'BH':>5}")
    print("-" * 92)
    for _, r in res.iterrows():
        if pd.isna(r.p):
            print(f"{r.hid:<24}{r.n:>6}{'  — ' + str(r.get('note','')):>40}")
            continue
        print(f"{r.hid:<24}{r.n:>6}{r.net_mean:>10.2f}{r.sd:>8.1f}{r.t:>8.2f}{r.p:>9.4f}"
              f"{r.win:>7.1f}{str(r.pos_years)+'/'+str(r.n_years):>6}"
              f"{'yes' if r.sign_stable else 'no':>8}{'PASS' if r.bh_pass else '·':>5}")
    res.to_csv(ROOT + "/results/survey_discovery.csv", index=False)
