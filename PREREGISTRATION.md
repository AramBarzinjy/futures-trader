# Pre-registration — NQ intraday edge survey

Written **before** any result was computed. Fixing the hypothesis list, the test
protocol and the decision rule in advance is what stops a search from manufacturing
a finding. Any deviation from this document is recorded in `DEVIATIONS.md`.

## Objective

Determine whether any economically motivated intraday effect in Nasdaq-100 futures
carries a net edge large enough to matter for a $50,000 prop account with a $2,000
trailing drawdown.

**The bar.** $3,000/month at ~1 trade/day with 5 micros requires ~$143 net per trade
= **14.3 NQ points**. At ~3 trades/month it requires ~$1,000 net per trade = **100
points**. A candidate must clear the bar for its own trade frequency.

## Data and the holdout

- MNQ front-month continuous 1-minute, 4 Aug 2022 – 10 Sep 2026 (1,061 sessions).
- **Discovery set:** 2022-08-04 → 2024-12-31 (~600 sessions).
- **Holdout:** 2025-01-01 → 2026-09-10 (~440 sessions). Not examined until the
  hypothesis list is closed and the discovery results are final.
- Known contamination: aggregate yearly P&L of the *Perera* strategy on the holdout
  period was seen during the prior audit. No hypothesis below was derived from it.

## Hypotheses

Each is a directional signal with a defined trigger time. All are standard,
published intraday effects — none is an indicator search.

| ID | Family | Signal |
|----|--------|--------|
| A1 | Overnight gap | RTH opens beyond prior RTH close by > threshold → **fade** toward prior close |
| A2 | Overnight gap | Same condition → **continue** in the gap direction |
| B1 | Opening range | Break of the first 30-min RTH range → **continue** |
| B2 | Opening range | Break of the first 30-min RTH range → **fade** |
| C1 | Globex range | RTH breaks the overnight (18:00–09:30 ET) high/low → **continue** |
| C2 | Globex range | Same break → **fade** |
| D1 | Prior-day levels | RTH breaks prior session high/low → **continue** |
| D2 | Prior-day levels | Same break → **fade** |
| E1 | Time of day | First-hour RTH direction → **continue** into the close |
| E2 | Time of day | First-hour RTH direction → **fade** into the close |
| E3 | Time of day | Lunch (11:30–13:30 ET) drift → **fade** into the close |
| F1 | Extended move | Move > N × ATR from RTH open by 11:00 → **fade** |
| F2 | Extended move | Same condition → **continue** |
| G1 | Value area | Open outside prior day's value area → **revert** toward its POC |
| G2 | Value area | Open inside prior day's value area → **break out** in the open's direction |
| H1 | Calendar | Day-of-week directional drift |

Thresholds are fixed in advance at conventional values, not tuned: gap threshold
0.25 × ATR; extended-move threshold 1.0 × ATR; ATR = 14-session true range.

## Protocol

1. Every signal is evaluated only on the **discovery set**.
2. Forward return is measured in index points, signed in the signal's direction,
   from the trigger bar's close to the RTH close (and at fixed 30/60/120-minute
   horizons for shape).
3. Standard errors are **clustered by session** — overlapping windows are not
   independent observations.
4. Costs of **1.2 points round trip** (1 tick entry slippage + 2 ticks exit +
   $1.20 commission per micro) are deducted before a candidate is judged.
5. **Multiple-testing correction:** Benjamini–Hochberg across all hypotheses at
   FDR 0.10. A raw p-value that does not survive BH is not a finding.

## Decision rule — fixed in advance

A hypothesis is promoted to a full event-driven backtest **only if all four hold**:

1. Survives Benjamini–Hochberg at FDR 0.10 on the discovery set;
2. Net mean edge clears the bar for its trade frequency;
3. The effect is present in **at least 2 of the 3** discovery years (not one regime);
4. The sign is stable — no flipping between the first and second half of discovery.

Promoted candidates are then run **once** on the holdout. A candidate that fails on
the holdout is reported as failed. **The holdout is not re-used.**

## Declared expected outcome

Most published intraday effects in liquid index futures have decayed or were never
large net of costs. The probable result is that nothing clears the bar. That is a
valid and reportable finding, and it will be reported as such rather than met by
widening the search.
