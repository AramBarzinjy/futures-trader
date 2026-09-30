# Pre-registration — investigation (f): an NQ intraday edge for Apex $50K Intraday

Written and committed **before any real market data for this investigation was
loaded**. The container this was written in holds no bar data at all (see §2), so
nothing below was chosen after seeing an NQ or ES result. Deviations go in
`DEVIATIONS.md` under "Investigation (f)".

REGISTRY_SHA: `c7805f7c88011621`

`src/wf.py` refuses to run if the hypothesis grid in `src/hypotheses_f.py` no
longer hashes to that value. Changing a grid is therefore a visible deviation,
never a quiet edit.

---

## 0. Why a new search, and what it must not repeat

`CLAUDE.md` §2(b) records that a 22-hypothesis NQ search found nothing and warns
that more searching manufactures false positives. Aram has now asked explicitly
for a new, broader search with a stricter protocol: a walk-forward framework, a
locked holdout, a research budget, cost stress tests and the real Apex rules.
That is his call, and this document is the protocol for it. The concern is
answered by design, not by refusing:

- **No hypothesis already tested is re-tested.** Excluded: the 16 effects in
  `PREREGISTRATION.md` (gap fade/continue, 30-min opening-range break, Globex
  range break, prior-day level break, first-hour momentum, lunch reversion,
  extended-move fade/continue, value-area reversion/breakout, day-of-week), the
  Perera volume-profile strategy (investigation a), and Aram's own Asia-range /
  low-volume-node method (investigation c). That method stays in forward testing
  as `CLAUDE.md` §8.2 says. It is not re-optimised here.
- **The search is small and closed.** 8 hypotheses, 46 variants, fixed below.
- **Every result is counted.** Benjamini–Hochberg uses the 8 registered
  hypotheses as its denominator even if some cannot be tested.

## 1. Objective and the firm

Find out whether any objectively testable intraday effect in NQ survives
out-of-sample testing strongly enough to be worth an Apex $50K Intraday
evaluation, and if so at what size and with what internal limits.

The Apex rules are encoded with their provenance in `src/apex_rules.py`. Apex's
own site blocks this container behind Cloudflare, so rules were read from the
search-indexed text of the official help-centre pages. Summary:

| Rule | Value | Status |
|---|---|---|
| Profit target | +$3,000 | derived from official arithmetic |
| Trailing drawdown | **$2,000**, on peak **unrealised** equity, breach on touch | **conflict** — one page implies $2,500 |
| Eval threshold lock | $53,000 | official |
| Eval daily loss limit | none | official |
| Eval time limit | 30 days | official |
| Eval minimum days | 0 | **conflict** — an older page says 7 |
| Contract cap | 10 micros per mini | 4 minis assumed, **unknown** |
| PA threshold lock | $50,100 | official |
| PA daily loss limit | $1,000, pauses the day, not a failure | official |
| PA payout eligibility | 5 days of ≥ $200 profit | official |
| PA safety net | $52,100, for life | official |
| PA consistency | no day ≥ 50% of profit since last payout | official |
| PA minimum payout / maximum count / split | $500 / 6 / 100% | official |
| Flat by | 16:59 ET (internal: 16:55) | official |
| Commission, Tradovate | NQ $3.10, MNQ $1.04 round turn | official |

Every CONFLICT and UNKNOWN row is simulated both ways where it matters. It must
be confirmed in writing by Aram before money is spent (brief, Step 8).

## 2. Data

| | |
|---|---|
| Instrument traded | NQ, executed and priced in MNQ ($2/pt, $1.04 round turn) |
| Signal data | **Full-size NQ** 1-minute OHLCV, Databento `GLBX.MDP3`, `NQ.v.0` |
| Comparison market | Full-size ES `ES.v.0`, priced as MES ($5/pt), for G8 only; also an input to H3 |
| Order flow | 1-minute aggressor delta from the Databento `trades` schema (H7, H8 only) |
| Tradeable window | 2021-10-01 → latest available session (5 years) |
| Warm-up | from 2021-06-01, so 60-session lookbacks exist on day one |
| Session | full CME Globex session, 18:00–17:00 ET, CME session-date convention |

