# Rollback Procedures

> This document is an operator procedure template only. It does not authorize pilot launch, production deployment, live traffic, payment acceptance, admissions, refunds, payouts, or data changes. Final CTO go/no-go approval is required before any pilot execution.

Rollback is an operator procedure template only.
It does not authorize destructive action by default.

## Rollback Decision Matrix

| Rollback path | Allowed default? | Required approval | Evidence required | Forbidden actions |
| --- | --- | --- | --- | --- |
| Operational pause | yes | operator may pause, then escalate | time, reason, health/payment/admission evidence | data mutation, manual verification, manual ticket/admission repair |
| Application rollback | only by authorized deployment owner | Technical Lead or Final CTO depending severity | pre/post health, build identifier, commit, incident reason | changing DB state manually, skipping evidence capture |
| Database rollback | no | explicit Final CTO approval | full impact statement, backup status, affected users/payments/tickets/admissions/audits | any destructive action affecting users, payments, tickets, admissions, audit logs, or support logs without approval |

## Mandatory Statements

Rollback is not a substitute for manual payment, ticket, admission, audit, or support-log repair.

No destructive database rollback is allowed by default.
Any DB rollback that could affect payment, ticket, admission, audit, or user data requires separate explicit approval.

## Evidence Capture Checklist

- [ ] Incident reason recorded
- [ ] Time of rollback decision recorded
- [ ] Approval owner recorded
- [ ] Health state before action recorded
- [ ] Health state after action recorded
- [ ] Evidence archive updated
