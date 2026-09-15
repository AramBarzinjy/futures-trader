"""
Prove the method runs correctly on instruments other than NQ, before any money
is spent pulling their data.

The original code carried three thresholds denominated in NQ points: a minimum
leg of 10, a minimum stop of 2, and a 10-point volume-profile bin. Gold ticks in
0.10 and crude in 0.01, so on those contracts a 10-point floor rejects every
setup that could ever occur and the run reports a clean, believable zero. This
builds synthetic sessions containing one setup with known geometry and checks
the method finds it and prices it correctly.

    python3 tests/test_pipeline.py
"""
import os
import subprocess
import sys
import tempfile

import numpy as np
import pandas as pd

SRC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src")
sys.path.insert(0, SRC)
import instruments as I


def session_bars(day: pd.Timestamp, waypoints, tick: float, seed: int = 0):
    """One CME session of 1-minute bars following a price path.

    `waypoints` is [(london_minute, price), ...]; price moves linearly between
    them and jitters by a tick so highs and lows are not degenerate. The session
    runs 17:00 ET the previous day to 17:00 ET on `day`, which is the convention
    build_continuous.py and databento_fetch.py both produce.
    """
    start = (day - pd.Timedelta(days=1)).tz_localize("America/New_York") + pd.Timedelta(hours=17)
    idx = pd.date_range(start, periods=24 * 60, freq="1min").tz_convert("UTC")
    lon = idx.tz_convert("Europe/London")
    lm = lon.hour * 60 + lon.minute

    # Waypoint minutes are measured from 00:00 London on the session day. The
    # London clock wraps inside a CME session (it opens at 22:00 London the
    # evening before), so they are converted to elapsed bars off that wrap
    # point rather than matched against the wall clock, which is not monotonic.
    origin = int(np.flatnonzero(lm == 0)[0])
    wp_e = np.array([origin + w[0] for w in waypoints], float)
    wp_p = np.array([w[1] for w in waypoints], float)
    if not np.all(np.diff(wp_e) > 0):
        raise ValueError("waypoint minutes must increase")
    if wp_e[-1] > len(idx) - 1:
        raise ValueError(f"waypoint at minute {waypoints[-1][0]} runs past the session end")
    close = np.interp(np.arange(len(idx), dtype=float), wp_e, wp_p)

    rng = np.random.default_rng(seed)
    jitter = rng.uniform(0, tick, len(idx))
    return pd.DataFrame({
        "ts": idx,
        "et": idx.tz_convert("America/New_York"),
        "session": day,
        "open": close,
        "high": close + jitter,
        "low": close - jitter,
        "close": close,
        "volume": 100.0,
        "symbol": "SYN",
        "roll_day": False,
    })


def build(inst: I.Instrument, waypoints, root: str):
    """Three sessions: a flat lead-in, the planted setup, and a flat follow-on."""
    days = [pd.Timestamp("2025-03-03"), pd.Timestamp("2025-03-04"), pd.Timestamp("2025-03-05")]
    flat = [(0, waypoints[0][1]), (21 * 60 + 59, waypoints[0][1])]
    frames = [session_bars(days[0], flat, inst.tick, seed=1),
              session_bars(days[1], waypoints, inst.tick, seed=2),
              session_bars(days[2], flat, inst.tick, seed=3)]
    df = pd.concat(frames).sort_values("ts").reset_index(drop=True)
    os.makedirs(f"{root}/data", exist_ok=True)
    df.to_pickle(I.bars_path(root, inst.key))
    return df


#: One planted setup per instrument, with the geometry worked out by hand.
#: Sweep the Asia HIGH (A), break the LOW (B), over-extend DOWN to the -2.0
#: level, then recover to level 1. leg = |B - A|.
CASES = {
    # key   asia_lo  asia_hi  sweep_to(A)   B        so leg =
    "GC": dict(lo=2890.0, hi=2910.0, A=2915.0),   # leg 25.0   (old floor 10 pts: passes)
    "CL": dict(lo=69.50,  hi=70.50,  A=70.80),    # leg  1.30  (old floor 10 pts: REJECTED)
}


def waypoints_for(c):
    """Asia chop, sweep the high, break the low, extend to -2.0, recover to A."""
    lo, hi, A = c["lo"], c["hi"], c["A"]
    mid = (lo + hi) / 2
    B = lo
    leg = abs(B - A)
    entry = B - 2.0 * leg
    wp = [(0, mid), (60, hi), (120, lo), (180, hi), (240, lo), (300, mid)]
    # last 30 Asia minutes must be directionless: efficiency ratio <= 0.30
    wp += [(300 + 2 * k, mid + (0.4 * (hi - mid) if k % 2 else -0.4 * (hi - mid)))
           for k in range(1, 30)]
    wp += [(359, mid)]
    # The sweep has to move faster than the bar jitter. setups() ends the sweep
    # segment at the first bar whose low re-enters the range, so a drift slower
    # than a tick per minute ends it on the bar that opened it and the extreme
    # is recorded as the range boundary instead of the true high.
    wp += [
        (360, mid), (372, A),                 # the manipulation: sweep the high
        (400, mid),                           # re-enter the range
        (440, B - 0.30 * leg),                # break of structure, through the low
        (540, entry - 0.10 * leg),            # over-extend past -2.0 -> limit fills
        (740, A + 0.05 * leg),                # recover to level 1 -> target
        (21 * 60 + 59, A),
    ]
    return wp, dict(A=A, B=B, leg=leg, entry=entry, stop=B - 2.5 * leg, target=A)


