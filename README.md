# NQ Futures Strategy Research

Continuation of work started in a Claude web session. **Read `CLAUDE.md` first** —
it is the full project state and Claude Code loads it automatically.

## Setup

```bash
pip install -r requirements.txt
```

Paths resolve relative to the repo root via `ROOT` in each module, or override with
`export NQ_ROOT=/path/to/nq-research`.

## Get the data

Market data is not bundled — it is licensed from Databento and large. With an API
key the pull is automatic:

```bash
export DATABENTO_API_KEY=db-...                  # or put it in .env (git-ignored)
python3 src/databento_fetch.py --cost GC CL ES   # price it first; metadata calls are free
python3 src/databento_fetch.py GC                # -> data/gc_cont_1m.pkl
```

This asks for continuous symbology (`GC.v.0`), so Databento applies the volume roll
and `build_continuous.py` is not needed.

If you already hold `.zst` pulls, the original path still works:

```bash
python3 src/zstd_ctypes.py data/glbx-mdp3-*.csv.zst data/raw.csv
python3 src/build_continuous.py        # -> data/mnq_cont_1m.pkl
```

`zstd_ctypes.py` binds the system libzstd through ctypes, so `pip install zstandard`
isn't needed.

## Reproduce the live result

```bash
python3 src/method.py     # setup counts, entry-depth ladder
python3 src/filters.py    # prior-day condition + the LVN filter (this is the edge)
python3 src/portfolio.py  # multi-account campaign economics — needs no bar data
```

Expect: 213 setups, geometry alone −0.21R, LVN ≤ 0.25 → +1.34R on 24 trades, and
from `portfolio.py`, a median 5 months to a first payout on one account at
$1,188/month.

## Run it on another instrument

`NQ_INSTRUMENT` picks the contract; unset means NQ, which is what every number in
`CLAUDE.md` was measured on.

```bash
export NQ_INSTRUMENT=GC
python3 src/method.py
python3 src/instruments.py     # the contract spec table
```

## Tests

```bash
python3 tests/test_pipeline.py     # no data or API key needed
```

Plants a setup with known geometry in synthetic gold and crude bars and checks the
method recovers it — the structure, both fib levels, the direction and the
micro-denominated P&L. This exists because three size thresholds used to be written
in NQ points, which on crude rejected every possible setup and reported zero rather
than failing.

## Layout

```
CLAUDE.md          full project context — start here
PREREGISTRATION.md hypothesis list fixed before searching
DEVIATIONS.md      every departure from it, including the unflattering ones
src/               all analysis code (see CLAUDE.md §6 for the map)
tests/             cross-instrument checks that need no data
results/           trade lists and sweep outputs. lvn_trades.csv is the key file
reports/           three self-contained HTML reports — open in a browser
data/              market data lands here; git-ignored
```

## The GC/CL transfer test

Pre-registered in `PREREGISTRATION-MULTI.md` before the data was pulled, run once
with nothing re-fitted:

```bash
python3 src/databento_fetch.py GC CL     # ~$10 of Databento credit
python3 src/transfer_test.py             # the registered endpoints + BH correction
```

Two outcomes, and they point in different directions — `CLAUDE.md` §4a has the detail:

- **Edge: inconclusive.** Pooled +1.13R with monotone tertiles, every estimate in the
  predicted direction, but nothing survives Benjamini–Hochberg. Pooled n was 10, not
  the projected 48, so power was 31%.
- **Frequency: a clear negative.** GC produces 0.04 tradeable setups/month and CL
  0.16, against NQ's 0.61. Adding both moves time-to-first-payout from 12 months to
  11, not to 7 as `CLAUDE.md` §4 assumed.

## The one thing to do next

**Forward-test.** §4a closed the alternative: validating the edge by adding
instruments would need ~18 years of data at the measured rates. Logging every setup
live — including the ones skipped — is now the only way the sample grows.

ES is deliberately untouched and is the reserve holdout. Do not spend it casually.

## Standing rules

`CLAUDE.md` §7. Briefly: pre-register before searching, record deviations honestly,
the 2025+ holdout is already spent, correct for multiple testing, and remember that
every current number rests on **24 trades with 8 winners**.
