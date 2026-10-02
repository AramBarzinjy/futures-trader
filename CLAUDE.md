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

## 2. Six investigations

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

### (d) GC/CL transfer test — INCONCLUSIVE on edge, NEGATIVE on frequency
Pre-registered in `PREREGISTRATION-MULTI.md` **before the data was pulled**; run once
with every parameter fixed. Full verdict in §4a. Two separate outcomes:

- **Edge: inconclusive.** Every point estimate landed in the predicted direction
  (pooled +1.13R, tertiles monotone) but nothing survived Benjamini–Hochberg. Pooled
  n was **10**, not the projected 48, so realised power was **31%**. This neither
  confirms nor refutes the NQ result.
- **Frequency: a clear negative, and it is the decision-relevant one.** GC fires
  0.04 tradeable setups/month and CL 0.16, against NQ's 0.61. The §4 assumption that
  each new instrument contributes NQ's rate is **false**.

**Do not re-run this on GC or CL — they are spent.** ES has since been spent too — see (e).

### (e) Fibonacci entry sweep + ES holdout — WINNER'S CURSE, closed
A sweep of 8 Fibonacci entry levels × 3 instruments found −0.618 looked far better
than −2.0 (3.2× the trades, 1.75× the R/month). Pre-registered in
`PREREGISTRATION-FIB.md` and tested once on **ES**, the last unexamined market.

- **It did not survive.** −0.618's edge fell from +0.93R on NQ to **+0.14R on ES**
  (p=0.37). The R/month advantage failed (p=0.32). Only the mechanical fill-rate
  claim passed, as predicted.
- **−2.0 on ES was negative** (−0.18R, n=8). Neither level works on ES.
- Full detail in §4c.

**Every market is now spent.** Forward testing is the only remaining route.

### (f) Apex $50K Intraday search — NEGATIVE, closed
Aram asked for a new, broader NQ search against the real Apex Trader Funding
$50K Intraday rules. It used a walk-forward protocol, a locked holdout, a
research budget and cost stress tests. Protocol: `PREREGISTRATION-APEX.md`
(registry hash `c7805f7c88011621`), amended once before running (§12,
Amendment A). Full state in §4d.

- Run once on the MNQ file Aram supplied (2024-02 → 2026-09). Five of the eight
  hypotheses were testable. H3 needs ES bars, and H7/H8 need order-flow data.
- **No finalist and no BH survivor.** The best out-of-sample t was 1.00
  (overnight drift). Its top 1% of days carried 100% of its profit, and only
  one of four folds was positive.
- **The investigation stops here**, as registered. The 2026 holdout was never
  touched and is still unspent.
- The design could only detect daily Sharpe ≥ ~0.20. Smaller edges are "not
  detected", not "absent".

---

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

> **Superseded in part — read §4a.** The table below assumes every instrument fires
> at NQ's 0.61 trades/month. That assumption was tested on GC and CL and **failed**:
> they deliver 0.04 and 0.16. The rows below are upper bounds, not forecasts.

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

**Agreed plan — the "8 instruments" half no longer stands; see §4a.** 3 accounts,
staggered one per month. The account and staggering logic is unaffected, but the
8-instrument frequency it assumed is not supported: measured across NQ+GC+CL the
combined rate is 0.81 trades/month, not 4.88. ~£70/month at full tilt. Scale to 10–20 only after forward trades confirm the edge — scaling on
8 winning trades buys no extra certainty.

---

## 4a. The GC/CL transfer test — what it did and did not settle

Registered in `PREREGISTRATION-MULTI.md`, committed before the Databento pull. The
method was applied exactly as specified in §3 — no parameter re-fitted, no threshold
re-chosen. Deviations in `DEVIATIONS.md`. Reproduce with `src/transfer_test.py`.

### Result