RUNNER = r'''
import os, sys, pandas as pd
sys.path.insert(0, os.environ["SRC"])
import method
from method import Cfg, setups, trade, INSTRUMENT, POINT, TICK
# NQ_TEST_LEGACY_FLOOR reinstates the old hardcoded 10-point minimum leg, to
# show what it did to a contract that does not tick in quarter-points.
cfg = Cfg(min_leg_ticks=10.0 / TICK) if os.environ.get("NQ_TEST_LEGACY_FLOOR") else Cfg()
S = setups(cfg)
T = trade(cfg, S)
print("SETUPS", len(S))
if len(S):
    r = S.iloc[-1]
    print("GEOM %.10f %.10f %.10f %.10f %.10f %d" % (r.A, r.B, r.leg, r.entry, r.stop, r.d_ext))
if len(T):
    t = T.iloc[-1]
    print("TRADE %s %.10f %.10f %.10f" % (t.reason, t.points, t.rr, t.net))
print("POINT %.4f TICK %.4f" % (POINT, TICK))
'''


def run(inst, root, legacy_floor=False):
    env = dict(os.environ, NQ_ROOT=root, NQ_INSTRUMENT=inst.key, SRC=SRC)
    if legacy_floor:
        env["NQ_TEST_LEGACY_FLOOR"] = "1"
    else:
        env.pop("NQ_TEST_LEGACY_FLOOR", None)
    p = subprocess.run([sys.executable, "-c", RUNNER], env=env,
                       capture_output=True, text=True)
    if p.returncode != 0:
        print(p.stdout); print(p.stderr, file=sys.stderr)
        raise SystemExit(f"{inst.key}: runner failed")
    return dict(
        line.split(" ", 1) for line in p.stdout.strip().splitlines()
        if line.split(" ", 1)[0] in {"SETUPS", "GEOM", "TRADE", "POINT"}
    )


def main():
    failures = []
    for key, c in CASES.items():
        inst = I.get(key)
        wp, want = waypoints_for(c)
        with tempfile.TemporaryDirectory() as root:
            build(inst, wp, root)
            got = run(inst, root)
            legacy = int(run(inst, root, legacy_floor=True).get("SETUPS", 0))

        n = int(got.get("SETUPS", 0))
        print(f"\n=== {inst.key}  (tick {inst.tick}, ${inst.point_micro}/pt micro) ===")
        print(f"  expected leg {want['leg']:.4f} -> min leg floor "
              f"{40 * inst.tick:.4f} (old hardcoded floor was 10.0 points)")
        print(f"  setups found: {n}   (with the old 10-point floor: {legacy})")
        # On NQ the two are identical because 10 points IS 40 ticks. On gold and
        # crude the old floor is 100x and 1000x too large, and the run reported a
        # confident zero rather than an error.
        if want["leg"] < 10.0 and legacy != 0:
            failures.append(f"{inst.key}: the old floor should have rejected this setup")
        if want["leg"] >= 10.0 and legacy != n:
            failures.append(f"{inst.key}: the old floor should have behaved identically")
        if n == 0:
            failures.append(f"{inst.key}: no setup detected")
            continue

        A, B, leg, entry, stop, d_ext = (float(x) for x in got["GEOM"].split())

        # 1. Did it identify the right structure? Bar jitter moves each extreme
        #    by up to a tick, so compare against intent at tick tolerance.
        tol = 2 * inst.tick
        for name, g, w in (("A", A, want["A"]), ("B", B, want["B"]),
                           ("leg", leg, want["leg"])):
            ok = abs(g - w) <= tol
            print(f"  {name:<6} got {g:>12.4f}  want {w:>12.4f}  {'ok' if ok else 'MISMATCH'}")
            if not ok:
                failures.append(f"{inst.key}: {name} {g} != {w} (tol {tol})")

        # 2. Are the fib levels arithmetically right? Checked against the geometry
        #    actually measured, not against intent: entry sits at 2 legs and the
        #    stop at 2.5, so a tick of jitter in `leg` lands 2.5 ticks away in the
        #    stop. Testing that drift would be testing the jitter, not the fib.
        if int(d_ext) != -1:
            failures.append(f"{inst.key}: d_ext {d_ext} should be -1 (extensions run down)")
        for name, g, k in (("entry", entry, 2.0), ("stop", stop, 2.5)):
            w = B + d_ext * k * leg
            ok = abs(g - w) <= 1e-6
            print(f"  {name:<6} got {g:>12.4f}  = B{d_ext * k:+.1f}xleg "
                  f"{w:>12.4f}  {'ok' if ok else 'MISMATCH'}")
            if not ok:
                failures.append(f"{inst.key}: {name} {g} != B{d_ext*k:+.1f}xleg = {w}")

        if "TRADE" not in got:
            failures.append(f"{inst.key}: setup found but the trade never resolved")
            continue
        reason, points, rr, net = got["TRADE"].split()
        points, rr, net = float(points), float(rr), float(net)
        print(f"  trade  {reason}  {points:+.4f} pts  RR {rr:.2f}  net ${net:+,.2f}")
        if reason != "target":
            failures.append(f"{inst.key}: expected the target, got {reason}")
        if not 5.0 <= rr <= 7.0:
            failures.append(f"{inst.key}: RR {rr:.2f} outside the method's ~6 (CLAUDE.md s3)")
        expect_net = points * inst.point_micro * 5 - inst.commission_rt * 5
        if abs(net - expect_net) > 1.0:
            failures.append(f"{inst.key}: net ${net:,.2f} != ${expect_net:,.2f} "
                            f"(micro multiplier applied wrongly)")

    print()
    if failures:
        for f in failures:
            print("FAIL:", f)
        raise SystemExit(1)
    print("All instruments detected the planted setup with the correct geometry,")
    print("direction, ~6 RR and micro-denominated P&L.")


if __name__ == "__main__":
    main()
