"""Build a continuous front-month MNQ 1-minute series from Databento GLBX data.

Roll rule: front month = contract with the highest 1-day rolling volume; roll only
forward (never back), confirmed by 2 consecutive days of dominance to avoid churn.
No back-adjustment: the strategy is intraday and all levels are computed from the
same contract within a session, so splices only matter across the roll boundary,
which is flagged in `roll_day`.
"""
import os as _os
ROOT = _os.environ.get("NQ_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import pandas as pd, numpy as np

SRC = ROOT + "/data/mnq_union.csv"
OUT = ROOT + "/data/mnq_cont_1m.pkl"

MONTH_CODE = {"H": 3, "M": 6, "U": 9, "Z": 12}


def contract_sort_key(sym):
    # MNQU6 -> (year, month). Databento single-digit year; data spans 2022-2027.
    m, y = sym[3], int(sym[4])
    year = 2020 + y if y >= 2 else 2030 + y
    return (year, MONTH_CODE[m])


def main():
    df = pd.read_csv(
        SRC,
        usecols=["ts_event", "open", "high", "low", "close", "volume", "symbol"],
        dtype={"symbol": "category"},
    )
    # outright contracts only (spreads contain '-')
    df = df[~df.symbol.astype(str).str.contains("-")].copy()
    df["symbol"] = df.symbol.astype(str)

    df["ts"] = pd.to_datetime(df.ts_event, format="ISO8601", utc=True)
    df.drop(columns=["ts_event"], inplace=True)

    # CME session day in Eastern time: session runs 18:00 ET -> 17:00 ET next day.
    et = df.ts.dt.tz_convert("America/New_York")
    df["et"] = et
    # shift +7h so 17:00 ET boundary lands on midnight -> session date
    df["session"] = (et + pd.Timedelta(hours=7)).dt.normalize().dt.tz_localize(None)

    # --- choose front month per session by volume ---
    vol = df.groupby(["session", "symbol"], observed=True).volume.sum().reset_index()
    vol["key"] = vol.symbol.map(contract_sort_key)
    vol = vol.sort_values(["session", "volume"], ascending=[True, False])
    top = vol.groupby("session").first()[["symbol", "key"]]

    # enforce monotonic-forward rolls with 2-day confirmation
    chosen, cur, cur_key, streak, pending = [], None, None, 0, None
    for sess, row in top.iterrows():
        cand, ckey = row.symbol, row.key
        if cur is None:
            cur, cur_key = cand, ckey
        elif ckey > cur_key:
            if pending == cand:
                streak += 1
            else:
                pending, streak = cand, 1
            if streak >= 2:
                cur, cur_key, pending, streak = cand, ckey, None, 0
        else:
            pending, streak = None, 0
        chosen.append((sess, cur))

    front = pd.DataFrame(chosen, columns=["session", "front"]).set_index("session")
    df = df.merge(front, left_on="session", right_index=True, how="inner")
    cont = df[df.symbol == df.front].copy()

    cont = cont.sort_values("ts").reset_index(drop=True)
    cont["roll_day"] = cont.session.map(
        front.front.ne(front.front.shift()).to_dict()
    ).fillna(False)

    cont = cont[["ts", "et", "session", "open", "high", "low", "close", "volume", "symbol", "roll_day"]]
    cont.to_pickle(OUT)

    print(f"rows           : {len(cont):,}")
    print(f"sessions       : {cont.session.nunique():,}")
    print(f"range          : {cont.ts.min()}  ->  {cont.ts.max()}")
    print(f"contracts used : {cont.symbol.nunique()}")
    print(f"roll sessions  : {int(cont.groupby('session').roll_day.first().sum())}")
    print(f"price range    : {cont.low.min():.1f} - {cont.high.max():.1f}")
    bars = cont.groupby("session").size()
    print(f"bars/session   : median {bars.median():.0f}, p5 {bars.quantile(.05):.0f}, min {bars.min()}")
    print("\nroll schedule:")
    rolls = front[front.front.ne(front.front.shift())]
    print(rolls.to_string())


if __name__ == "__main__":
    main()