| | setups/mo | filled | tradeable/mo | geometry expR | LVN ≤ 0.25 |
|---|---|---|---|---|---|
| NQ (reference) | 4.26 | 49% | **0.61** | −0.21 (n=105) | +1.34 (n=24) |
| GC | 2.14 | 20% | **0.04** | −0.71 (n=21) | +2.57 (n=2) |
| CL | 4.68 | 34% | **0.16** | −0.14 (n=79) | +0.76 (n=8) |

Registered endpoints, pooled GC+CL:

| Test | Result | BH crit | |
|---|---|---|---|
| Primary — pooled expR > 0 | +1.13R, n=10, t=1.01, p=0.170 | 0.100 | fail |
| Secondary 1 — tertile trend | z=+1.20, p=0.116 | 0.033 | fail |
| Secondary 2 — filter beats geometry | +1.32, 95% CI [−0.87, +3.66] | 0.067 | fail |

Tertiles were **monotone in the right order** (emptiest +0.56R, middle −0.15R,
busiest −1.07R), echoing NQ's shape. Geometry alone was negative on both markets,
as on NQ. Everything points the same way; nothing reaches significance.

### Why the edge question could not be settled

Pooled n was 10, not 48. Realised power **31%**. At the measured GC+CL rate,
reaching 80% power would need **~18 years** of data.

**This closes "validate the edge by adding instruments" as a strategy.** It cannot
work at these frequencies, no matter how many markets are added. Only forward
trades (§8.2) can grow the sample.

### The frequency finding — this one is solid and it changes the plan

Frequency is a **count**, not an effect estimate, so it does not suffer the power
problem. The geometry transfers fine — GC and CL produce setups at comparable rates
to NQ, with median legs of 81 and 61 ticks, well clear of the 40-tick floor. What
collapses is the **fill rate**: price reaches the −2.0 extension on only 20% of GC
setups and 34% of CL, against 49% on NQ.

Holding the edge at NQ's distribution — the **optimistic** case, since the edge test
was inconclusive — and varying only frequency:

| Scenario | trades/mo | median months to 1st payout | $/month |
|---|---|---|---|
| NQ only | 0.61 | 12 | $201 |
| §4 **assumed** 3 instruments | 1.83 | 7 | $719 |
| **NQ + GC + CL, measured** | **0.81** | **11** | **$275** |
| §4 **assumed** 5 instruments | 3.05 | 5 | $1,206 |

**Adding gold and crude buys one month, not five.** The §4 tables that scale NQ's
0.61 across 5, 8 and 12 instruments are unreliable — they assume a per-instrument
rate that does not hold for the two markets now measured. Treat every
multi-instrument row in §4 as an upper bound that has failed its first test.

---

## 4b. Position size and the 50% consistency rule

Reproduce with `src/constraints.py`. Neither was modelled in `portfolio.py`.

**Rule as confirmed by Aram: 50%, and it applies only once the evaluation is
passed** — the funded phase. An earlier version of this section modelled 40% across
both phases and was wrong; see `DEVIATIONS.md`. An earlier version also mixed two
simulation models with different horizons and recommended 20 micros. That was also
wrong. Both are corrected below, and everything here now comes from one model:
single account, 48-month horizon, no replacement.

### The two constraints pull in opposite directions

Constraint 1 (trailing drawdown) wants size **up** — too small and the $2,000
trailing limit grinds the account out before it reaches the buffer. Constraint 2
(consistency) wants size **down** — the funded leg needs $3,600, so any size whose
median win exceeds $1,800 puts one day over half the profit and forces the account
to keep trading to dilute it.

At the measured 0.81 trades/month, with the 50% rule enforced:

| micros | median win | % of leg | median months | account dies | effective months |
|---|---|---|---|---|---|
| **5** | $1,332 | 37% | 24 | **31%** | **35** |
| **8** | $2,130 | 59% | 16 | 55% | **35** |
| 12 | $3,196 | 89% | 11 | 75% | 44 |
| 20 | $5,326 | 148% | 7 | 89% | 64 |
| 60 | $15,978 | 444% | 5 | 99% | 444 |

