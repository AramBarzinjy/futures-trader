# NQ Futures Strategy Research — project context

Read this first. It is the complete state of a research project carried out in an
earlier session, written so you can continue without re-deriving anything.

**Owner:** Aram. Trades Nasdaq futures (MNQ/NQ) via Tradovate on a **demo-funded**
prop account — simulated fills, real prop-firm rules and payouts.

---

## 1. The goal, stated correctly

Not "$3,000 a month." The prop model is:

- Evaluation: make **+$3,000 within one month** to pass. Fee **£18**. Unlimited
  accounts purchasable.
- Funded: build a **$3,000 buffer** then withdraw, **$600 minimum payout**,
  **100% profit split**.
- Constraint throughout: **$2,000 TRAILING drawdown** on a $50,000 account. The
  firm offers no static-drawdown option. Trails on intraday unrealised equity.
- Contract cap: **6 E-mini NQ = 60 micros**. 40% consistency rule. No overnight holds.

**The correct objective is pass-probability per £18 attempt, not monthly income.**
Each evaluation is a call option with downside capped at the fee.

### The structural finding that governs everything

$3,000/month inside a $2,000 trailing drawdown requires a **Sharpe of roughly 9–13**.
That does not exist. Any strategy earning $3,000/month at daily frequency carries
$8,000–13,000 drawdowns. Do not try to solve this with a better strategy — it is an
arithmetic wall. The way through is many cheap accounts, not one big one.

---

## 2. Three investigations, three verdicts

### (a) Perera paper — FABRICATED, closed
*Volume Profile Mean Reversion with Tape Speed Confirmation*, L N H Perera, Jun 2026.
Claims +354%, Sharpe 3.98, 100% probability of profit on SOL/USDT.

- **Synthetic data** (§3.1), generated with mean reversion explicitly built in
  (~30-day half-life). Circular by construction.
- **Look-ahead bias** (admitted §5.4): target is the *current day's final* POC.
- On real MNQ: same code with the look-ahead gives $249,209 / PF 3.06; with an
  honest developing POC, PF 0.93. **92% of the paper's profit is the bias.**
- 238 honest configs swept: 16 profitable, 0 with t>2, **0 survived the $2,000 DD**.
  Median max drawdown $29,581.

**Do not revisit. Do not reuse its logic.**

### (b) From-scratch pre-registered search — REGIME ARTIFACT, closed
22 hypotheses pre-registered (see `PREREGISTRATION.md`), Benjamini–Hochberg FDR 0.10,
holdout locked 2025-01-01.

- One survivor: intraday momentum (first RTH hour continues to close), +14.6 net pts,
  t=2.96, 3/3 positive years, $2,317/month at 5 micros.
- **Could not fit the account at ANY size** — at 1 micro, max DD still $2,670.
- **Failed the holdout**: +$111.79/trade → −$8.81/trade.
- Every reversion effect (gap fade, value-area reversion, lunch reversion,
  extended-move fade) came in at or below zero.

**Do not re-run this search. More searching manufactures false positives.**

### (c) Aram's own method — THE LIVE HYPOTHESIS
The only thing with evidence pointing the right way. Details in §3.

---

## 3. THE METHOD (the live work)

### Fib convention — CONFIRMED from Aram's TradingView chart. Get this right.

```
level 1  = ORIGIN   (A)  — the sweep extreme, where price turned
level 0  = BREAKOUT (B)  — the structure level that got taken out
level -k = B + k * (B - A)      extensions run PAST the breakout, away from origin
```

An earlier reconstruction had this **inverted** (extensions measured back past the
origin). Everything computed under that convention answers a different question.
`manipulation.py` still uses the old convention — its base rates are valid, its
entry tests are not.

### Setup, as mechanised in `method.py`

1. **Asia range** = 00:00–06:00 London. Aram trades the 06:00 BST close; London and
   New York shift together so this is stable year-round.
2. Qualifies if the last 30 min are directionless — Kaufman efficiency ratio ≤ 0.30.
3. **Manipulation** = first break of the Asia range after the close. Its extreme = level 1.
4. **Break of structure** = price then takes out the **opposite** boundary = level 0.
   Sweep one side, break the other.
5. `leg = |B − A|`. Short the −2.0 extension, stop beyond −2.5, target back at level 1.
   Stop ≈ ½ leg, target ≈ 3 legs → RR ≈ 6.

