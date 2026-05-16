# Support Escalation Matrix

> This document is an operator procedure template only. It does not authorize pilot launch, production deployment, live traffic, payment acceptance, admissions, refunds, payouts, or data changes. Final CTO go/no-go approval is required before any pilot execution.

These are human operational roles, not application RBAC roles.
They do not grant system permissions.
Application access remains governed by Workstreams 1 and 7 permissions.

## Operational Role Labels

- Pilot Commander
- Technical Lead
- Payments Lead
- Admissions/Gate Lead
- Support Lead
- Security/Privacy Lead
- Provider Contact Owner
- Final CTO / Approval Owner

## Escalation Matrix

| Issue type | First responder | Escalation owner | Decision owner | Required evidence | Max response window placeholder | Communication channel placeholder |
| --- | --- | --- | --- | --- | --- | --- |
| Health/readiness failure | Technical Lead | Pilot Commander | Final CTO / Approval Owner | health status, timestamps, current impact summary | TBD | TBD |
| Payment incident | Payments Lead | Technical Lead | Final CTO / Approval Owner | paymentIntent IDs, provider status summary, timestamps | TBD | TBD |
| Admission gate incident | Admissions/Gate Lead | Technical Lead | Final CTO / Approval Owner | ticket IDs, event IDs, scan status summary, timestamps | TBD | TBD |
| Support/admin redaction issue | Support Lead | Security/Privacy Lead | Final CTO / Approval Owner | audit IDs, target IDs, redacted metadata summary | TBD | TBD |
| Secret exposure suspicion | Security/Privacy Lead | Final CTO / Approval Owner | Final CTO / Approval Owner | evidence references, exposure scope summary, timestamps | TBD | TBD |
| Provider outage | Provider Contact Owner | Payments Lead | Final CTO / Approval Owner | provider name, status summary, timestamps | TBD | TBD |

## Operating Rules

- Support operators use read-only support tools only.
- No support operator may manually mutate payment/ticket/admission state.
- Any data exposure suspicion escalates immediately to Security/Privacy Lead and Final CTO.
- When in doubt, archive identifiers and status summaries, not raw records.
