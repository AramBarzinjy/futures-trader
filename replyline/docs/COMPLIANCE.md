# UK privacy and email compliance

**These features support compliance; they do not make a business compliant.**
Nothing here is legal advice. Items marked ⚖️ need review by a UK data-protection
solicitor before taking payment from customers.

## Roles

- Replyline's operator is a **controller** for its own account and billing data.
- For enquiry and contact data, each subscribing business is the **controller**
  and Replyline is its **processor** (UK GDPR Art. 28). ⚖️ A Data Processing
  Agreement must be part of the terms.
- Sub-processors (hosting, database, email delivery, AI provider if enabled,
  Stripe) must be listed, with locations and transfer safeguards. ⚖️

## What the product does

| Requirement | Implementation |
|---|---|
| Transactional vs marketing distinction | Every template and message has `kind`. Replies about the customer's own enquiry/appointment are transactional. Re-engagement is marketing. |
| PECR: marketing email needs consent (or soft opt-in) | Marketing sends are blocked unless the contact has recorded consent (`consent_required`, the default). A `soft_opt_in` mode exists but the UI tells owners to take advice first. ⚖️ Whether a quote enquiry creates a "sale or negotiations for a sale" for soft opt-in is fact-specific. |
| Consent records | Consent status, source text and timestamp per contact; changes logged on the timeline. Website-form checkbox is unticked by default and optional. |
| Unsubscribe | Marketing emails always carry an unsubscribe link and `List-Unsubscribe` header; one click on the confirmation page suppresses. Follow-up sequences carry a "prefer we don't follow up?" link. A reply starting with STOP suppresses all automated email. |
| Suppression survives erasure | Suppressions store a SHA-256 hash of the address, so after erasure we can still honour the opt-out without keeping the address. ⚖️ Confirm this is acceptable as legitimate interest. |
| Right of access (Art. 15) | Contact page → "Download their data" (JSON). |
| Right to erasure (Art. 17) | Contact page → Erase. Anonymises the contact, message bodies, enquiry text, notes, appointment details; cancels unsent messages. |
| Storage limitation | Per-workspace retention (default 24 months after closure); daily purge job; audited. |
| Data minimisation | Website form asks only name, email, optional phone/subject, message. |
| AI data transfers | Off unless an owner/admin opts in (Settings → Privacy) when an external AI provider is configured. Only the single enquiry's text and the business's own details are sent, only when a user clicks an AI button. ⚖️ Anthropic's data-processing terms and transfer mechanism need listing as a sub-processor. |
| No cross-tenant reuse | AI prompts contain one enquiry's data; no retrieval across records; RLS prevents cross-tenant reads. |
| Accountability | Audit log of sensitive actions; workspace export. |
| Security (Art. 32) | See SECURITY.md. |

## Things deliberately NOT built

- Bulk/cold email to purchased lists, list upload for campaigns.
- Any way to send to suppressed addresses or disable unsubscribe links.
- Sending-limit circumvention (rotating domains, etc.).

## Before launch ⚖️

- [ ] Privacy policy, terms of service, DPA, sub-processor list (placeholders at `/legal/*`).
- [ ] ICO registration (data protection fee) for the operating company.
- [ ] Cookie notice: currently one strictly-necessary session cookie, so no consent banner needed — re-check if analytics are added.
- [ ] Decide the default retention period and document it in the privacy policy.
- [ ] Review the wording of the public form's consent checkbox and privacy notice line.
- [ ] Confirm the Data (Use and Access) Act 2025 changes (e.g. to PECR soft opt-in and enforcement) as they commence, and adjust defaults.
- [ ] If targeting recruitment: candidate data may include special category data — needs a separate DPIA.
