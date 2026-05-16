# No-Go Trigger Operationalization

> This document is an operator procedure template only. It does not authorize pilot launch, production deployment, live traffic, payment acceptance, admissions, refunds, payouts, or data changes. Final CTO go/no-go approval is required before any pilot execution.

No-go triggers cannot be waived by local operators.

Any waiver requires explicit Final CTO decision and archived rationale.

If Final CTO grants a waiver, the waiver must specify:

- scope
- duration
- conditions
- owner
- evidence reviewed
- rollback criteria
- expiration or next review point

Open-ended waivers are not allowed.

A waiver without scope, duration, conditions, and rollback criteria is invalid.

## High-Risk No-Go Action

- Pause pilot activity.
- Preserve evidence.
- Escalate to Final CTO / Approval Owner.
- Do not use local workaround.
- Await explicit ruling.

## Default No-Workaround No-Go Triggers

| Trigger | Allowed workaround by default? | Required action |
| --- | --- | --- |
| Secret leak detected | No | Pause pilot activity, preserve evidence, escalate immediately |
| Duplicate payment processing detected | No | Pause payment-related pilot activity, preserve evidence, escalate immediately |
| Duplicate ticket issuance detected | No | Pause ticket-related pilot activity, preserve evidence, escalate immediately |
| Admission replay accepted | No | Pause admissions, preserve evidence, escalate immediately |
| Admin/support redaction failure | No | Pause affected support workflow, preserve evidence, escalate immediately |
| Admin/support audit failure | No | Pause affected support workflow, preserve evidence, escalate immediately |
| Unapproved code/schema change appears | No | Pause pilot activity, preserve evidence, escalate immediately |
| Provider callback verification failure | No | Pause affected payment flow, preserve evidence, escalate immediately |

## Operationalization Rules

- No-go triggers are decision blockers, not suggestions.
- Local operators may pause activity and escalate; they may not convert a no-go into go.
- Evidence capture must happen before any broad workaround discussion.
- Final CTO-approved waivers must be archived with the incident record.