### The reconstruction reproduces Aram's own numbers unprompted

| | measured | Aram stated |
|---|---|---|
| Setup frequency | 2.10/month | once every 10–14 days |
| Median stop (5 micros) | $226 | ≤ $250 |
| Median RR | 6.1 | ≥ 5 |

That three-way match is the main evidence the structure is right.

### What carries the edge: THE LOW VOLUME NODE

Volume profile from the last bar trading beyond −2.5 (within 3 sessions) to the BOS.
Entry zone scored as mean bin volume ÷ busiest bin.

| Filter | n | expR |
|---|---|---|
| Geometry alone, no LVN | 105 | **−0.21** |
| LVN ≤ 0.50 × POC | 30 | +0.87 |
| LVN ≤ 0.25 × POC | 24 | **+1.34** |
| LVN ≤ 0.15 × POC | 19 | +1.97 |

**Tertiles (no threshold fitted — the defensible result):**
emptiest third **+2.53R** (n=12, 50% win) · middle +0.16R · busiest third
**−1.02R (n=12, 0% win)**. Monotone.

Pearson(log volume, R) = −0.502, p=0.0018. Spearman ρ = −0.139, p=0.42. The
disagreement means the effect is carried by a few large winners — which at RR 6 is
the desired shape, not a defect.

### The 24 trades at 5 micros (`results/lvn_trades.csv`)

```
losses: -611 -365 -308 -272 -261 -260 -252 -241 -230 -205 -197 -177 -147 -127 -122 -101
wins:   1054 1114 1309 1316 1346 1549 1586 2044
```
Net +$7,442 · PF 2.92 · **max drawdown $1,030** (the first thing in the project that
fits the $2,000 limit) · 0.61 trades/month on NQ alone.

### What does NOT work (tested, negative — do not re-litigate)

- **Prior-day −2.5 condition** as a standalone filter: −0.84R on 39 trades, 2.6% win.
  It is not a filter; it is how the volume profile gets *located*.
- **Reactive zones** (FVG, order block, rejection wick, equal highs/lows on 1H/4H,
  unmitigated, no look-ahead): add nothing at any strictness. LVN alone +1.34R;
  LVN + any zone +1.23R; LVN + both timeframes +0.94R. Zones appear on 84% of setups
  at loose settings, so they cannot filter. Either they genuinely don't matter, or
  Aram's discretionary pick of the *most* reactive zone is judgement that can't be
  mechanised. 24 trades can't separate those.

---

## 4. Economics (simulated against the real 24-trade distribution)

Fee £18 ≈ $24. Break-even fee was computed at **$150**, so the margin is large.

**24-month campaign, 12 micros, 5 instruments, copy-traded, dead accounts replaced:**

| Accounts | Median months to 1st payout | 25th pct | $/month | Fees/mo |
|---|---|---|---|---|
| 1 | 5 | 3 | $1,188 | $7 |
| 3 | 4 | 3 | $3,405 | $20 |
| 5 | 4 | 3 | $5,428 | $32 |
| 20 | 4 | 3 | $16,689 | $106 |

**Buying more accounts multiplies the money, not the speed** — copy-traded accounts
all wait for the same trade. Staggering purchases one per month does decorrelate them
slightly, because the trailing drawdown is path-dependent on start date.

**The only lever on speed is trade frequency:**

| Instruments | Trades/mo | Median months to payout | $/month per account |
|---|---|---|---|
| 1 (NQ only) | 0.61 | **12** | $198 |
| 3 | 1.83 | 7 | $705 |
| 5 | 3.05 | 5 | $1,194 |
| 8 | 4.88 | **4** | $1,592 |
| 12 | 7.32 | 4 | $1,943 |

Smaller accounts ($1,500 target / $1,000 DD) do NOT pay out sooner — still 5 months,
half the money.

**Sensitivity to the true win rate** (95% CI from 8 wins in 24 trades is 17.2%–53.2%;
breakeven at RR 6 is 14.3%, so the *entire* interval is above breakeven):

| True win rate | $/month (1 account) | Median months to 1st payout |
|---|---|---|
| 40% | $1,727 | 4 |
| **33% (measured)** | **$1,022** | **6** |
| 28% | $629 | 7 |
| 22% | $310 | 9 |
| 17% | $136 | 10 |

