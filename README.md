# NQ Futures Strategy Research

Continuation of work started in a Claude web session. **Read `CLAUDE.md` first** —
it is the full project state and Claude Code loads it automatically.

## Setup

```bash
pip install -r requirements.txt
```

Paths resolve relative to the repo root via `ROOT` in each module, or override with
`export NQ_ROOT=/path/to/nq-research`.

## Rebuild the data

The raw Databento files are not bundled (≈37MB compressed each). Put your `.zst`
pulls in `data/`, then:

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
python3 src/portfolio.py  # multi-account campaign economics
```

Expect: 213 setups, geometry alone −0.21R, LVN ≤ 0.25 → +1.34R on 24 trades.

## Layout

```
CLAUDE.md          full project context — start here
PREREGISTRATION.md hypothesis list fixed before searching
DEVIATIONS.md      every departure from it, including the unflattering ones
src/               all analysis code (see CLAUDE.md §6 for the map)
results/           trade lists and sweep outputs. lvn_trades.csv is the key file
reports/           three self-contained HTML reports — open in a browser
data/              put .zst pulls here
```

## The one thing to do next

Get **GC** (gold) 1-minute data and run the method on it. Claude Code has your
network, so it can fetch directly from Databento with an API key — the previous
environment could not. Order spec is in `CLAUDE.md` §5.

## Standing rules

`CLAUDE.md` §7. Briefly: pre-register before searching, record deviations honestly,
the 2025+ holdout is already spent, correct for multiple testing, and remember that
every current number rests on **24 trades with 8 winners**.
