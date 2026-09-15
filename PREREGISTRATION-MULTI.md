# Pre-registration — does the LVN method transfer to gold and crude?

Written **before** the GC and CL data was downloaded, and therefore before any
result on it was computed. The Databento pull was priced (`--cost`, an unbilled
metadata call) but not executed when this was fixed. Deviations go in
`DEVIATIONS.md`.

This is a companion to `PREREGISTRATION.md`, which covered the from-scratch NQ
survey (investigation b, closed negative). It covers different work: a
confirmatory test of one already-specified method.

---

## 1. What makes this different from a search

`PREREGISTRATION.md` registered a search over 22 hypotheses. **This registers no
search at all.** The method is already fully specified in `CLAUDE.md` §3 and
mechanised in `method.py` and `filters.py`. Not one parameter will be chosen,
tuned, or re-fitted on the new data.

That matters because gold and crude have never been looked at in this project.
Every bar of them is unseen. A fixed method applied once to unseen markets is the
strongest validation available short of forward trades — it is a genuine
out-of-sample test, not a fresh opportunity to find something.

The corollary is that the test is **spent on first use**. If any parameter is
adjusted after seeing GC or CL results, the result is void and must be reported
as void. ES is deliberately held back, untouched, as a reserve holdout for that
case.

## 2. The thing being tested, fixed in advance

Every value below is inherited from the NQ work. None is chosen for this test.

| Parameter | Value | Source |
|---|---|---|
| Asia window | 00:00–06:00 London | `CLAUDE.md` §3 |
| Consolidation filter | Kaufman efficiency ratio ≤ 0.30 over the last 30 min | §3 |
| Manipulation | first break of the Asia range after the close; extreme = A | §3 |
| Break of structure | the **opposite** boundary taken out = B | §3 |
| Entry | −2.0 extension, `B + d·2.0·leg` | §3 |
| Stop | beyond −2.5 | §3 |
| Target | level 1 (= A) | §3 |
| Minimum leg | 40 ticks | `DEVIATIONS.md` §5 |
| Minimum stop | 8 ticks | `DEVIATIONS.md` §5 |
| Volume-profile bin | 40 ticks | `DEVIATIONS.md` §5 |
| LVN profile window | last bar beyond −2.5, up to 2 sessions back, to the BOS | `filters.py` |
| LVN threshold | 0.25 × POC | §3 — **the NQ value, not re-fitted** |
| Size | 5 micros | §3 |
| Costs | 1 tick entry, 2 ticks on the stop, $1.20/contract round turn | `method.py` |

The three tick-denominated floors were converted from NQ points before any
non-NQ data existed, for the reason given in `DEVIATIONS.md` §5. On NQ they are
numerically identical to the originals.

## 3. Data

- `GC.v.0` and `CL.v.0`, `GLBX.MDP3`, `ohlcv-1m`, continuous (volume roll),
  2022-08-04 → 2026-09-10 — the same window as the NQ series.
- Signals are computed on **full-size** contracts and priced in **micros**
  (`CLAUDE.md` §5). MGC is $10/pt, MCL $100/pt.
- **No holdout is carved.** The entire GC and CL history is out-of-sample with
  respect to a method developed only on NQ, and n is the binding constraint —
  splitting would halve an already-small sample for no gain in honesty.

## 4. Power — declared before the fact, because it governs what a null means

The NQ result this is trying to replicate is weaker than its headline suggests:

```
n = 24 · mean +1.341R · sd 3.421 · t = 1.92 · p = 0.067 · win rate 33.3%
Cohen's d = 0.392
```

It does **not** clear conventional significance. Scaling NQ's rate (0.48 LVN
trades/month) to a four-year pull gives roughly 24 trades per new instrument, so:

| Test | expected n | power vs the full NQ effect | vs half of it |
|---|---|---|---|
| GC alone | ~24 | **45%** | 15% |
| CL alone | ~24 | **45%** | 15% |
| **GC + CL pooled** | **~48** | **~75%** | 27% |

A per-instrument test is therefore close to a coin flip and **cannot** support a
conclusion either way. This is why the primary endpoint below is pooled. Even
pooled, the test is underpowered against a halved effect, and that limit is
declared here so a null is not later read as a refutation.

## 5. Endpoints, in order, fixed in advance

**Primary.** Pooled across GC and CL, trades passing LVN ≤ 0.25 × POC: mean R
> 0, one-sided one-sample t-test, α = 0.05. One-sided because the NQ result fixes
the direction in advance. The two-sided p is reported alongside.

**Secondary 1 — tertile monotonicity.** Pooled GC+CL trades split into LVN
tertiles. On NQ the ordering was emptiest +2.53R, middle +0.16R, busiest −1.02R,
monotone. Tested with the Jonckheere–Terpstra trend test against the ordered
alternative, α = 0.05. This endpoint **fits no threshold** and is the more
defensible of the two; it is secondary only because it has less power.

**Secondary 2 — the filter does work.** expR of the LVN ≤ 0.25 subset exceeds
expR of the unfiltered geometry on the same market. On NQ that contrast was
+1.34 against −0.21. Reported as a difference with a bootstrap interval.

**Multiple testing.** Benjamini–Hochberg at FDR 0.10 across the primary and the
two secondaries. A raw p that does not survive BH is not a finding.

**Descriptive, no significance attached.** Per-instrument setup counts, trade
counts, frequency per month, win rate, median stop in dollars, median RR, and max
drawdown at 5 micros. Per-instrument R breakdowns are reported as *descriptive
only* and explicitly labelled underpowered.

## 6. Why the frequency numbers matter regardless of the outcome

`CLAUDE.md` §4 shows time-to-first-payout is driven almost entirely by trade
frequency: 1 instrument is a median 12 months, 5 instruments is 5 months. But
that table **assumes** every instrument fires at NQ's 0.61 trades/month. That
assumption has never been checked, and it is doing a lot of work.

Measuring GC and CL frequency directly replaces an assumption with a measurement
in the one model that drives the account plan. This is worth having even if the
edge test is inconclusive, and it is the reason to run this even given the power
problem in §4.

## 7. Decision rule — fixed in advance

- **Primary passes BH** → the method has replicated out-of-sample on markets it
  was never built on. This is a genuine strengthening of the live hypothesis.
  It still does not make n large: report the pooled n and keep §7.6 in force.
- **Primary fails, point estimate positive** → inconclusive, as §4 predicts is
  likely. Report as inconclusive. **Do not** tune, do not re-threshold, do not
  add instruments hunting for significance. The correct next step stays forward
  trading (`CLAUDE.md` §8.2).
- **Primary fails, point estimate negative on both markets** → evidence the NQ
  result was market-specific or a small-sample artifact. Report it plainly.
  Frequency numbers still stand and still feed `portfolio.py`.
- **The two markets disagree in sign** → treat as inconclusive, not as "it works
  on gold". Picking the winner after the fact is exactly the error this project
  has avoided three times.

## 8. Declared expected outcome

The honest prior is that this comes back **inconclusive**. The effect being
chased is d ≈ 0.39, measured once at p = 0.067 on 24 trades with a partly-fitted
threshold, and the replication is powered at ~75% against the optimistic case and
27% against a more realistic halved one. A positive point estimate that misses
significance is the single most likely result, and it will be reported as
inconclusive rather than dressed up.

The frequency measurement in §6 is the part of this work most likely to survive
contact with the data, and it is the part the account plan actually depends on.