"Effective months" is median months ÷ survival probability — months of attempts per
success. **5–8 micros is the flat optimum.** Larger size looks faster on the median
but only because the runs that die are excluded from it; on the survival-weighted
measure, 20 micros is nearly twice as expensive as 5 and 60 micros is catastrophic.

**P(payout within 2 months) never exceeds ~2% at any size at the measured rate.**
Two months is a tail outcome, not a plan.

Still assumed: that the rule measures the largest winning **day** against
accumulated **net** profit at payout. A per-trade or gross basis would shift these
numbers, though far less than the 40/50 error did.

---

## 4c. The Fibonacci sweep and what ES settled

Requested directly. Run as `src/fib_sweep.py`: 8 Fibonacci entry levels × NQ, GC, CL
× {geometry, LVN ≤ 0.25}. The stop keeps the method's own rule (half a leg beyond
entry) and the target stays at level 1.

### What the sweep showed

Two things move **monotonically** with entry depth, and they are mechanical and
trustworthy — on NQ, fill rate falls 85% → 22% and median RR rises 3.3 → 10.6 as the
entry goes from −0.618 to −4.236. Shallower entries fill far more often at lower RR.

**expR does not move monotonically.** Pooled across levels it reads 0.74, 0.40, 0.06,
0.85, 1.35, 0.32, 0.61, 2.47 — no structure. Level-to-level expR differences are
noise, and −0.618 vs −2.0 was never statistically distinguishable (diff −0.61R,
se 0.65, t = −0.94).

Of 41 cells with n ≥ 5, **9 survived Benjamini–Hochberg — but 7 of those were
significantly NEGATIVE.** Surviving BH means "reliably different from zero", not
"good". Only one positive cell survived: NQ at −0.618 (n=64, +0.93R, p=0.0010).

### The ES test — and it failed

−0.618 was the sweep's winner, chosen after seeing the data. `PREREGISTRATION-FIB.md`
registered a single test of it on ES, the last unexamined market.

| ES | fill | n (LVN) | trades/mo | win% | expR | R/month |
|---|---|---|---|---|---|---|
| −0.618 | 78% | 22 | 0.44 | 27.3 | **+0.14** | +0.06 |
| −2.000 | 43% | 8 | 0.16 | 12.5 | **−0.18** | −0.03 |

| Registered test | p | BH crit | |
|---|---|---|---|
| Primary — R/month higher at −0.618 | 0.322 | 0.067 | **fail** |
| Secondary 1 — ES −0.618 expR > 0 | 0.372 | 0.100 | **fail** |
| Secondary 2 — fill rate higher | 5.8e-10 | 0.033 | pass (mechanical) |

Per the decision rule in `PREREGISTRATION-FIB.md` §6: **both substantive endpoints
failed, so the sweep's winner was the winner's curse. The entry depth stays at −2.0
as specified in §3.**

### The most informative table in the project

Pooling every market at −0.618 by whether it helped build the strategy
(descriptive — computed after seeing ES, not a registered test):

| Market | n | win% | expR | p |
|---|---|---|---|---|
| NQ — **in-sample, developed on** | 64 | 45.3 | **+0.93** | 0.001 |
| GC — out-of-sample | 16 | 50.0 | +1.16 | 0.058 |
| CL — out-of-sample | 35 | 28.6 | +0.19 | 0.573 |
| ES — out-of-sample holdout | 22 | 27.3 | +0.14 | 0.743 |
| **ALL OUT-OF-SAMPLE POOLED** | **73** | **32.9** | **+0.39** | **0.114** |

**In-sample +0.93R → out-of-sample +0.39R.** The +0.54R gap is what was fitted
rather than found. The out-of-sample 95% CI is [−0.10, +0.88] — it includes zero.

This is not a refutation. n=73 is now the largest out-of-sample sample the project
has, the point estimate is positive, and at RR 3.3 the breakeven win rate is 23.3%
against an observed 32.9%. But the honest statement is: **the edge is probably real,
roughly half the size the in-sample number suggests, and still not demonstrated.**

---

## 4d. Apex $50K Intraday — what the rules alone establish

