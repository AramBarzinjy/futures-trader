# Product requirements

## Problem

Small service businesses lose work because enquiries arrive while they're busy,
replies go out late or not at all, nobody chases the customer who went quiet,
and customers forget appointments. Generic CRMs are too heavy; inboxes are too
loose.

## Promise

Never lose track of an enquiry. Respond faster, follow up consistently, and keep
appointments and prospects organised — without the business giving up control
of what is sent in its name.

## First segment: trades and home services

Chosen over estate agents, consultants, recruiters and agencies because:

| Factor | Trades | Why it matters |
|---|---|---|
| Enquiry volume | High, frequent, small-ticket | Value is felt weekly, not quarterly |
| Pain is obvious | "Whoever replies first gets the job" | Easy to explain in one sentence |
| Existing tools | Mostly inbox + paper + marketplace apps | Little to displace (agents have CRMs, recruiters have ATSs) |
| Workflow | Enquiry → quote visit → job | Fits the default pipeline exactly |
| Reachability | Local directories, Facebook groups, trade counters | Cheap to reach for interviews |
| Risk | Low-sensitivity data | Fewer compliance hurdles than recruitment (special category data) |

The platform is industry-configurable from day one: statuses, categories,
sources, templates and workflows come from presets in `src/config/industries.ts`
(trades, property, consulting, recruitment, agency) and are editable per workspace.

## MVP scope (built)

1. Accounts, workspaces, roles, onboarding wizard with checklist.
2. Enquiries + contacts: manual entry, website form, CSV import, inbound-email webhook.
3. Templates with variables; AI-assisted drafting behind a provider interface.
4. Approval queue; sending through a simulated provider (real provider ready).
5. Follow-up engine with stop rules, business hours, dry run, failure handling.
6. Appointments and reminders.
7. Weekly prospect report.
8. Dashboard.
9. Plans, limits and test billing; Stripe integration code.
10. Privacy tools: consent, suppression, unsubscribe, export, erasure, retention.

## Out of MVP

Mailbox OAuth, calendar sync, visual workflow builder, SMS, agency/reseller
accounts, custom field UI, mobile app.

## Main user journeys

1. **Set up** — sign up → choose industry → contact details and hours → tone,
   sources, which messages may send automatically → privacy → dashboard checklist.
2. **New enquiry arrives** (form / email / manual) → contact matched → duplicate
   check → acknowledgement prepared (sent automatically only if the owner chose
   that) → follow-up sequence scheduled → escalation if no one replies in a day.
3. **Reply** — open enquiry → start from a template or "Draft with AI" → check
   flagged items → send. Status moves to Contacted.
4. **Customer goes quiet** — follow-up due after 2 business days, inside opening
   hours → approval queue (or automatic) → final polite close-out 5 days later.
5. **Customer replies** — via inbound email or logged by staff → every pending
   automated message for that enquiry is cancelled, sequence stops, status → Needs response.
6. **Book a visit** — confirmation now, reminder the day before; reschedule voids old reminders.
7. **Monday morning** — weekly report: what came in, who's waiting, who's gone quiet, what's booked.
8. **Customer asks to be forgotten** — export their data, then erase; they stay suppressed.

## Pricing (launch hypotheses, configurable in `src/config/plans.ts`)

| | Starter £29 | Growth £79 | Pro £199 |
|---|---|---|---|
| Users | 1 | 5 | 15 |
| Automated multi-step follow-ups | – | ✓ | ✓ |
| Inbound email capture | – | ✓ | ✓ |
| Reminders per appointment | 1 | 3 | 5 |
| Custom workflow rules | – | ✓ | ✓ |
| Team assignment | self only | ✓ | ✓ |
| Custom fields, advanced reports | – | – | ✓ |
| AI requests / month | 100 | 600 | 2,500 |
| Automation runs / month | 300 | 3,000 | 15,000 |
| Emails / month | 300 | 3,000 | 15,000 |

Annual = 10× monthly. 14-day Growth trial, no card. Lapsed or unpaid → Starter limits, data kept.