**No data exists in this container.** The MNQ files from earlier investigations
were never committed, and they cover 2022-08 onward, which is too short. They
also carry micro volume, which is too thin to read. The whole pull is one
command once a Databento key is present:

```bash
python3 src/databento_fetch.py --cost  --start 2021-06-01 --end <latest> NQ ES   # free
python3 src/databento_fetch.py         --start 2021-06-01 --end <latest> NQ ES
python3 src/databento_fetch.py --cost --delta --start 2021-06-01 --end <latest> NQ
python3 src/databento_fetch.py --delta --start 2021-06-01 --end <latest> NQ    # only if affordable
```

**Order-flow data budget.** H7 and H8 are tested only if the trades-schema pull
prices at **≤ $100** of Databento credit. Otherwise they are recorded as
*untestable within budget*. They still count in the BH denominator and are not
dropped from the report.

## 3. The split

A hybrid walk-forward: rolling 24-month development windows, each followed by a
6-month validation window the development step never saw. After that comes one
final holdout.

| Fold | Development | Validation |
|---|---|---|
| 1 | 2021-10-01 → 2023-09-30 | 2023-10-01 → 2024-03-31 |
| 2 | 2022-04-01 → 2024-03-31 | 2024-04-01 → 2024-09-30 |
| 3 | 2022-10-01 → 2024-09-30 | 2024-10-01 → 2025-03-31 |
| 4 | 2023-04-01 → 2025-03-31 | 2025-04-01 → 2025-09-30 |
| **Holdout** | — | **2025-10-01 → latest** |

The four validation windows stitch into 24 contiguous out-of-sample months.

**The holdout lock is in code.** `wf.py` deletes every session on or after
2025-10-01 at load time. `--holdout` refuses to run without a finalists file
written by the registered run. It refuses a second time, because the ledger
records the first.

**Contamination disclosure.** 2025-01-01 → 2026-09-10 was the holdout for
investigation (b) and part of the development data for investigation (c). The
project has therefore seen that stretch, though only through the specific
effects listed in §0, all of which are excluded here. So the holdout is unseen
*by these hypotheses*, but not by the project. The cleanest test left is time
that has not happened yet: **forward paper trading from 2026-10-01** (§9). That
is the binding test for anything that reaches it.

## 4. Execution model (`src/bt.py`)

- Bars are stamped at the open. A signal from bar *i* acts at the open of *i+1*.
  Every hypothesis is checked for look-ahead by a test that corrupts all later
  bars and requires earlier orders to be unchanged. A deliberate one-bar peek is
  included as a canary, to prove the test can fail.
- Market orders fill at the next open. Stop orders fill at the worse of the stop
  and the open. **Limit orders fill only on a one-tick trade-through**, on a bar
  with volume. OHLCV carries no queue position, so touch fills are excluded, not
  assumed.
- A stop and target in the same bar resolve to the **stop**. On a stop- or
  limit-entry bar the stop is checked and the target is not. A two-sided bracket
  hit on both sides in one bar fills the side the bar closes against.
- Stops that are gapped through fill at the open. Targets fill at the target,
  never better.
- Time exits and the 16:55 ET flatten fill at the bar close. One position at a
  time, and exits resolve before entries.
- VWAP falls back to TWAP where cumulative volume is zero. Zero-volume bars
  cannot fill limits.

**Costs.** The baseline is 1 tick of slippage per side on market and stop fills,
plus $1.04 round-turn commission per micro. The **stress** case (gate G5) is
2 ticks plus double commission. Also reported, but not gated: 3 ticks, 4 ticks,
and a volatility-dependent model of 1 tick plus 1 tick per 20 ticks of the fill
bar's range.

## 5. The hypotheses (`src/hypotheses_f.py`)