Rules: `src/apex_rules.py`. Each value has a source and a status. **Aram
trades with Apex Trader Funding** (confirmed 2026-09-30). Where §1 disagrees
with `apex_rules.py`, `apex_rules.py` governs.

**Confirmed by Aram:**
- drawdown: $2,000
- contract cap: 60 micros, in the evaluation and the PA
- payouts: 5 winning days after passing before a request, capped at $2,000 per request
- evaluation fee: about £18
- activation fee: about £40

**Still unconfirmed:** whether the evaluation has a minimum number of days (0 vs 7).

Mechanics as modelled: a +$3,000 target within 30 days. The $2,000 trail follows
peak **unrealised** equity and breaches on touch. The evaluation has no daily
loss limit. The PA has a $1,000 daily loss limit that pauses the day rather than
failing the account. A payout needs 5 days of ≥ $200 profit, a $52,100 safety
net, no single day ≥ 50% of profit since the last payout, $500 minimum, at most
6 payouts, 100% split, $2,000 cap per payout.

### What edge the account demands (`src/edge_map.py`, no market data)

Trades every session, $2,000 trail, size chosen optimally:

| Daily Sharpe | P(pass) | P(2+ payouts \| pass) | Net per attempt after both fees |
|---|---|---|---|
| 0 (no edge) | 12% | 10% | $43 |
| 0.10 (≈1.6 annualised) | 23% | 21% | $316 |
| 0.20 | 37% | 46% | $1,400 |
| 0.50 (≈8 annualised) | 75% | 86% | $6,922 |

(Corrected 2026-10-01 after the falling-threshold bug, DEVIATIONS.md §8.)

- **The optimal daily σ is about $500**, a quarter of the drawdown, at every edge
  level. Too small and the 30-day window runs out; too large and the trail kills it.
- **The brief's targets are unreachable.** A 70% pass rate and under 30% funded
  breach need a daily Sharpe near 0.5.
- **A zero-edge strategy nets about $43 per attempt after fees** in this
  model, which is near zero. The account is a call option, but a thin one. "Payouts exceed the fee" proves nothing. Gate G9 makes
  a strategy beat its own de-meaned copy.
- **A strategy trading on 25% of sessions passes ≤ 10% of the time, at any edge.**

### Null calibration (`wf.py --synthetic`, edge-free data)

Eight synthetic datasets were run through the full pipeline: four with costs,
four cost-free. Across 64 hypothesis tests there were **0 finalists and 0 BH
survivors**, and the best out-of-sample t was 1.23. On cost-free data the mean
sits slightly below zero. That is the engine's deliberate fill pessimism (stop
wins ties, limits need a trade-through) showing as a small, measurable drag.
**G9 alone fired once in 32 cost-free tests.** It takes the best of 90 size and
limit settings, so it is permissive by itself and must never be read without
G1–G8. Summary: `results/apex/null_calibration/summary.csv`.

### Investigation (f) result (`wf.py`, run once on MNQ 2024-02 → 2025-12)

258 out-of-sample sessions, baseline costs, $ per micro per day:

| Hypothesis | trades | mean/day | t | top 1% of days' share | folds + | verdict |
|---|---|---|---|---|---|---|
| H1 volume shock | 313 | −0.23 | −0.07 | — | 1/4 | fail |
| H2 VWAP reversion | 68 | +2.10 | 0.32 | 212% | 3/4 | fail |
| H4 compression break | 53 | −1.80 | −0.39 | — | 2/4 | fail |
| H5 08:30 news bar | 40 | +0.07 | 0.01 | 5,730% | 1/4 | fail |
| H6 overnight drift | 256 | +10.43 | 1.00 | 100% | 1/4 | fail |
| H3, H7, H8 | — | — | — | — | — | untestable (no ES, no order flow) |

G9 fired for H2 and H6, and still did after the simulator fix. As the null calibration warned, it is permissive alone:
it takes the best of 90 size settings. On records carried by a few days it
passes easily, and it is meaningless without G1–G8. Files:
`results/apex/gate_registered.csv`, `lifecycle_registered_*.csv`,
`ledger.jsonl`. The null calibration on the amended split
(`null_calibration_amendA/`) found 0 survivors in 32 tests, with a best t of 1.12.