**Agreed plan:** 3 accounts, staggered one per month, across 8 instruments. ~£70/month
at full tilt. Scale to 10–20 only after forward trades confirm the edge — scaling on
8 winning trades buys no extra certainty.

---

## 5. Data

### What exists
Aram's Databento pulls, uploaded as `.zst`: MNQ 1-minute, `GLBX.MDP3`, `ohlcv-1m`,
2022-08-04 → 2026-09-10, parent symbology (all contract months). Two files that agreed
on all 2,294,779 overlapping bars with **zero mismatches** — the data is verified good.

### Pipeline
```
.zst  --zstd_ctypes.py-->  raw CSV  --build_continuous.py-->  continuous front month
```
`build_continuous.py` does a volume-dominance roll with 2-day confirmation.
1,451,825 bars, 1,061 sessions, 17 quarterly rolls.

### What is needed next — THE BLOCKING ITEM
More instruments. **This is now down to one thing: a Databento API key.**

The network limitation is gone — this container reaches `hist.databento.com`, and
the fetch is mechanised in `databento_fetch.py`. The order spec above is encoded in
`instruments.py`, so the whole pull is:

```bash
export DATABENTO_API_KEY=db-...          # or put it in .env, which git ignores
python3 src/databento_fetch.py --cost GC CL ES   # price it first — free
python3 src/databento_fetch.py GC                # then pull
```

Order spec (continuous symbology — smaller files, and the roll is done for you):

- Dataset `GLBX.MDP3`, schema `ohlcv-1m`, `stype_in=continuous`
- Symbols: `GC.v.0`, `CL.v.0`, `ES.v.0`, `YM.v.0`, `RTY.v.0`, `NQ.v.0`
- Range 2022-08-04 → 2026-09-10
- `.v.` = volume roll (matches the hand-built roll rule)
- Databento gives **$125 free credits** to new accounts; pricing is per-GB, ~$8 per
  symbol for this. Should cost nothing.

`--cost` calls `metadata.get_billable_size` and `metadata.get_cost`, which are not
billed, so the price is known before any credit is spent.

**Priority: GC first** (gold — completely different driver, so its setups land on
different days), then CL, then ES. YM and RTY are highly correlated with ES/NQ and
add little. NQ full-size is only for a robustness re-check on deeper volume data.

If continuous symbology is used, `build_continuous.py` can be skipped or simplified.

### Contract specs needed for multi-instrument work

| | Full-size $/pt | Micro $/pt | Tick |
|---|---|---|---|
| ES | 50 | MES 5 | 0.25 |
| NQ | 20 | MNQ 2 | 0.25 |
| YM | 5 | MYM 0.50 | 1 |
| RTY | 50 | M2K 5 | 0.10 |
| GC | 100 | MGC 10 | 0.10 |
| CL | 1000 | MCL 100 | 0.01 |

Signals should be generated on **full-size** data (the volume profile is the edge and
micro volume is thin, especially in Asia hours for gold and crude). Execution stays in
micros.

---

## 6. Code map

| File | Purpose |
|---|---|
| `zstd_ctypes.py` | Decompress Databento `.zst` via libzstd + ctypes (no pip needed) |
| `build_continuous.py` | Raw CSV → continuous front-month series, volume roll |
| `engine.py` | Perera backtest engine (investigation a). `target_mode="lookahead"` reproduces the bias for comparison only |
| `stats.py` | Metrics incl. per-trade t-statistic |
| `sweep.py` | Parameter sweeps for (a) |
| `edge_probe.py` | Conditional forward-return test + random-direction control |
| `validate.py` | IS/OOS split validation |
| `features.py` | Per-session feature table (prior levels, Globex range, opening range, ATR) |
| `survey.py` | The 22 pre-registered hypotheses + Benjamini–Hochberg |
| `momentum.py` | Event-driven backtest of the survivor from (b) |
| `feasibility.py` | Year-by-year stability, sizing, evaluation Monte Carlo |
| `asia.py` | Asia session, consolidation, BOS base rates |
| `manipulation.py` | **OLD fib convention** — base rates valid, entry tests are not |
| `method.py` | **THE METHOD** — corrected convention, setup detection, trade resolution |
| `filters.py` | Prior-day condition + LVN volume-profile scoring |
| `reactive.py` | Reactive zone detection (FVG/OB/wick/equal highs) — tested, adds nothing |
| `portfolio.py` | Multi-account campaign simulation |
| `instruments.py` | Contract specs: tick, $/pt full and micro, Databento symbol |
| `databento_fetch.py` | Pull 1-min OHLCV straight from Databento into the continuous pickle |
| `../tests/test_pipeline.py` | Plants a known setup in synthetic GC/CL bars and checks the method finds it |

