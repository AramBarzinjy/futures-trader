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