Units: D is the median full-session range of the prior 20 sessions. Times are
ET. All lookbacks are stated in minutes, so each rule runs unchanged on 5-minute
bars.

| ID | Family | Rule | Grid | n |
|---|---|---|---|---|
| H1 | volume | Volume shock: bar volume ≥ k × median volume for that minute over the prior 20 sessions, and body ≥ 0.02 D. Trade next bar; stop 0.05 D, target 0.10 D, exit after 30 min | k ∈ {4, 8} × window {RTH, ALL} × {continue, fade} | 8 |
| H2 | volume/price | Anchored VWAP ± z weighted-sd bands. On a cross, fade toward VWAP; target is VWAP, stop is half the distance to VWAP, exit after 60 min | z ∈ {2.0, 2.5, 3.0} × anchor {09:30, 18:00} | 6 |
| H3 | cross-market | NQ−β·ES spread over L min, z-scored on the prior 20 sessions. Trade NQ against or with it; stop and target 0.04 D, exit after L min | L ∈ {15, 60} × z ∈ {2, 3} × {fade, follow} | 8 |
| H4 | volatility | Overnight range ≤ its q-quantile over the prior 60 sessions. Two-sided stop bracket beyond the overnight high and low, 09:30–11:30; stop at the midpoint, target target_R × risk, flat 15:55 | q ∈ {0.20, 0.33} × target_R ∈ {1.5, 3} | 4 |
| H5 | event / time of day | 08:30 bar range ≥ m × its 20-session median. Trade at 08:31 with or against the bar; stop 1.0 × range, target 1.5 × range | m ∈ {2, 4} × {continue, fade} × exit {09:29, 10:30} | 8 |
| H6 | time of day | Overnight drift: long between two fixed times, protective stop 0.10 D | {18:00–09:25, 18:00–02:00, 02:00–09:25, 02:00–04:00} | 4 |
| H7 | order flow | New L-min high while 15-min delta < 0 (or < −1 sd). Short, mirror at lows; stop 0.02 D beyond the extreme, target 0.08 D, exit after 60 min | L ∈ {30, 60} × {zero, −1 sd} | 4 |
| H8 | order flow | 5-min delta ≥ z sd and the close breaks the 30-min range. Continue; stop 0.04 D, target 0.08 D, exit after 30 min | z ∈ {2, 3} × window {RTH, ALL} | 4 |

**46 variants in total.** Signal windows and per-session trade caps are in the
code and are part of the hash.

## 6. Selection inside each fold

For each hypothesis and each fold, choose the variant with the highest
development-window t-statistic of daily P&L, among variants with ≥ 30 development
trades. If no variant qualifies, the fold contributes flat days. **Only the
chosen variant's validation window is ever computed.** Every development trial is
written to `results/apex/ledger.jsonl` with its date window, parameters and
metrics.

## 7. The screening gate — applied to the stitched 24-month out-of-sample record

The brief's gate is a floor. It is not, by itself, adequate here:

- **"t > 1.5 on development" is meaningless after selection.** For null variants,
  the chance that the best of *k* exceeds 1.5 is 24% at k = 4, 43% at k = 8 and
  **96% across all 46**. So development t is used only to pick a variant, never to
  pass one.
- **Power.** With ~500 out-of-sample sessions, 80% power at the BH-adjusted
  threshold (t ≈ 2.24 for the top rank of 8) needs a daily Sharpe of about
  **0.14**, roughly 2.2 annualised. Smaller edges are invisible to this design.
  §8 shows they are also nearly worthless under Apex rules, so the two limits
  line up.

A hypothesis becomes a **finalist** only if every one of these holds:

