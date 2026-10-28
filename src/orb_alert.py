"""NQ opening-range breakout alerts by SMS.

The trader-entry / trader-exit rule from the day-trader skill pack, applied to
NQ futures and sized in MNQ micros for the prop account:

  range   first 15 minutes of the New York session, 9:30-9:45 ET
  entry   first completed 5-minute bar that CLOSES above the range high (long only)
  stop    range midpoint, rounded down to the tick
  target  entry + 2R
  size    floor(RISK_USD / (stop distance x $2)), capped at 60 micros
  window  no new entry after 15:30 ET, flat by 15:55 ET

Every change of state is texted once (ntfy push or Twilio SMS): range set, triggered,
target hit, stop hit, flatten, no trade. Nothing is ever ordered.

Prices come from Yahoo, free. Its NQ=F chart runs 10 minutes behind CME, but
QQQ (the Nasdaq-100 ETF) is live and moves with NQ, so by default the signal is
read off QQQ and every level is converted to NQ points at the day's NQ/QQQ
ratio (QQQ x ~41). Over a month of 5-minute bars that conversion was typically
within 1 NQ point of the real price and nearly always within 3, so each alert
still says to check the live Tradovate chart. --source nq uses NQ=F directly.

    python3 src/orb_alert.py run              # today, polls until the day is done (live QQQ)
    python3 src/orb_alert.py run --source nq  # same, on 10-minute-delayed NQ=F
    python3 src/orb_alert.py run --dry-run    # same, prints instead of texting
    python3 src/orb_alert.py replay 2026-10-23  # a past day, printed, no texts
    python3 src/orb_alert.py test             # one test text

Alerts go out one of two ways:
  NTFY_TOPIC   free push notification via ntfy.sh -- no account, no card. Install
               the ntfy app, subscribe to the same topic. Pick a long random name:
               anyone who knows it can read the alerts. Used when set.
  Twilio SMS   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM and SMS_TO
               (trial accounts refuse free text, so this needs a paid account).
"""
import argparse
import base64
import datetime as dt
import json
import math
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

NY = ZoneInfo("America/New_York")
SYMBOL = "NQ=F"
PROXY = "QQQ"
TICK = 0.25
USD_PER_POINT = 2.0           # MNQ
MAX_MICROS = 60               # 6 NQ = 60 MNQ, the firm's cap
RISK_USD = 200.0              # 10% of the $2,000 trailing drawdown
TARGET_R = 2.0
OPEN, RANGE_END = dt.time(9, 30), dt.time(9, 45)
LAST_ENTRY, FLAT, CLOSE = dt.time(15, 30), dt.time(15, 55), dt.time(16, 0)
BAR = 300
STATE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "trader", "orb_state.json")
NOTES = {"nq": "Yahoo data ~10 min late: check Tradovate first.",
         "qqq": "Live via QQQ, converted to NQ: check Tradovate first."}


def fetch_bars(rng="1d", symbol=SYMBOL):
    # Pre- and post-market bars too, so QQQ overlaps NQ=F before the open.
    url = ("https://query2.finance.yahoo.com/v8/finance/chart/%s?range=%s&interval=5m&includePrePost=true"
           % (urllib.parse.quote(symbol), rng))
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        res = json.load(r)["chart"]["result"][0]
    q = res["indicators"]["quote"][0]
    bars = []
    for i, ts in enumerate(res.get("timestamp") or []):
        o, h, l, c = q["open"][i], q["high"][i], q["low"][i], q["close"][i]
        if None in (o, h, l, c):
            continue
        bars.append({"t": dt.datetime.fromtimestamp(ts, NY), "o": o, "h": h, "l": l, "c": c})
    return bars


