"""
Apex Trader Funding — $50K Intraday Trailing Drawdown account rules, with provenance.

Every number the lifecycle simulator uses lives here, and every one carries a
source and a verification status. The simulator prints the status table with its
results, so an UNVERIFIED rule can never quietly become a finding.

How these were gathered (2026-09-30)
------------------------------------
apextraderfunding.com and support.apextraderfunding.com both return a Cloudflare
"Attention Required" block to this container, to curl, to a headless browser and
to the web-fetch tool alike. The official pages could not be read directly. What
could be read is the text of those official pages as indexed by a search engine,
restricted to the two Apex domains. Status values:

  SNIPPET   — the value appears in the indexed text of an official Apex page.
  DERIVED   — computed from SNIPPET values by arithmetic stated in `note`.
  CONFLICT  — official snippets disagree; the primary value and the alternative
              are both simulated.
  UNKNOWN   — not found; the simulator uses a stated conservative assumption.

None of this is "in writing from the firm" in the sense Step 8 of the brief asks
for. Before any money is spent, Aram should confirm every row that is not SNIPPET
by email or live chat, and the CONFLICT rows above all. See `RULES_TO_CONFIRM`.

Official pages the snippets came from:
  https://apextraderfunding.com/help-center/evaluation-accounts-ea/intraday-trailing-drawdown-evaluations/
  https://apextraderfunding.com/help-center/intraday-trailing-drawdown-accounts/intraday-trailing-drawdown-explained/
  https://apextraderfunding.com/help-center/intraday-trailing-drawdown-accounts/intraday-trailing-drawdown-performance-accounts-pa/
  https://apextraderfunding.com/help-center/intraday-trailing-drawdown-accounts/intraday-trailing-drawdown-payouts/
  https://apextraderfunding.com/help-center/additional-helpful-items/daily-loss-limit-explained/
  https://apextraderfunding.com/help-center/additional-helpful-items/position-sizing-evaluation/
  https://apextraderfunding.com/help-center/additional-helpful-items/scaling-levels-pa-explained/
  https://apextraderfunding.com/help-center/tradovate/tradovate-commission-instruments/
  https://apextraderfunding.com/help-center/rithmic/rithmic-commissions-instruments/
  https://support.apextraderfunding.com/hc/en-us/articles/4413998546587
"""
from dataclasses import dataclass, field, asdict, replace

VERIFIED_ON = "2026-09-30"


@dataclass(frozen=True)
class Rule:
    value: object
    status: str
    note: str