### The evaluation playbook (`EVAL_PLAYBOOK.md`, `src/eval_plan.py`)

Aram asked for the best route to passing and a first payout *now*. With no
validated signal, the playbook fixes everything except direction, and
optimises it for Apex's rules on real MNQ paths from 2024-02 to 2025-12. The
2026 holdout is untouched. Direction is a coin flip, plus an optional "skill"
that picks the better side on a fraction of days. Each bracket's sample mean is
neutralised to minus costs, so no in-sample drift is planned on.

**The plan:**
- one MNQ trade a day at 09:31 ET
- a 60-point stop and a 60-point target, as a bracket
- flat by 15:55 ET
- 5 micros in the evaluation, 2 in the PA

It ranks first or near first in every scenario.

| Win rate | Pass in 30 days | Payout per attempt | £ fees per first payout |
|---|---|---|---|
| ~50% (no skill) | 15% | 3% | ~£780 |
| ~55% | 26% | 13% | ~£210 |
| ~60% | 40% | 33% | ~£100 |

**Dynamic sizing was tested and rejected** (`PREREGISTRATION-SIZING.md`,
`src/sizing_test.py`). Four cushion and target-aware rules lost to fixed 5
micros in all six cells (3 skill levels × 2024/2025 halves). Fixed 5 was also
stable across the halves: 3.2% / 3.2%, 13.9% / 13.4%, 32.0% / 32.7%.
`src/log_check.py` scores the log and applies the decision rule.

**The gate is Aram's logged directional win rate after 30 calls.** At 50% or
below, stop buying evaluations. Files: `results/apex/eval_plan*.csv`, and
`trade_log.csv` for the log.

### Aram's LVN method under Apex (`src/apex_lvn.py`)

This replays the 24 in-sample trades, with intraday paths assumed favourable,
under the confirmed rules. It is an upper bound.

| micros | P(pass) | P(2+ payouts \| pass) | median sessions to 1st payout | payouts/attempt | net after fees | same, edge removed |
|---|---|---|---|---|---|---|
| 12 | 10% | 6% | ~450 | $124 | $95 | $17 |
| **20** | **16%** | **4%** | **~480** | **$148** | **$117** | $48 |

**The $2,000 payout cap cut this by about 90%.** Uncapped, it was $1,493 per
attempt at 20 micros. Each capped request needs five more winning days, and at
about 0.5 trades a month that takes years. On Apex, this method is worth about
**$5 a month per evaluation bought**, even in-sample.

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
| `transfer_test.py` | Investigation (d): the pre-registered GC/CL test, endpoints and BH correction |
| `constraints.py` | Optimal position size, and the 50% consistency rule that `portfolio.py` omits |
| `fib_sweep.py` | Investigation (e): the method at every Fibonacci entry level, with BH |
| `apex_rules.py` | Investigation (f): Apex $50K Intraday rules, each with source and verification status |
| `apex_sim.py` | Apex lifecycle: evaluation, PA, payouts, on intraday paths with pessimistic in-bar order |
| `bt.py` | Deterministic 1-minute engine: pessimistic fills, trade-through limits, costs, slippage models |
| `hypotheses_f.py` | The 8 registered hypotheses and 46-variant grid, hashed |
| `wf.py` | Walk-forward runner, holdout lock, append-only ledger, gates G1–G9, `--synthetic` null calibration |
| `edge_map.py` | What daily Sharpe and σ the Apex rules demand, with no market data |
| `apex_lvn.py` | Aram's 24 LVN trades replayed under Apex rules |
| `synth.py` | Edge-free synthetic Globex bars for tests and the null calibration |
| `eval_plan.py` | Best size/bracket/limits for Apex with no edge, on real MNQ paths; `--final` for the chosen plan |
| `sizing_test.py` | Registered test of state-dependent evaluation sizing — rejected, fixed 5 stays |
| `log_check.py` | Scores `trade_log.csv`: win rate with 95% interval, playbook decision, account room |
| `../tests/test_apex.py` | Fill rules, look-ahead canary on every variant, Apex state machine |

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
   say so. Five investigations have produced three clean negatives, one inconclusive
   and one negative-on-frequency, and that was the value.