def proxy_bars(rng="1d"):
    """Live QQQ bars rescaled to NQ points.

    The scale is the median NQ/QQQ close ratio over that day's bars present in
    both series from 08:00 ET on; NQ=F lags 10 minutes, so early in the session
    this leans on pre-market bars. A day with no overlap borrows the last
    earlier day's ratio. The ratio drifts a few NQ points a day, so it is never
    carried further than that."""
    qqq, nq = fetch_bars(rng, PROXY), {b["t"]: b["c"] for b in fetch_bars(rng)}
    by_day = {}
    for b in qqq:
        if b["t"] in nq and dt.time(8, 0) <= b["t"].time() < CLOSE:
            by_day.setdefault(b["t"].date(), []).append(nq[b["t"]] / b["c"])
    out, ratio = [], None
    for b in qqq:
        r = by_day.get(b["t"].date())
        if r:
            ratio = sorted(r)[len(r) // 2]
        if ratio is None:
            continue
        out.append(dict(b, **{k: round_tick(b[k] * ratio) for k in "ohlc"}))
    return out


def floor_tick(x):
    return math.floor(x / TICK + 1e-9) * TICK


def round_tick(x):
    return round(x / TICK) * TICK


def fmt(x):
    return "{:,.2f}".format(x)


def evaluate(bars, day, now, note=NOTES["nq"]):
    """Every event the day's bars imply so far, as (key, text) pairs, in order.
    A bar counts only once the next bar exists (or the session has moved past it)."""
    session = [b for b in bars if b["t"].date() == day and OPEN <= b["t"].time() < CLOSE]
    last_t = session[-1]["t"] if session else None
    done = [b for b in session if b["t"] < last_t or now >= b["t"] + dt.timedelta(seconds=BAR + 900)]
    events = []
    rng = [b for b in done if b["t"].time() < RANGE_END]
    if len(rng) < 3:
        return events, False
    hi, lo = max(b["h"] for b in rng), min(b["l"] for b in rng)
    mid = floor_tick((hi + lo) / 2)
    events.append(("range", "NQ range set %s-%s (mid %s). Watching for a 5-min close above %s."
                   % (fmt(lo), fmt(hi), fmt(mid), fmt(hi))))
    after = [b for b in done if b["t"].time() >= RANGE_END]
    trig = next((b for b in after if b["t"].time() < LAST_ENTRY and b["c"] > hi), None)
    if trig is None:
        if now.time() >= LAST_ENTRY or (after and after[-1]["t"].time() >= LAST_ENTRY):
            events.append(("none", "NQ: no breakout by 15:30 ET. No trade today."))
            return events, True
        return events, False
    entry = trig["c"]
    stop = mid
    risk = entry - stop
    target = round_tick(entry + TARGET_R * risk)
    micros = min(int(RISK_USD // (risk * USD_PER_POINT)), MAX_MICROS)
    t = trig["t"] + dt.timedelta(seconds=BAR)
    if micros < 1:
        events.append(("skip", "NQ triggered %s ET at %s but the stop is %s pts: 1 micro risks $%.0f, over $%.0f. SKIP."
                       % (t.strftime("%H:%M"), fmt(entry), fmt(risk), risk * USD_PER_POINT, RISK_USD)))
        return events, True
    events.append(("trigger",
                   "NQ BUY signal %s ET. Entry %s, stop %s, target %s (2R). %d MNQ = $%.0f risk. "
                   "Bracket in Tradovate, flat by 15:55. %s"
                   % (t.strftime("%H:%M"), fmt(entry), fmt(stop), fmt(target), micros,
                      micros * risk * USD_PER_POINT, note)))
    for b in after:
        if b["t"] <= trig["t"]:
            continue
        if b["t"].time() >= FLAT:
            break
        if b["l"] <= stop:      # a bar touching both counts as the stop: the cautious read
            events.append(("stop", "NQ STOP hit at %s: -$%.0f on %d MNQ. Done for today."
                           % (fmt(stop), micros * risk * USD_PER_POINT, micros)))
            return events, True
        if b["h"] >= target:
            events.append(("target", "NQ TARGET hit at %s: +$%.0f on %d MNQ. Done for today."
                           % (fmt(target), micros * (target - entry) * USD_PER_POINT, micros)))
            return events, True
    if now.time() >= FLAT or (after and after[-1]["t"].time() >= FLAT):
        last = after[-1]["c"]
        events.append(("flat", "NQ 15:55 ET: close the position now. Last price %s, about %+.0f$ on %d MNQ."
                       % (fmt(last), micros * (last - entry) * USD_PER_POINT, micros)))
        return events, True
    return events, False


def send_ntfy(topic, body):
    req = urllib.request.Request("https://ntfy.sh/" + urllib.parse.quote(topic), data=body.encode("utf-8"))
    req.add_header("Title", "NQ ORB alert")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            print("sent %s: %s" % (json.load(r).get("id"), body))
    except urllib.error.HTTPError as e:
        raise SystemExit("ntfy refused the alert (HTTP %d): %s" % (e.code, e.read().decode("utf-8", "replace")))


def send_sms(body, dry):
    if dry:
        print("SMS> " + body)
        return
    if os.environ.get("NTFY_TOPIC"):
        return send_ntfy(os.environ["NTFY_TOPIC"], body)
    sid, tok = os.environ["TWILIO_ACCOUNT_SID"], os.environ["TWILIO_AUTH_TOKEN"]
    data = urllib.parse.urlencode({"To": os.environ["SMS_TO"], "From": os.environ["TWILIO_FROM"],
                                   "Body": body}).encode()
    req = urllib.request.Request("https://api.twilio.com/2010-04-01/Accounts/%s/Messages.json" % sid, data=data)
    req.add_header("Authorization", "Basic " + base64.b64encode(("%s:%s" % (sid, tok)).encode()).decode())
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            print("sent %s: %s" % (json.load(r).get("sid"), body))
    except urllib.error.HTTPError as e:
        raise SystemExit("Twilio refused the text (HTTP %d): %s" % (e.code, e.read().decode("utf-8", "replace")))


def load_state(day):
    try:
        with open(STATE, encoding="utf-8") as fh:
            s = json.load(fh)
        if s.get("day") == str(day):
            return s
    except (OSError, ValueError):
        pass
    return {"day": str(day), "sent": []}


def save_state(s):
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    with open(STATE, "w", encoding="utf-8") as fh:
        json.dump(s, fh)


def run(a):
    now = dt.datetime.now(NY)
    day = now.date()
    if now.weekday() >= 5:
        print("Weekend in New York: nothing to watch.")
        return 0
    state = load_state(day)
    while True:
        now = dt.datetime.now(NY)
        try:
            events, finished = evaluate(load_bars(a.source), day, now, NOTES[a.source])
        except (urllib.error.URLError, OSError, KeyError, ValueError, TypeError) as e:
            print("%s data error: %s" % (now.strftime("%H:%M:%S"), e))
            events, finished = [], False
        unsent = False
        for key, text in events:
            if key not in state["sent"]:
                # A refused or failed send must not end the day: leave it unsent
                # and try again on the next check, keeping the alerts in order.
                try:
                    send_sms(text, a.dry_run)
                except (SystemExit, urllib.error.URLError, OSError) as e:
                    print("%s send failed, will retry: %s" % (now.strftime("%H:%M:%S"), e))
                    unsent = True
                    break
                state["sent"].append(key)
                if not a.dry_run:
                    save_state(state)
        if finished and not unsent:
            return 0
        if now.time() >= dt.time(16, 20):
            print("Past 16:20 ET without data for the close: stopping.")
            return 0
        if a.once:
            return 0
        time.sleep(a.every)


def load_bars(source, rng="1d"):
    return proxy_bars(rng) if source == "qqq" else fetch_bars(rng)


def replay(a):
    day = dt.date.fromisoformat(a.day)
    end = dt.datetime.combine(day, dt.time(23, 59), NY)
    events, _ = evaluate(load_bars(a.source, "1mo"), day, end, NOTES[a.source])
    if not events:
        print("No session data for %s." % day)
    for _, text in events:
        print("SMS> " + text)
    return 0


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", help="watch today and text every update")
    r.add_argument("--dry-run", action="store_true", help="print the texts instead of sending them")
    r.add_argument("--once", action="store_true", help="one check, then exit")
    r.add_argument("--every", type=float, default=60, help="seconds between checks (default 60)")
    rp = sub.add_parser("replay", help="print the texts a past day would have sent")
    rp.add_argument("day", help="YYYY-MM-DD, within the last month")
    for sp in (r, rp):
        sp.add_argument("--source", choices=("qqq", "nq"), default="qqq",
                        help="qqq: live QQQ converted to NQ (default); nq: NQ=F, 10 minutes late")
    t = sub.add_parser("test", help="send one test text")
    t.add_argument("--dry-run", action="store_true")
    a = p.parse_args(argv)
    if a.cmd == "test":
        send_sms("Test from your NQ alert script. If you can read this, SMS alerts are working.", a.dry_run)
        return 0
    return run(a) if a.cmd == "run" else replay(a)


if __name__ == "__main__":
    sys.exit(main())
