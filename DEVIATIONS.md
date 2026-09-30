# Deviations from PREREGISTRATION.md

Recorded so the search can be judged on what actually happened rather than on the
tidied-up version.

### 1. Extended-move threshold — extra hypotheses added before any result was seen

The registered threshold of 1.0 × ATR produced only 11 observations in discovery
(ATR here is the average *daily* true range, ~274 points, so a 1.0 × ATR move by
11:00 is a rare day). A 0.5 × ATR variant was added (F3/F4). Both were kept and both
counted in the multiple-testing correction, so the extra test is paid for rather than
swapped in. F1/F2 are reported as untestable.

### 2. Survey was run once on a defective feature table

The first run covered only 264 discovery sessions: a NaN true-range on roll days
propagated through a 14-period rolling mean and silently discarded 564 sessions. The
bug was fixed (fall back to the session's own range where no prior close exists) and
the survey re-run on the full 601 sessions.

**Disclosure:** that defective run's output was seen before the corrected run. The
hypothesis list was fixed beforehand and was **not** changed as a result, and no
threshold was altered. But the discovery set is no longer strictly "unseen", and the
corrected run is not fully independent of the first. The holdout was untouched
throughout, and it remains the binding test.

### 3. Mirror hypotheses collapsed at reporting time

A1/A2, B1/B2, C1/C2, D1/D2, E1/E2 and F3/F4 are the same effect tested in both
directions, so a "fade" hypothesis reaching significance with a negative mean is the
same fact as its "continuation" twin being positive — not a second discovery. They
are collapsed to one effect each when reporting, with the sign carrying the
direction. The Benjamini–Hochberg correction is reported **both** ways: over all 20
tests (conservative, as registered) and over the 12 collapsed effects (correctly
specified, less strict). Nothing is claimed that fails the conservative version.

### 4. The profit bar is evaluated per trade frequency, not as a single number

The registered bar (14.3 points at ~1 trade/day) only applies to daily-frequency
signals. For a signal that fires weekly, the same $3,000/month requires roughly 5×
the per-trade edge. The bar is therefore computed per hypothesis as
`trades_per_month × net_points × $2 × contracts ≥ $3,000`. This is a clarification of
the registered rule rather than a loosening of it.

### 5. Size thresholds re-expressed in ticks when the work went multi-instrument

`method.py` rejected any setup whose leg was under 10 or whose stop was under 2, and
`filters.py` built the volume profile in 10-wide bins. All three numbers were in NQ
points. Gold ticks in 0.10 and crude in 0.01, so carried across unchanged the leg
floor is 100x and 1000x too large and rejects every setup those markets can produce —
the run returns an empty frame and reports zero setups, which reads like a finding
rather than a bug.

They are now stated in ticks: 40, 8 and 40. On NQ (tick 0.25) those are exactly 10,
2 and 10 points, so **no NQ number changes** — verified by asserting the constants
directly. Nothing else in the entry, stop, target or filter logic was touched.

This is a portability fix, not a result. It was made before any non-NQ data existed,
so no threshold here was chosen after seeing a result, and the tick counts are
inherited from NQ rather than fitted. Whether 40 ticks is the right floor *for gold*
is an open question that only gold data can answer; it is recorded here so that if
it is ever tuned, the tuning is visible as tuning.

---

# Deviations from PREREGISTRATION-MULTI.md (the GC/CL transfer test)

### 1. The realised sample was 5x smaller than registered, and the test was far weaker than declared

`PREREGISTRATION-MULTI.md` §4 projected ~24 LVN trades per instrument and a pooled
n of ~48, giving ~85% power against the full NQ effect. The realised pooled n was
**10** — GC contributed 2 and CL 8 — for **31% power**.

Nothing was changed to produce this; it is what the fixed method did on the new
data. But it means the registered power table was wrong, and the primary endpoint
was decided in a regime where a null carries almost no information. The declared
limit in §4 ("even pooled, the test is underpowered against a halved effect") was
already conservative and still understated the problem.

The projection failed because it scaled NQ's 0.48 LVN trades/month across markets.
That scaling is the assumption this work set out to check, so its failure is a
result rather than an error — but it should have been flagged in §4 as the
projection's single load-bearing assumption, and it was not.

**Reaching 80% power at the measured GC+CL rate would take ~18 years of data.** The
"validate the edge by adding instruments" route is therefore closed on power
grounds, not just on this sample.

### 2. No parameter was changed, and the test is now spent

Every value in `PREREGISTRATION-MULTI.md` §2 was used as registered. The 0.25 LVN
threshold was not re-fitted, no window was adjusted, and no market was dropped or
added after seeing a result. The endpoints, the one-sided direction, and the
Benjamini–Hochberg correction are as registered.

Per §1, GC and CL are now spent as out-of-sample markets. **ES remains untouched**
and is the reserve holdout.

### 3. A post-hoc diagnostic was run, and is reported as diagnostic

After the endpoints were computed, the setups were re-counted by rejection reason
to explain the small n (fill rate, and whether a volume profile was computable).
This was run *after* seeing the primary result, so it is exploratory. It changed no
parameter and is reported as a mechanism, not a finding. It is the basis for the
frequency conclusion, which rests on counts rather than on any effect estimate.

### 4. Frequency was measured; the edge was assumed unchanged, which favours the strategy

The portfolio re-run holds the edge distribution at NQ's 24 trades and varies only
trade frequency. Since the GC/CL edge test was inconclusive, assuming the NQ edge
transfers intact is the **optimistic** case. The frequency conclusion is therefore
an upper bound on how well the multi-instrument plan performs, not a central
estimate.


---

# Deviations from PREREGISTRATION-FIB.md (the −0.618 entry test on ES)

### 1. ES yielded 22 LVN trades, not the 50–70 projected

§5 projected 50–70 by scaling NQ's rate. ES gave **22** at −0.618 and 8 at −2.0, so
Secondary 1 ran at roughly 45% power rather than 85%. This is the second time a
projection scaled from NQ has over-estimated another market's trade count by 2–3×
(the first is recorded above for GC/CL), and the pattern should be assumed from now
on: **NQ produces more tradeable setups than any other market tested.**

22 clears the 20-trade floor §5 declared, so the test stands rather than being voided
— but the primary (a difference-of-rates test, explicitly weaker) was underpowered
and its failure is correspondingly weak evidence. Secondary 1's failure is the more
informative of the two.

### 2. Nothing was tuned, and ES is now spent

The parameters in §2 were used exactly as registered. The verdict follows §6's
decision rule mechanically: both substantive endpoints failed, so the entry stays at
−2.0 and the sweep is recorded as having produced nothing.

ES was the last unexamined market. There is no reserve left.

### 3. The pooled out-of-sample table was computed after seeing ES

The table in `CLAUDE.md` §4c pooling NQ/GC/CL/ES by in-sample status was built after
the ES result was known and is **not** a registered test. It is reported as
descriptive. It is also the single most informative number in the project, so it is
kept — but it must not be cited as a confirmatory result.

---

# Deviation from the 40% consistency model (correction)

An earlier version of `constraints.py` and `CLAUDE.md` §4b modelled the consistency
rule as **40%, applied across both phases**. Aram confirmed it is **50%, funded phase
only**. The 40% figure was never sourced from him — it came from `CLAUDE.md` §1,
which says "40% consistency rule" without qualification, and it should have been
flagged as needing confirmation before conclusions were drawn from it. It was not.

§4b also mixed two simulation models with different horizons — `portfolio.campaign`
(24 months, accounts replaced) for the size table and `first_payout` (48 months,
single account) for the consistency table — and on that basis recommended **20
micros**. On one consistent model the optimum is **5–8 micros** and 20 micros is
nearly twice as expensive per success. Both errors are corrected; the corrected
tables are the ones in §4b now.

---

# Investigation (f) — deviations from PREREGISTRATION-APEX.md

### 1. The engine and simulator were debugged on synthetic data before the protocol was final

`PREREGISTRATION-APEX.md` briefly held only its `REGISTRY_SHA` line while the
runner was smoke-tested end to end on edge-free synthetic bars (`src/synth.py`).
No real market data existed in the container at any point, so nothing in the
protocol could have been shaped by an NQ or ES result. The hypothesis grid was
never edited after its hash was taken.

### 2. Two defects found in the lifecycle simulator's path handling, before any real run

Each simulated bar plays its favourable extreme before its adverse one, which is
the pessimistic order for a trailing threshold. On the bar a trade **exits at its
target** that order is wrong. The fill happens at the high, so a low printed
later in the same bar cannot hurt the trade. Under the old order, a clean
+$3,000 winner could raise the threshold to +$1,000 and then "breach" on its own
entry-level low. That made every low-frequency, high-RR strategy look
unpassable. `bt.py` now splits a target-exit bar into (low, low, low) followed
by (net, net, net). A stop-exit bar now closes its adverse leg at the realised
exit. `tests/test_apex.py` pins both. The first null-calibration runs used the
old paths, were discarded, and were re-run.

### 3. The Apex rules could not be read from the source

apextraderfunding.com blocks this container, a headless browser and the
web-fetch tool with a Cloudflare challenge. The rules were taken from the
search-indexed text of the official pages. That is weaker than the brief's
"in writing from the firm". Every value carries a status in `src/apex_rules.py`.
Two rows conflict between official pages: the drawdown ($2,000 vs $2,500) and
the evaluation's minimum days (0 vs 7). Four rows were not found: the contract
cap, the PA level table, a per-payout cap and the activation fee. The conflicts
are simulated both ways. None of this is a substitute for Aram confirming the
rules in writing.

### 4. The holdout has been seen by the project, though not by these hypotheses

Recorded in `PREREGISTRATION-APEX.md` §3. 2025-10-01 onward overlaps the spent
holdout of investigation (b) and the development data of investigation (c).
Forward paper trading from 2026-10-01 is the only fully clean test.