8. **A sweep winner is not a finding.** §4c is the worked example: −0.618 looked
   decisively better across 3 markets and 41 cells, and died on the one market that
   had no say in choosing it. Surviving Benjamini–Hochberg means "reliably non-zero",
   not "good" — 7 of the 9 survivors there were significantly *negative*.

---

## 8. Open items

00. **Aram runs `EVAL_PLAYBOOK.md` and logs every call in `trade_log.csv`.**
    After 30 calls, compute the win rate and apply the playbook's decision rule.

0. ~~**Investigation (f) needs data.**~~ **DONE — negative, see §2(f) and §4d.**
   If ES bars and NQ order flow are ever fetched, H3/H7/H8 could be run under
   the same frozen protocol. That would take a new registration and Aram's
   approval. The original data plan is kept below for reference:
   ```bash
   python3 src/databento_fetch.py --cost --start 2021-06-01 --end <latest> NQ ES
   python3 src/databento_fetch.py        --start 2021-06-01 --end <latest> NQ ES
   python3 src/databento_fetch.py --cost --delta --start 2021-06-01 --end <latest> NQ  # H7/H8 only if <= $100
   python3 src/wf.py                     # the registered run, once
   python3 src/wf.py --holdout           # only if wf.py wrote finalists
   ```
   Also have Aram confirm the rule rows still marked CONFLICT/UNKNOWN in
   `apex_rules.py`. The $2,000 drawdown is confirmed.

1. ~~**Get GC data and run the method on it.**~~ **DONE — see §4a.** Edge inconclusive
   (n=10, 31% power); frequency a clear negative (GC 0.04/mo, CL 0.16/mo vs NQ 0.61).
   GC and CL are spent as out-of-sample markets. ES is the untouched reserve holdout.
2. **Forward-test and log the LVN score at every setup**, including skipped ones.
   **Now the only remaining route.** §4a established that adding instruments cannot
   validate the edge — 80% power would need ~18 years at the measured rates. Forward
   trades are the sole way the sample grows. This is the highest-value open item.
2a. ~~**Re-examine the fill rate.**~~ **DONE — see §4c.** Shallower entries do fill far
   more often (78% vs 43% on ES, p=5.8e-10) but the extra trades did not carry an
   edge. Mechanical claim confirmed, economic claim rejected.
2b. ~~**Re-examine the entry depth.**~~ **DONE — see §4c.** The Fibonacci sweep found
   −0.618 and ES rejected it. Entry stays at −2.0. Every market is now spent.
3. **Reactive zones** — tested and negative as mechanised. If Aram can define what makes
   one zone "the most reactive", that is worth one more attempt.
4. **Ask the firm** — the consistency rule is now confirmed (50%, funded phase only),
   so what remains is smaller:
   - Does the 50% rule measure the largest **day** or the largest **trade**, and
     against **net** or **gross** profit? §4b assumes day-vs-net.
   - Whether repeat attempts after a blow-up are unrestricted. Unlimited concurrent
     purchases are confirmed; re-attempt policy was never confirmed.
5. **Second TP / partial exits** — Aram mentioned experimenting with multiple take-profits.
   Never tested.

## 9. Published reports (self-contained HTML, also in `reports/`)

- The Tape Speed Audit — investigation (a)
- The Drawdown Ceiling — investigation (b) and the Sharpe 9–13 finding
- The Low Volume Node — investigation (c), the live hypothesis

Investigations (d) and (e) have no reports yet. Their numbers are in §4a and §4c,
`results/transfer_*.csv` and `results/fib_sweep*.csv`, and reproduce from
`src/transfer_test.py` and `src/fib_sweep.py`.
