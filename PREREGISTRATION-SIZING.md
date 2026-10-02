# Pre-registration — evaluation sizing rules (written before any were run)

Question: does sizing each day from the account's state beat the playbook's fixed
5 micros in the evaluation? This is variance shaping, not a direction signal.
Direction remains a coin flip plus the "skill" levels in `src/eval_plan.py`.

**Fixed:**
- the bracket: 60-point stop, 60-point target, entry 09:31 ET, flat at 15:55 ET
- funded-account size: 2 micros
- data: design window 2024-02-01 → 2025-12-31, with neutralised paths
- the 2026 holdout stays untouched
- the rules: `apex_rules.PRIMARY`

Per-micro risk is R = 60 pts × $2 + costs ≈ $122. Per-micro win is W ≈ $118.
Each day's size is rounded and clamped to 1–60 micros.

| Rule | Size each day |
|---|---|
| S1 fixed (baseline) | 5 |
| S2 cushion 1/3 | (equity − threshold) / 3 / R |
| S3 cushion 1/2 | (equity − threshold) / 2 / R |
| S4 cushion 1/2, need 3 | min(S3, ceil((target balance − equity) / 3 / W)) |
| S5 cushion 1/2, need 5 | min(S3, ceil((target balance − equity) / 5 / W)) |

**Decision rule.** A rule replaces S1 only if it beats S1 on P(payout per
attempt) at **all three** skill levels (0, 10%, 20%), on **both** halves of the
design window separately (2024 paths only and 2025 paths only). Otherwise S1
stays. If more than one rule qualifies, the one with the highest mean across the
six cells wins. 6,000 paths per cell, with the evaluation minimum days at 0.