| Gate | Test |
|---|---|
| G1 | out-of-sample mean daily P&L > 0, net of baseline costs |
| G2 | out-of-sample t > 2.0 **and** survives BH at FDR 0.10 across the 8 registered hypotheses (one-sided) |
| G3 | the top 1% of out-of-sample days carry < 50% of net profit |
| G4 | positive mean in ≥ 3 of the 4 validation folds |
| G5 | out-of-sample mean still > 0 under the stress costs |
| G6 | parameter stability: on average ≥ half of the chosen variant's one-step grid neighbours are profitable in development |
| G7 | second timeframe: the same selections run on 5-minute bars are profitable out of sample |
| G8 | second market: the same selections run on ES are profitable out of sample (not applicable to H3, or to H7/H8 without ES delta) |

Also reported, but not gated: Sharpe, max drawdown, win rate, longest losing
streak, profitable years, and the 3-tick, 4-tick and volatility-dependent cost
cases.

**Null calibration.** `wf.py --synthetic N` runs the entire pipeline on
edge-free synthetic data. It measures how often this gate passes something with
nothing in it. Its results are published beside the real run.

## 8. The economic gate — what the Apex rules demand (`src/edge_map.py`)

This was computed from the rules alone, before any data. The lifecycle
simulator replays trading days with their intraday excursions. The threshold
trails peak unrealised equity, and within each bar the favourable print is
assumed to come first. With a $2,000 trailing drawdown and trades on every
session:

| Daily Sharpe | Optimal daily σ | P(pass) | P(2+ payouts \| pass) | Payouts per attempt |
|---|---|---|---|---|
| 0 (no edge) | ~$500 | 14% | 18% | $157 |
| 0.05 | ~$500 | 19% | 34% | $381 |
| 0.10 | ~$500 | 26% | 41% | $783 |
| 0.20 | ~$500 | 40% | 65% | $2,427 |
| 0.50 | ~$500 | 80% | 93% | $10,363 |

Four consequences are registered as part of the protocol:

1. **The brief's lifecycle targets are out of reach.** A 70% pass rate needs a
   daily Sharpe near 0.5, about 8 annualised. They are reported, not gated.
2. **A zero-edge strategy has positive gross value per attempt**, because the
   account is a call option. So "payouts exceed the fee" proves nothing. **G9:** a
   finalist's expected payouts per attempt must exceed those of the **same
   strategy with its mean removed**, at the same size and limits, by more than
   twice the Monte Carlo standard error.
3. **Size is not free.** Daily σ near a quarter of the drawdown is optimal at
   every edge level. The internal controls tested are micros 1–40, an internal
   daily loss limit of none, $400 or $800, and a daily profit cap of none, $600
   or $1,200. The choice is made on the validation bootstrap and replayed once on
   the holdout.
4. **Low frequency cannot pass a 30-day evaluation.** A strategy that trades on
   25% of sessions passes ≤ 10% of the time even at a daily Sharpe of 0.5.

## 9. Holdout and forward test

- **Holdout (once, finalists only):** the most recent fold's selected parameters
  and the controls chosen in §8, frozen. The holdout passes if the mean is > 0,
  t > 1.5, the top 1% of days carry < 50%, and G9 holds. With ~250 sessions,
  80% power at t = 1.5 needs a daily Sharpe of about 0.15. That is stated now so
  that a weak holdout cannot later be explained away as bad luck.
- **Forward test:** at least 60 sessions of paper signals, logged in real time,
  including skipped ones, before any recommendation to buy an evaluation.
- **No live trading, and no purchase, without Aram's explicit approval.**

## 10. Research budget and stopping rule

- **Budget:** 8 hypotheses, 46 variants. A reserve of 10 variants exists only for
  deviations of the kind recorded in `DEVIATIONS.md` §1. Any use of it is
  disclosed and counted.
- **If no hypothesis is a finalist, the investigation stops.** The result is
  reported as negative. No new hypotheses are added to this investigation. A new
  idea needs a new pre-registration and Aram's approval.
- **If a finalist fails the holdout, it is reported as failed.** It is not
  re-tuned.

## 11. Declared expected outcome

Given the project's record, three clean negatives in five investigations, and
the thinness of published intraday effects in index futures net of costs, **the
most likely result is no finalist.** That result will be reported as the
finding.
