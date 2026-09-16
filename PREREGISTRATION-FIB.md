# Pre-registration — is the −0.618 entry real, or is it the sweep's winner's curse?

Written **before** ES data was fetched and therefore before any ES result existed.
`PREREGISTRATION-MULTI.md` §1 reserved ES as the untouched holdout for exactly this
case, and `CLAUDE.md` §8.2a named entry depth as the tuning decision that would need
one. This spends that reserve. Deviations go in `DEVIATIONS.md`.

---

## 1. Where the hypothesis came from, stated plainly

From a **post-hoc sweep** (`src/fib_sweep.py`, results in `results/fib_sweep.csv`):
8 Fibonacci entry levels × 3 instruments × 2 filters. The −0.618 entry was the best
positive cell. That is the definition of a threshold chosen after seeing the data,
which `CLAUDE.md` §7.5 forbids reporting as a finding.

It is not pure noise-mining, and the distinction matters:

- **A mechanical motivation existed first.** §4a found the −2.0 entry fills on 49%
  of NQ setups, 20% of GC and 34% of CL, and identified that fill rate as why the
  transfer test ran out of sample. "Is the entry too deep" was the obvious next
  question, asked before the sweep was run.
- **Fill rate and RR move monotonically** with depth (NQ fill 85→22%, RR 3.3→10.6).
  Those are mechanical and trustworthy.
- **expR does not.** Pooled across levels it goes 0.74, 0.40, 0.06, 0.85, 1.35,
  0.32, 0.61, 2.47 — no structure. Level-to-level expR differences are noise, and
  −0.618 vs −2.0 is **not statistically distinguishable** (diff −0.61R, se 0.65,
  t = −0.94).

So the claim under test is deliberately **not** "−0.618 has a better edge".

## 2. The hypothesis, fixed in advance

**−0.618 earns more R per month than −2.0, because it trades far more often at a
statistically indistinguishable per-trade edge.**

Measured on the sweep data: −0.618 gives 2.30 trades/month at +0.74R = **+1.70
R/month**; −2.0 gives 0.72 trades/month at +1.35R = **+0.97 R/month**, a ratio of
1.75. Frequency is a count and is well measured; expR is not. The hypothesis rests
on the half that is well measured.

### Parameters, all inherited, none re-fitted

| Parameter | Value |
|---|---|
| Entry | −0.618 extension |
| Stop | −1.118 (the method's own "half a leg beyond entry", as −2.0/−2.5) |
| Target | level 1 (= A) |
| LVN threshold | 0.25 × POC — the NQ value, unchanged |
| Everything else | exactly as `CLAUDE.md` §3 and `DEVIATIONS.md` §5 |

## 3. Data

`ES.v.0`, `GLBX.MDP3`, `ohlcv-1m`, continuous, 2022-08-04 → 2026-09-10. ES has
**never been examined in this project** — not in investigations (a)–(d), not in the
fib sweep. It is the last clean market available.

## 4. Endpoints, fixed in advance

**Primary.** On ES, R/month at −0.618 exceeds R/month at −2.0. Both computed on the
same ES sessions with the LVN ≤ 0.25 filter. Compared by bootstrap over trades
(20,000 resamples), one-sided, α = 0.05.

**Secondary 1.** ES −0.618 mean R > 0, one-sided t-test.

**Secondary 2.** ES fill rate at −0.618 exceeds that at −2.0 — the mechanical claim.
This should hold almost by construction; if it fails, something is wrong with the
pipeline rather than with the hypothesis.

**Correction.** Benjamini–Hochberg at FDR 0.10 across the three.

## 5. Power, declared in advance

NQ gave 3.62 geometry trades/month at −0.618 and 64 LVN trades over 50 months. If ES
behaves like NQ, expect **50–70 LVN trades** — the largest single-market sample this
project has ever had, and roughly 3× the 24 that everything currently rests on.

At d = 0.39 (the NQ effect size), n = 60 gives ~**85% power** on Secondary 1. The
primary is a difference-of-rates test and is weaker; a null there is not decisive.

If ES yields fewer than 20 LVN trades at −0.618, the test is underpowered and
**that will be reported instead of a verdict**, as happened in §4a.

## 6. Decision rule — fixed in advance

- **Primary passes BH** → −0.618 earns more per month on a market never looked at.
  That is a genuine out-of-sample result and the entry depth should change. It still
  does not mean the per-trade edge is larger; the claim remains about frequency.
- **Primary fails, Secondary 1 passes** → the method works at −0.618 on ES but the
  advantage over −2.0 is unproven. Keep −2.0 as specified. Report honestly.
- **Both fail** → the sweep's winner was the winner's curse. Revert to §3 unchanged
  and record that the sweep produced nothing.
- **Fewer than 20 trades** → underpowered, no verdict, no change.

**There is no second attempt.** ES is the last unexamined market. If this fails,
there is nothing left to validate on and forward testing (§8.2) is the only route.

## 7. Declared expected outcome

Secondary 2 (fill rate) will pass; it is near-mechanical. Secondary 1 has a
reasonable chance given the sample size. **The primary is genuinely uncertain** — it
is asking whether a 1.75× R/month advantage, measured on data where the sweep chose
the winner, survives on a market that had no say in choosing it. A sweep winner
typically regresses. Expect the advantage to shrink; the question is whether it
survives at all.
