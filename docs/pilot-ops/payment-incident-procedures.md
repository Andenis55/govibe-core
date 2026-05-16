# Payment Incident Procedures

> This document is an operator procedure template only. It does not authorize pilot launch, production deployment, live traffic, payment acceptance, admissions, refunds, payouts, or data changes. Final CTO go/no-go approval is required before any pilot execution.

## Payment Incident Categories

| Category | Immediate operator action | Evidence to archive | Escalation |
| --- | --- | --- | --- |
| Payment stuck INITIATED | preserve evidence and monitor approved verification path only | paymentIntent IDs, status summary, timestamps | Payments Lead |
| Payment stuck INITIATION_PENDING | preserve evidence and monitor approved initiation path only | paymentIntent IDs, status summary, timestamps | Payments Lead |
| Payment verification timeout | preserve evidence, pause affected workflow if needed, escalate | paymentIntent IDs, timeout category, timestamps | Payments Lead, Technical Lead |
| Provider reports success but system not VERIFIED | preserve evidence, do not manually mark success | paymentIntent IDs, provider status summary, timestamps | Payments Lead, Technical Lead |
| System VERIFIED but no ticket issued | preserve evidence, do not issue ticket manually | paymentIntent IDs, ticket status summary, timestamps | Payments Lead, Admissions/Gate Lead |
| Duplicate payment attempt | preserve evidence and escalate | paymentIntent IDs, duplicate indicators, timestamps | Payments Lead, Technical Lead |
| Suspected duplicate charge | preserve evidence and escalate | paymentIntent IDs, provider references, timestamps | Payments Lead, Final CTO / Approval Owner |
| Wrong amount/currency mismatch | preserve evidence and escalate | paymentIntent IDs, mismatch category, timestamps | Payments Lead, Technical Lead |
| Webhook duplicate/replay event | preserve evidence and escalate | webhook IDs, paymentIntent IDs, timestamps | Technical Lead |

## Rules

- Never manually mark payment VERIFIED.
- Never issue ticket from unverified payment.
- Never bypass provider verification.
- Never use browser redirect as fulfillment proof.
- Use support read-only views to inspect state.
- Escalate provider/reference mismatch.
- Archive payment incident evidence using IDs/status summaries, not raw records.
