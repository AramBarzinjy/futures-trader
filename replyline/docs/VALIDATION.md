# Validating demand before spending more

Building the app doesn't create customers. The cheapest next step is ~20
conversations, not more features.

## 1. Who to talk to first

1. **Sole-trader and 2–5 person trades** — plumbers, electricians, heating engineers. Highest enquiry pain, fastest decisions.
2. **Domestic cleaning companies** — many small recurring enquiries, appointment-heavy.
3. **Independent estate/lettings agents** — high volume but often have a CRM; test whether follow-up is still a gap.

Find them through: local Facebook trade groups, Checkatrade/MyBuilder profiles
(contact as a potential customer would, then ask), trade counters (Screwfix,
plumbers' merchants), BNI chapters, your own network.

## 2. Interview script (20 minutes, don't pitch until the end)

1. Walk me through the last enquiry you got. Where did it come in? When did you reply?
2. How many enquiries in a typical week? How many do you think you never replied to?
3. What happens when someone doesn't reply to your quote?
4. Last time a customer didn't show up — what did it cost you?
5. What do you use to keep track today? What do you hate about it?
6. Have you paid for anything to fix this? What happened?
7. *(Show the demo workflow below.)* What would stop you using this tomorrow?
8. If it did that reliably, what would you expect to pay monthly?
9. Can I set you up on a free trial this week? *(The only answer that counts.)*

Write down exact phrases they use — they become your landing-page copy.

## 3. Demo workflow (5 minutes)

Seeded demo workspace (`npm run db:seed`):
1. Dashboard: "here's what needs you today."
2. Open the integrations page, submit the website form on your phone as a customer.
3. The enquiry appears; acknowledgement already sent (Outbox).
4. Open it → Draft with AI → edit → send.
5. Show the follow-up that will go in 2 business days, and that it stops when the customer replies (log a reply).
6. Book a visit → show the reminder schedule.
7. Weekly report.

## 4. Outreach that respects the rules

Outreach to **businesses** by email is lawful under PECR to corporate
subscribers (limited companies, LLPs), but **sole traders and partnerships are
treated like individuals** — you need consent before emailing them marketing.
So for sole traders: phone, in person, LinkedIn messages, or replying to posts
where they asked for recommendations. Always identify yourself and offer an easy
opt-out.

Example message (to a limited company, or after they've agreed to hear more):

> Hi Gareth — I'm building a simple tool for heating engineers that replies to
> every enquiry within minutes and chases quotes that go quiet, so you stop
> losing jobs to whoever answered first. I'm looking for five local firms to try
> it free for a month and tell me what's wrong with it. Would a 15-minute chat
> this week be useful? If not, no worries — just say and I won't follow up.

## 5. Pricing experiment

- Show £29 / £79 / £199 to the first ten; ask which they'd pick and why.
- For the next ten, show £39 / £99 / £249. Compare stated choice and trial→paid.
- Offer paid setup (£99–£249 "we'll set it up with you") to half the trialists; see who pays.
- Don't discount the list price; give extra trial time instead.

## 6. Measuring whether it's working

| Metric | Definition | Early target |
|---|---|---|
| Activation | Trial workspace sends ≥1 reply AND has ≥5 enquiries in its first 7 days | 50% of sign-ups |
| Weekly active | Workspace with any user action in the last 7 days | 70% of paying |
| Value signal | Median time from enquiry to first reply (we have the timestamps) | < 1 hour |
| Trial → paid | Paid by day 14 | 25–40% |
| Logo retention | Paying customers still paying after 3 months | > 85% |
| Willingness to pay | Customers on Growth or above | > 50% |

All of these can be computed from the existing tables (`enquiries.created_at`,
`messages.sent_at`, `activities`, `organizations.subscription_status`). A small
internal SQL dashboard is enough at first.

**Decision rule:** if after 20 interviews fewer than 5 agree to a trial, or
after 10 trials fewer than 2 pay, change the segment or the offer before
building more.