Run order for the live work:
```bash
python3 src/databento_fetch.py GC      # or the old path: zstd_ctypes.py + build_continuous.py
export NQ_INSTRUMENT=GC                # unset means NQ, which is what CLAUDE.md measures
python3 src/method.py                  # setup counts + entry-depth ladder
python3 src/filters.py                 # prior-day and LVN filters
python3 src/portfolio.py               # account economics (needs no bar data)
python3 tests/test_pipeline.py         # cross-instrument sanity check, no data needed
```

**`NQ_INSTRUMENT` selects the contract.** Unset it and everything behaves exactly as
it did when the numbers in section 3 were measured. `method.py` reads the bars from
`data/<key>_cont_1m.pkl`, falling back to the original `mnq_cont_1m.pkl` for NQ.

### One portability fix made when `instruments.py` was added

Three thresholds were denominated in **NQ points**: minimum leg 10, minimum stop 2,
and a 10-point volume-profile bin in `filters.py`. Gold ticks in 0.10 and crude in
0.01, so on those contracts a 10-point floor is 100x to 1000x too large and rejects
every setup that could ever occur — the run would have reported a confident **zero
setups** rather than an error. They are now expressed in **ticks** (40, 8 and 40),
which are the identical values on NQ and sane everywhere else.
`tests/test_pipeline.py` pins this: it plants a setup with known geometry in
synthetic GC and CL bars, checks the method recovers A, B, leg, both fib levels, the
direction and the micro-denominated P&L, and confirms the old floor returned zero on
crude.

---

## 7. Research discipline — non-negotiable

This project stayed honest because of these rules. Keep them.

1. **Pre-register before searching.** Hypothesis list, protocol, correction and
   decision rule written down *before* computing. See `PREREGISTRATION.md`.
2. **Record every deviation**, including ones that make the result weaker. See
   `DEVIATIONS.md` — it discloses that the survey was run once on a defective
   feature table before the fix, which means the discovery set is not strictly unseen.
3. **The holdout is spent once.** 2025-01-01 onward was used for investigation (b).
   **Do not re-test on it.** Carve a fresh holdout for new work.
4. **Correct for multiple testing.** Benjamini–Hochberg at FDR 0.10. Report the
   conservative version.
5. **Never report a threshold chosen after seeing the data as a finding.** The tertile
   split is the defensible form; the 0.15 LVN threshold is fitted and discounted.
6. **n=24 is n=24.** Every number in §3 is in-sample on 24 trades, 8 of them winners.
   No amount of further analysis of these four years changes that. Only forward trades do.
7. **Don't chase the target.** If the honest answer is "this doesn't reach $3,000/month,"
   say so. Three investigations produced two clean negatives and that was the value.

---

## 8. Open items

1. **Get GC data and run the method on it.** Highest value. Validates the pipeline on a
   second market and nearly doubles setup frequency. **Blocked only on a Databento API
   key** — the fetch, the contract specs and the cross-instrument fixes are all in place
   and tested. The moment the key exists this is three commands.
2. **Forward-test and log the LVN score at every setup**, including skipped ones. The
   only route from 24 trades to a real sample.
3. **Reactive zones** — tested and negative as mechanised. If Aram can define what makes
   one zone "the most reactive", that is worth one more attempt.
4. **Ask the firm** whether repeat attempts after a blow-up are unrestricted. Aram has
   confirmed unlimited concurrent purchases; re-attempt policy was never confirmed.
5. **Second TP / partial exits** — Aram mentioned experimenting with multiple take-profits.
   Never tested.

## 9. Published reports (self-contained HTML, also in `reports/`)

- The Tape Speed Audit — investigation (a)
- The Drawdown Ceiling — investigation (b) and the Sharpe 9–13 finding
- The Low Volume Node — investigation (c), the live hypothesis
