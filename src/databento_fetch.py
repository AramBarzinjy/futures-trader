"""
Fetch 1-minute OHLCV from Databento and write the continuous series the method
expects. This is the step CLAUDE.md section 5 calls the blocking item.

The earlier session's container had no outbound network, so the MNQ data was
pulled by hand as `.zst` files and spliced into a front-month series by
`build_continuous.py`. Two things change here:

  * There is network, so the pull happens directly.
  * Continuous symbology (`GC.v.0`) is requested instead of parent symbology,
    so Databento applies the volume roll server-side. That is the same rule
    `build_continuous.py` implements — highest-volume contract, forward only —
    which makes the hand-built splice unnecessary for new instruments.

Cost control matters: the account has $125 of free credits and this is billed
per gigabyte. `--cost` prices a request without running it, and nothing is
downloaded until you ask for it.

Usage
-----
    export DATABENTO_API_KEY=db-...

    python3 src/databento_fetch.py --cost GC CL ES     # price it first, free
    python3 src/databento_fetch.py GC                  # then actually pull
    python3 src/databento_fetch.py --all               # everything in PRIORITY

Writes `data/<key>_cont_1m.pkl`, the same schema `build_continuous.py` produces,
so `method.py` and `filters.py` read it without changes.
"""
import os as _os
ROOT = _os.environ.get("NQ_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import argparse
import sys
import time

import pandas as pd
import requests

sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
import instruments as I
from zstd_ctypes import decompress_to_file

BASE = "https://hist.databento.com/v0"
SCHEMA = "ohlcv-1m"
STYPE = "continuous"


def api_key() -> str:
    """Key from the environment, or from a .env file that git ignores."""
    k = _os.environ.get("DATABENTO_API_KEY", "").strip()
    if not k:
        env = _os.path.join(ROOT, ".env")
        if _os.path.exists(env):
            for line in open(env):
                line = line.strip()
                if line.startswith("DATABENTO_API_KEY="):
                    k = line.split("=", 1)[1].strip().strip('"').strip("'")
                    break
    if not k:
        raise SystemExit(
            "No Databento API key.\n"
            "  export DATABENTO_API_KEY=db-...\n"
            "or put DATABENTO_API_KEY=db-... in .env at the repo root (git-ignored).\n"
            "Keys are at https://databento.com/portal/keys"
        )
    if not k.startswith("db-"):
        raise SystemExit(f"That does not look like a Databento key (expected db-...): {k[:6]}...")
    return k


def _params(inst: I.Instrument, start: str, end: str) -> dict:
    return {
        "dataset": inst.dataset,
        "symbols": inst.continuous,
        "schema": SCHEMA,
        "start": start,
        "end": end,
        "stype_in": STYPE,
        "stype_out": "instrument_id",
    }


def _post(path: str, key: str, params: dict, stream: bool = False):
    r = requests.post(f"{BASE}/{path}", data=params, auth=(key, ""),
                      stream=stream, timeout=(30, 600))
    if r.status_code == 401:
        raise SystemExit("Databento rejected the key (401). Check DATABENTO_API_KEY.")
    if r.status_code >= 400:
        body = r.text[:500] if not stream else r.raw.read(500).decode("utf8", "replace")
        raise SystemExit(f"Databento {r.status_code} on {path}: {body}")
    return r


def cost(keys, start: str, end: str) -> None:
    """Price the requests without downloading. Free — metadata calls are not billed."""
    key = api_key()
    print(f"{'instrument':<12}{'symbol':>10}{'billable':>14}{'cost':>10}")
    total = 0.0
    for k in keys:
        inst = I.get(k)
        p = _params(inst, start, end)
        size = float(_post("metadata.get_billable_size", key, p).json())
        p2 = dict(p, mode="historical-streaming")
        usd = float(_post("metadata.get_cost", key, p2).json())
        total += usd
        print(f"{inst.key:<12}{inst.continuous:>10}{size/1e9:>12.2f}GB{usd:>9.2f}$")
    print(f"{'':<12}{'':>10}{'total':>14}{total:>9.2f}$")
    print("\nNew accounts get $125 in free credits, so this should draw on those.")


def fetch(k: str, start: str, end: str, force: bool = False) -> str:
    """Download one instrument and write its continuous 1-minute pickle."""
    inst = I.get(k)
    out = I.bars_path(ROOT, inst.key)
    if _os.path.exists(out) and not force:
        print(f"{inst.key}: {out} already exists, skipping (use --force to refetch)")
        return out

    _os.makedirs(f"{ROOT}/data", exist_ok=True)
    zst = f"{ROOT}/data/{inst.key.lower()}_{SCHEMA}.csv.zst"
    csv = f"{ROOT}/data/{inst.key.lower()}_{SCHEMA}.csv"

    key = api_key()
    p = dict(_params(inst, start, end), encoding="csv", compression="zstd",
             pretty_px="true", pretty_ts="true", map_symbols="true")

    print(f"{inst.key}: requesting {inst.continuous} {SCHEMA} {start} -> {end}")
    t0 = time.time()
    r = _post("timeseries.get_range", key, p, stream=True)
    n = 0
    with open(zst, "wb") as f:
        for chunk in r.iter_content(1 << 20):
            f.write(chunk)
            n += len(chunk)
            print(f"\r  {n/1e6:,.1f} MB", end="", flush=True)
    print(f"\r  {n/1e6:,.1f} MB compressed in {time.time()-t0:.0f}s")
    if n == 0:
        raise SystemExit(f"{inst.key}: empty response — check the date range.")

    raw = decompress_to_file(zst, csv)
    print(f"  {raw/1e6:,.1f} MB decompressed")

    df = _to_continuous(csv, inst)
    df.to_pickle(out)
    _os.remove(zst)
    _os.remove(csv)

    _summary(df, inst, out)
    return out


def _to_continuous(csv_path: str, inst: I.Instrument) -> pd.DataFrame:
    """Databento CSV -> the schema build_continuous.py produces.

    Databento has already applied the volume roll, so the only work left is the
    CME session-day convention and flagging the roll boundaries.
    """
    df = pd.read_csv(csv_path)
    cols = {c.lower(): c for c in df.columns}
    ts_col = cols.get("ts_event") or cols.get("ts_recv")
    sym_col = cols.get("symbol") or cols.get("raw_symbol")

    df = df.rename(columns={ts_col: "ts_event", sym_col: "symbol"})
    df["ts"] = pd.to_datetime(df.ts_event, format="ISO8601", utc=True)
    df["symbol"] = df.symbol.astype(str)
    for c in ("open", "high", "low", "close"):
        df[c] = df[c].astype(float)
    df["volume"] = df.volume.astype(float)

    # CME session day: the session runs 18:00 ET to 17:00 ET the next day, so
    # shifting +7h puts the 17:00 boundary on midnight and the date falls out.
    et = df.ts.dt.tz_convert("America/New_York")
    df["et"] = et
    df["session"] = (et + pd.Timedelta(hours=7)).dt.normalize().dt.tz_localize(None)

    df = df.sort_values("ts").reset_index(drop=True)
    # Flag the roll on the session whose dominant contract changes. Dominance is
    # by volume rather than by the session's first bar: Databento rolls at a
    # session boundary, but taking the first bar would silently miss a roll that
    # landed mid-session and would mislabel the one either side of it.
    dom = (df.groupby(["session", "symbol"], observed=True).volume.sum()
             .reset_index().sort_values(["session", "volume"], ascending=[True, False])
             .groupby("session").symbol.first())
    df["roll_day"] = df.session.map(dom.ne(dom.shift()).to_dict()).fillna(False)

    return df[["ts", "et", "session", "open", "high", "low",
               "close", "volume", "symbol", "roll_day"]]


def _summary(df: pd.DataFrame, inst: I.Instrument, out: str) -> None:
    bars = df.groupby("session").size()
    print(f"  rows          : {len(df):,}")
    print(f"  sessions      : {df.session.nunique():,}")
    print(f"  range         : {df.ts.min()}  ->  {df.ts.max()}")
    print(f"  contracts     : {df.symbol.nunique()}")
    print(f"  rolls         : {int(df.groupby('session').roll_day.first().sum())}")
    print(f"  price range   : {df.low.min():,.2f} - {df.high.max():,.2f}")
    print(f"  bars/session  : median {bars.median():.0f}, p5 {bars.quantile(.05):.0f}, min {bars.min()}")
    print(f"  -> {out}\n")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("instruments", nargs="*", help=f"any of {', '.join(I.PRIORITY)}")
    ap.add_argument("--all", action="store_true", help="every instrument, in priority order")
    ap.add_argument("--cost", action="store_true", help="price the request without downloading")
    ap.add_argument("--start", default=I.START)
    ap.add_argument("--end", default=I.END)
    ap.add_argument("--force", action="store_true", help="refetch even if the pickle exists")
    a = ap.parse_args()

    keys = I.PRIORITY if a.all else [k.upper() for k in a.instruments]
    if not keys:
        ap.error("name at least one instrument, or pass --all")
    for k in keys:
        try:
            I.get(k)   # validate before spending anything
        except KeyError as e:
            ap.error(str(e).strip('"'))

    if a.cost:
        cost(keys, a.start, a.end)
        return
    for k in keys:
        fetch(k, a.start, a.end, force=a.force)


if __name__ == "__main__":
    main()
