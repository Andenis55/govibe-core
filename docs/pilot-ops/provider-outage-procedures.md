# Provider Outage Procedures

> This document is an operator procedure template only. It does not authorize pilot launch, production deployment, live traffic, payment acceptance, admissions, refunds, payouts, or data changes. Final CTO go/no-go approval is required before any pilot execution.

## Provider Environment Status Note

Workstream 9 does not authorize switching providers from sandbox to live mode.

Provider live-mode enablement requires separate Final CTO/business approval and provider/account approval.

Operators may record provider environment status.
Operators may not switch provider mode or treat this runbook as approval to enable live payment acceptance.

## Provider Outage Scenarios

| Scenario | Operator action | Evidence to archive | Escalation |
| --- | --- | --- | --- |
| Paystack outage | pause affected payment activity, confirm provider status, use support read-only inspection only | paymentIntent IDs, provider status summary, timestamps | Payments Lead, Provider Contact Owner, Technical Lead |
| MTN MoMo outage | pause affected payment activity, confirm provider status, use support read-only inspection only | paymentIntent IDs, provider status summary, timestamps | Payments Lead, Provider Contact Owner, Technical Lead |
| Webhook delayed delivery | monitor status, preserve evidence, do not manually advance payment state | provider webhook IDs, paymentIntent IDs, timestamps | Technical Lead, Payments Lead |
| Provider timeout spike | pause affected payment activity if sustained, preserve evidence | provider name, timeout category, redacted references, timestamps | Payments Lead, Technical Lead |
| Provider mismatch/amount/currency failures | preserve evidence and escalate unresolved mismatch | paymentIntent IDs, mismatch category, timestamps | Payments Lead, Technical Lead |
| Provider callback signature failures | pause affected callback flow and preserve evidence | webhook event IDs, signature failure category, timestamps | Technical Lead, Security/Privacy Lead |

## Rules

- Do not mark payments VERIFIED manually.
- Do not issue tickets because provider says payment is pending.
- Do not trust browser redirects.
- Do not trust callback body without verification.
- Use admin/support read-only inspection only.
- Escalate unresolved provider mismatch to technical owner.
- Archive provider incident evidence using redacted IDs/status summaries.
- Workstream 9 does not authorize provider live-mode switching.
