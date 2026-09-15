"""
Contract specifications and data locations, one entry per instrument.

Two separate ideas live in each spec and they must not be confused:

  * **Signals are generated on full-size data.** The volume profile is the edge
    (CLAUDE.md section 3) and micro volume is thin — especially in the Asia window
    for gold and crude, which is exactly where this method looks. A low volume
    node measured on MGC is measuring the absence of micro traders, not the
    absence of liquidity.
  * **Execution is in micros.** The prop account's 6 E-mini cap is 60 micros, and
    micros are the only way to size small enough to fit a $2,000 trailing
    drawdown.

So `point_full` is used to read the tape and `point_micro` to price a trade.

Sources: CME contract specifications, tabulated in CLAUDE.md section 5.
`commission_rt` is a round-turn estimate per micro contract, all-in; it is a cost
assumption rather than a contract fact, and 1.20 is what the MNQ work used.
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class Instrument:
    key: str            # short name used on the command line and in filenames
    full: str           # full-size root, the series signals are computed on
    micro: str          # micro root, the series trades are executed in
    point_full: float   # $ per point, full-size
    point_micro: float  # $ per point, micro
    tick: float         # minimum price increment, in points
    dataset: str        # Databento dataset
    continuous: str     # Databento continuous symbol, volume roll, front month
    commission_rt: float = 1.20   # $ per micro contract, round turn (estimate)

    @property
    def tick_value_micro(self) -> float:
        return self.tick * self.point_micro


#: `.v.0` is Databento's volume-based roll, front month. It matches the
#: dominance rule `build_continuous.py` implements by hand, so instruments
#: fetched this way skip that step entirely.
INSTRUMENTS = {
    i.key: i for i in [
        Instrument("NQ",  "NQ",  "MNQ", 20.0,   2.0,   0.25, "GLBX.MDP3", "NQ.v.0"),
        Instrument("ES",  "ES",  "MES", 50.0,   5.0,   0.25, "GLBX.MDP3", "ES.v.0"),
        Instrument("GC",  "GC",  "MGC", 100.0, 10.0,   0.10, "GLBX.MDP3", "GC.v.0"),
        Instrument("CL",  "CL",  "MCL", 1000.0, 100.0, 0.01, "GLBX.MDP3", "CL.v.0"),
        Instrument("YM",  "YM",  "MYM", 5.0,    0.50,  1.00, "GLBX.MDP3", "YM.v.0"),
        Instrument("RTY", "RTY", "M2K", 50.0,   5.0,   0.10, "GLBX.MDP3", "RTY.v.0"),
    ]
}

#: Fetch order from CLAUDE.md section 5. GC first: gold's driver is unrelated to
#: the index complex, so its setups land on different days and actually add
#: frequency. YM and RTY are near-duplicates of ES/NQ and are listed last because
#: correlated setups do not decorrelate the account.
PRIORITY = ["GC", "CL", "ES", "NQ", "YM", "RTY"]

#: The window the original MNQ research covers, and the default fetch range.
START = "2022-08-04"
END = "2026-09-10"


def get(key: str) -> Instrument:
    k = key.upper()
    if k not in INSTRUMENTS:
        raise KeyError(f"unknown instrument {key!r}; known: {', '.join(INSTRUMENTS)}")
    return INSTRUMENTS[k]


def bars_path(root: str, key: str) -> str:
    """Where the continuous 1-minute series for an instrument lives."""
    return f"{root}/data/{key.lower()}_cont_1m.pkl"


if __name__ == "__main__":
    print(f"{'key':<5}{'full':>6}{'micro':>7}{'$/pt full':>11}{'$/pt micro':>12}"
          f"{'tick':>8}{'$/tick micro':>14}{'symbol':>10}")
    for k in PRIORITY:
        i = INSTRUMENTS[k]
        print(f"{i.key:<5}{i.full:>6}{i.micro:>7}{i.point_full:>11,.2f}"
              f"{i.point_micro:>12,.2f}{i.tick:>8}{i.tick_value_micro:>14,.2f}"
              f"{i.continuous:>10}")
