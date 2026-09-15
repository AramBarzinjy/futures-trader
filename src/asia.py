"""
Stage 1 of formalising Aram's method: the parts that can be defined without
interpretation — the Asia session, whether it consolidated, and the first break of
structure after it closes.

Deliberately stops short of the fib / LVN / reactive-zone logic, because those
depend on conventions that have to be confirmed before they mean anything. What
this establishes is the base rate: how often the setup's *precondition* occurs,
which determines how large a sample the whole method can ever have.
"""
import os as _os
ROOT = _os.environ.get("NQ_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import numpy as np, pandas as pd
from dataclasses import dataclass

DF = pd.read_pickle(ROOT + "/data/mnq_cont_1m.pkl")
DF = DF.assign(mins=(DF.et.dt.hour * 60 + DF.et.dt.minute).to_numpy())


@dataclass
class AsiaCfg:
    start: int = 18 * 60          # 18:00 ET (CME reopen)
    end: int = 3 * 60             # 03:00 ET (London open)
    min_consol_minutes: int = 30
    max_er: float = 0.30          # Kaufman efficiency ratio ceiling = "no direction"
    max_range_pts: float = 0.0    # 0 = no cap; the thing Aram asked me to sweep
    bos_window_min: int = 300     # how long after Asia close to wait for the break


def efficiency_ratio(c):
    """|net move| / total path. 1.0 = a straight line, ~0 = pure chop."""
    if len(c) < 2:
        return np.nan
    path = np.abs(np.diff(c)).sum()
    return abs(c[-1] - c[0]) / path if path > 0 else np.nan


def asia_windows(cfg: AsiaCfg):
    """Yield (label, DataFrame) for each Asia session. The window spans the CME
    session boundary, so it is assembled from the evening of one session date."""
    for sess, g in DF.groupby("session", sort=True):
        g = g.sort_values("ts")
        m = g.mins.to_numpy()
        # Asia runs start->midnight->end, all inside one CME session date
        sel = (m >= cfg.start) | (m < cfg.end)
        a = g[sel]
        if len(a) < 120:
            continue
        # after-Asia block, for the break of structure
        post = g[(m >= cfg.end) & (m < cfg.end + cfg.bos_window_min)]
        if len(post) < 30:
            continue
        yield sess, a, post


def consolidation(a, cfg: AsiaCfg):
    """Does this Asia session qualify as consolidating?

    Aram's definition is '~30+ minutes of no sense of direction, tight or wide range'.
    Implemented as: the tightest qualifying stretch is the LAST `min_consol_minutes`
    of the session (the part that sets up the break), and it must be directionless by
    efficiency ratio. Range width is reported, not required, unless max_range_pts is set.
    """
    c = a.close.to_numpy(float)
    tail = c[-cfg.min_consol_minutes:]
    er_tail = efficiency_ratio(tail)
    er_all = efficiency_ratio(c)
    rng = a.high.max() - a.low.min()
    ok = (er_tail <= cfg.max_er)
    if cfg.max_range_pts:
        ok = ok and rng <= cfg.max_range_pts
    return ok, dict(er_tail=er_tail, er_all=er_all, rng=rng,
                    hi=a.high.max(), lo=a.low.min())


def first_bos(post, hi, lo):
    """First bar after Asia close that trades beyond the Asia range.
    Returns (direction, minute, price) — direction +1 = swept the high."""
    h, l, m = post.high.to_numpy(), post.low.to_numpy(), post.mins.to_numpy()
    up = np.flatnonzero(h > hi)
    dn = np.flatnonzero(l < lo)
    iu = up[0] if len(up) else np.inf
    idn = dn[0] if len(dn) else np.inf
    if iu == np.inf and idn == np.inf:
        return None
    if iu <= idn:
        return +1, m[int(iu)], hi
    return -1, m[int(idn)], lo


def survey(cfg: AsiaCfg):
    rows = []
    for sess, a, post in asia_windows(cfg):
        ok, info = consolidation(a, cfg)
        b = first_bos(post, info["hi"], info["lo"])
        rows.append(dict(session=sess, consolidated=ok, **info,
                         bos=b is not None, bos_dir=(b[0] if b else 0),
                         bos_min=(b[1] if b else np.nan)))
    return pd.DataFrame(rows)


if __name__ == "__main__":
    cfg = AsiaCfg()
    R = survey(cfg)
    R.to_pickle(ROOT + "/results/asia_base.pkl")
    n = len(R)
    print(f"Asia sessions examined      : {n}")
    print(f"median Asia range           : {R.rng.median():.0f} pts")
    print(f"median tail efficiency ratio: {R.er_tail.median():.2f}")
    print()
    print("How often does the precondition fire, by 'directionless' threshold?")
    print(f"{'max ER':>8}{'consolidated':>14}{'% of days':>11}{'+ a break':>11}{'setups/month':>14}")
    months = pd.to_datetime(R.session).dt.to_period("M").nunique()
    for er in (0.15, 0.20, 0.25, 0.30, 0.40, 0.50, 1.01):
        c = cfg.__class__(max_er=er)
        sel = R.er_tail <= er
        both = sel & R.bos
        print(f"{er:>8.2f}{int(sel.sum()):>14}{100*sel.mean():>10.1f}%{int(both.sum()):>11}"
              f"{both.sum()/months:>14.1f}")
    print()
    print("And by Asia range cap (Aram's question), holding ER <= 0.30:")
    print(f"{'max range':>10}{'setups':>9}{'% of days':>11}{'setups/month':>14}")
    base = R.er_tail <= 0.30
    for cap in (40, 60, 80, 100, 150, 200, 1e9):
        sel = base & (R.rng <= cap) & R.bos
        lab = "none" if cap > 1e8 else f"{cap:.0f} pts"
        print(f"{lab:>10}{int(sel.sum()):>9}{100*sel.mean():>10.1f}%{sel.sum()/months:>14.1f}")
    print(f"\nmonths covered: {months}")