RULES = {
    # ---------------------------------------------------------------- evaluation
    "start_balance": Rule(50_000.0, "SNIPPET", "Account size."),
    "eval_profit_target": Rule(3_000.0, "DERIVED",
        "Intraday Evaluations page: threshold stop level is $53,000, reached when "
        "the peak hits $55,000 = 'Profit Target Balance + Max Drawdown'. So the "
        "profit target balance is $53,000, i.e. +$3,000."),
    "trailing_dd": Rule(2_000.0, "CONFLICT",
        "$2,000 is implied twice by official arithmetic: eval threshold locks at "
        "$53,000 when peak = $55,000, and PA threshold locks at $50,100 when peak = "
        "$52,100 = start + max drawdown + $100. But the Position Sizing page snippet "
        "says 'a $50k plan starts at $47,500' ($2,500), and a search summary "
        "repeated $2,500. $2,500 may be the legacy or EOD product. Primary $2,000; "
        "$2,500 is simulated as the alternative."),
    "trailing_dd_alt": Rule(2_500.0, "CONFLICT", "See trailing_dd."),
    "dd_uses_unrealized": Rule(True, "SNIPPET",
        "'moves dynamically with your account's highest balance (Peak Balance), "
        "including unrealized gains, and is enforced intraday at all times.'"),
    "breach_on_touch": Rule(True, "SNIPPET",
        "'If the account balance touches or drops below the threshold at any "
        "moment, liquidation occurs immediately and the account fails.'"),
    "eval_threshold_lock": Rule(53_000.0, "SNIPPET",
        "Eval threshold stops trailing at the profit-target balance."),
    "eval_dll": Rule(None, "SNIPPET",
        "'The Intraday Evaluation does not have a Daily Loss Limit.'"),
    "eval_days_limit_calendar": Rule(30, "SNIPPET",
        "'a 30-day assessment'; target must be reached 'within the 30-day access period'."),
    "eval_min_days": Rule(0, "CONFLICT",
        "Intraday Evaluations page: 'There is no minimum number of trading days "
        "required'. An older all-rules page says seven. Primary 0, alt 7."),
    "eval_min_days_alt": Rule(7, "CONFLICT", "See eval_min_days."),
    "eval_pass_at_close": Rule(True, "SNIPPET",
        "'will be marked as passed after market close'. Modelled as: the closed "
        "balance at a session close is >= target. Touching the target intraday "
        "and giving it back does not pass."),
    "eval_max_contracts": Rule(4, "UNKNOWN",
        "Not found for the current product. Contract limits 'remain fixed "
        "throughout the Evaluation'. 4 minis = 40 micros is the value a snippet "
        "used as an example; sizing in this project is far below any plausible "
        "cap, so it rarely binds. Sensitivity run at 10."),
    "micros_per_mini": Rule(10, "SNIPPET", "'Ten (10) micro contracts equal one (1) standard contract.'"),
    "eval_fee_usd": Rule(None, "UNKNOWN",
        "Price varies with promotions. The simulator reports the BREAK-EVEN fee "
        "instead, so no fee has to be assumed."),

    # --------------------------------------------------------- performance (PA)
    "pa_threshold_lock": Rule(50_100.0, "SNIPPET",
        "'In Performance Accounts, trailing stops once the Intraday Threshold "
        "reaches Starting Balance + $100 ... $50,100.'"),
    "pa_dll": Rule(1_000.0, "SNIPPET",
        "'On a 50K account, the Daily Loss Limit is $1,000'. Hitting it "
        "liquidates positions and 'pauses trading for the remainder of the "
        "session. The account remains active.'"),
    "pa_dll_is_failure": Rule(False, "SNIPPET", "Pause, not failure. Resets at next session open."),
    "pa_level1_max_contracts": Rule(2, "UNKNOWN",
        "A snippet pairs 'max position size of 2 contracts' with the $1,000 DLL "
        "but does not say which level. Levels are assigned from the prior "
        "session's closing balance, top level for 50K is Level 4; the level table "
        "was not recoverable. Modelled conservatively as Level-1 limits forever."),
    "pa_min_qualifying_days": Rule(5, "SNIPPET",
        "'a minimum of 5 trading days with a minimum of $200 profit for each of the days.'"),
    "pa_qualifying_day_profit": Rule(200.0, "SNIPPET", "See pa_min_qualifying_days."),
    "pa_safety_net": Rule(52_100.0, "SNIPPET",
        "'drawdown limit plus $100. Only profit above the safety net is eligible "
        "... remains in place for the lifetime of the Performance Account.'"),
    "pa_consistency": Rule(0.50, "SNIPPET",
        "'no single profitable trading day may account for 50% or more of total "
        "profit earned since your last approved payout.' Modelled as: best day "
        "P&L / net P&L since last payout must be < 0.50. Whether 'total profit' "
        "is net or gross of losing days is not stated — net is the stricter one."),
    "pa_min_payout": Rule(500.0, "SNIPPET", "'The minimum payout amount is $500 per request.'"),
    "pa_max_payout": Rule(None, "UNKNOWN",
        "Per-request cap not found. Modelled as uncapped; a cap would only "
        "lower the money, not survival."),
    "pa_max_payouts": Rule(6, "SNIPPET",
        "'Each Performance Account may receive a maximum of six approved payouts.' "
        "After six the PA is closed."),
    "pa_split": Rule(1.00, "SNIPPET", "100% payout split."),
    "pa_activation_fee_usd": Rule(0.0, "UNKNOWN", "Not found. Assumed zero; ask."),

    # ------------------------------------------------------------ session rules
    "trading_day": Rule("18:00-16:59 ET", "SNIPPET",
        "'A trading day is defined from 6 PM ET one day to 4:59 PM ET the next day.'"),
    "flat_by_et": Rule("16:59", "SNIPPET",
        "All positions closed and orders cancelled by 4:59 PM ET. Internal rule "
        "in this project: flat by 16:55 ET."),

    # ------------------------------------------------------------------ costs
    "commission_rt_nq_tradovate": Rule(3.10, "SNIPPET", "Tradovate minis $1.55/side."),
    "commission_rt_mnq_tradovate": Rule(1.04, "SNIPPET", "Tradovate micros $0.52/side."),
    "commission_rt_nq_rithmic": Rule(3.98, "SNIPPET", "Rithmic minis $1.99/side."),
    "commission_rt_mnq_rithmic": Rule(1.02, "SNIPPET", "Rithmic micros $0.51/side."),
}

RULES_TO_CONFIRM = [k for k, r in RULES.items() if r.status in ("CONFLICT", "UNKNOWN")]


@dataclass(frozen=True)
class ApexConfig:
    """The numbers the simulator consumes. Build variants with `replace()`."""
    start: float = RULES["start_balance"].value
    target: float = RULES["eval_profit_target"].value
    dd: float = RULES["trailing_dd"].value
    eval_lock: float = RULES["eval_threshold_lock"].value
    eval_days: int = 21            # 30 calendar days ~ 21 CME sessions
    eval_min_days: int = RULES["eval_min_days"].value
    eval_max_micros: int = RULES["eval_max_contracts"].value * 10
    pa_lock: float = RULES["pa_threshold_lock"].value
    pa_dll: float = RULES["pa_dll"].value
    pa_max_micros: int = RULES["pa_level1_max_contracts"].value * 10
    pa_q_days: int = RULES["pa_min_qualifying_days"].value
    pa_q_profit: float = RULES["pa_qualifying_day_profit"].value
    pa_safety_net: float = RULES["pa_safety_net"].value
    pa_consistency: float = RULES["pa_consistency"].value
    pa_min_payout: float = RULES["pa_min_payout"].value
    pa_max_payout: float = float("inf")
    pa_max_payouts: int = RULES["pa_max_payouts"].value

    def with_dd(self, dd: float) -> "ApexConfig":
        """Change the drawdown and every lock level that is defined from it."""
        return replace(self, dd=dd, pa_lock=self.start + 100.0,
                       pa_safety_net=self.start + dd + 100.0)


PRIMARY = ApexConfig()
ALT_DD = PRIMARY.with_dd(RULES["trailing_dd_alt"].value)
ALT_MIN_DAYS = replace(PRIMARY, eval_min_days=RULES["eval_min_days_alt"].value)


def status_table() -> str:
    w = max(len(k) for k in RULES)
    lines = [f"Apex $50K Intraday rules as gathered {VERIFIED_ON}", ""]
    for k, r in RULES.items():
        lines.append(f"  {k:<{w}}  {str(r.value):>16}  {r.status}")
    lines += ["", "Confirm in writing before spending money: " + ", ".join(RULES_TO_CONFIRM)]
    return "\n".join(lines)


if __name__ == "__main__":
    print(status_table())
