# Apex $50K Intraday — evaluation playbook

Written 2026-10-01 for Aram. Every number below comes from `src/eval_plan.py`.
That script replays this exact plan on real MNQ 1-minute data (2024-02 →
2025-12) through the Apex rules Aram confirmed, including fees and slippage.
Reproduce it with `python3 src/eval_plan.py --final`.

## What this is, and what it is not

Six investigations found **no trading signal that holds up on new data**. So
this playbook does not tell you which way to trade. It fixes everything else:
size, stop, target, timing and daily limits. Those settings are the ones that
give the best odds of passing in 30 days and reaching a first payout, **given
whatever skill your direction call has**.

**Your odds depend almost entirely on how often your direction call is right.**

## The rules

**Evaluation**

| | |
|---|---|
| Instrument | MNQ |
| Size | **5 micros** |
| Trades per day | **One** |
| Entry | Market order at **09:31 New York time** (14:31 UK; 13:31 UK in the weeks when only one country has changed its clocks) |
| Direction | Your call, decided **before** 09:30 and written in the log |
| Stop | **60 points** from entry, placed with the order as a bracket |
| Target | **60 points** from entry |
| If neither is hit | Close at **15:55 New York time** |
| After the trade | You are done for the day, win or lose |

- **Never move the stop.** Never add to the position.
- **Don't trade more or bigger to catch up.** Bigger size was tested and makes
  things worse.
- **Keep the size fixed.** A pre-registered test
  (`PREREGISTRATION-SIZING.md`) tried four rules that size from the
  drawdown cushion or the distance to target. Fixed 5 micros beat all four,
  at every skill level, on 2024 and 2025 data separately.
- **Each trade risks about $600 or wins about $600.** Passing takes about five
  more winning days than losing days.

**Funded account (PA)**

- **Same plan, but drop to 2 micros.** That's about $240 per trade.
- A winning day clears the $200 "qualifying day" bar.
- Small size keeps the account alive while it builds the $52,100 safety net.
- **Request a payout the first day you are eligible.** You need five qualifying
  days, at least $500 above $52,100, and no single day carrying 50% or more of
  the profit since your last payout.

## Your odds

At 1:1, a coin flip wins about 50% of trades.

| Your win rate | Pass in 30 days | Payout per attempt | Fees per first payout |
|---|---|---|---|
| ~50%, no skill | 15% | 3% | about £780 (≈ 32 attempts) |
| ~55% | 26% | 13% | about £210 (≈ 8 attempts) |
| ~60% | 40% | 33% | about £100 (≈ 3 attempts) |

- **The first payout arrives about 45–55 sessions after passing**, roughly 2½
  months. The median first payout is about **$620**.
- **Slippage of 2 ticks instead of 1** lowers every row by about 1–2 points.
- **A 7-day evaluation minimum**, if Apex has one, changes almost nothing.

## The decision rule — this is the important part

1. **Log every call** in `trade_log.csv`, including days you don't trade.
   - Fill in the date, direction, micros, exit reason (target, stop or time),
     points and account (`eval-1`, `pa-1`, …).
   - On days you don't trade, still record what the bracket would have done.
     Those calls count toward your win rate for free.
   - Run `python3 src/log_check.py` to see your win rate, the decision, and
     each account's room to its floor and target. Or send me the file and I'll
     run it.
2. **After 30 calls**, work out your win rate. Ignore the evaluation's
   pass/fail and look only at the calls.
   - **50% or less:** stop buying evaluations. At coin-flip skill, each payout
     costs about £780 in fees for about $620.
   - **55% or more:** keep going, staggering one new evaluation every week or two.
   - **In between:** keep logging until you have 60 calls.
3. **Thirty calls cannot prove skill.** A 55% true rate can show anywhere from
   37% to 73% over 30 trades. The log exists to catch "clearly no skill" early
   and cheaply. It cannot certify "clearly skilled".

## What the model does not cover

- **Apex compliance reviews.** Funded accounts can be checked for rule
  violations. A plan with one bracketed trade a day, a hard stop and small size
  is about as clean as trading gets, but payouts are always at Apex's discretion.
- **Entry times other than 09:31.** If you take your London-session setups
  instead, keep the size and bracket rules. The odds above were only measured
  for the 09:31 entry.
- **Unconfirmed rule:** whether the evaluation has a 0- or 7-day minimum. Both
  were simulated.
- **No live orders are placed by this project.** Every trade is yours to take.
