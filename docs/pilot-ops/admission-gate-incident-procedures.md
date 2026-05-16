# Admission Gate Incident Procedures

> This document is an operator procedure template only. It does not authorize pilot launch, production deployment, live traffic, payment acceptance, admissions, refunds, payouts, or data changes. Final CTO go/no-go approval is required before any pilot execution.

## Admission Gate Incident Categories

| Category | Immediate operator action | Evidence to archive | Escalation |
| --- | --- | --- | --- |
| Scanner cannot reach API | pause admissions at the affected gate | gate label, device label, timestamps, readiness summary | Admissions/Gate Lead, Technical Lead |
| Health readiness failing at gate time | pause admissions and preserve evidence | live/ready summaries, gate label, timestamps | Admissions/Gate Lead, Technical Lead, Final CTO / Approval Owner |
| Valid ticket scan rejected | preserve evidence and escalate | ticket IDs, event IDs, rejection reason, timestamps | Admissions/Gate Lead |
| Replay detected | deny entry, preserve evidence, escalate if pattern grows | ticket IDs, event IDs, rejection reason, timestamps | Admissions/Gate Lead, Security/Privacy Lead |
| Duplicate scan attempts | preserve evidence and monitor queue pressure | ticket IDs, event IDs, timestamps | Admissions/Gate Lead |
| Wrong event scan | deny entry, preserve evidence | ticket IDs, event IDs, rejection reason, timestamps | Admissions/Gate Lead |
| Expired ticket scan | deny entry, preserve evidence | ticket IDs, event IDs, rejection reason, timestamps | Admissions/Gate Lead |
| Unauthorized scanner | stop use of the device/session and escalate | device label, user label, timestamps | Admissions/Gate Lead, Security/Privacy Lead |
| Device battery/network failure | pause affected gate activity if required | device label, gate label, timestamps | Admissions/Gate Lead |
| High queue pressure | preserve evidence and escalate operationally | queue estimate, gate label, timestamps | Pilot Commander, Admissions/Gate Lead |

## Rules

If the API is unavailable, pause admissions.

- Do not grant admission outside the approved scan flow.
- Do not accept screenshots as authority.
- Do not accept payment receipts as authority.
- Do not accept organizer claims as authority.
- Do not accept provider messages as authority.
- Do not create manual attendee lists as admission authority.
- Do not manually mark ticket USED.
- Do not bypass admission audit logging.
- If replay is detected, deny entry and collect evidence.
- Use support read-only views only.
- Offline/degraded admissions are not approved in Workstream 9 unless separate Final CTO-approved procedure exists.

## Escalation Requirement

Admission outage must be escalated to Admissions/Gate Lead, Technical Lead, and Final CTO / Approval Owner before any non-standard procedure is considered.
