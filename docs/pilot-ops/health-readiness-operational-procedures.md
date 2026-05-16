# Health / Readiness Operational Procedures

> This document is an operator procedure template only. It does not authorize pilot launch, production deployment, live traffic, payment acceptance, admissions, refunds, payouts, or data changes. Final CTO go/no-go approval is required before any pilot execution.

## Endpoint Checks

- Check /api/health/live
- Check /api/health/ready
- Confirm current route prefix in the target environment before use

## Status Interpretation

| Signal | Meaning | Required operator action |
| --- | --- | --- |
| Liveness 200 | process responds only | continue investigation as needed; do not treat this as traffic approval |
| Readiness 200 | app appears ready to accept pilot traffic, subject to Final CTO go/no-go approval | continue only within approved pilot scope |
| Readiness 503 | app should not receive pilot traffic | pause pilot activity, escalate to Technical Lead/Final CTO, do not make infrastructure traffic changes unless authorized |

## Ready / Degraded / Not Ready Interpretation

- ready: review current dependencies and continue only within approved pilot scope
- degraded: review dependency degradation; degraded Redis does not necessarily block if PostgreSQL is healthy
- not_ready: pause pilot activity and escalate immediately

## Required Operational Rule

Readiness 503 means the app should not receive pilot traffic. The operator must pause pilot activity and escalate to the Technical Lead/Final CTO. Infrastructure traffic changes must be performed only by authorized deployment operators.

## Liveness Failure Response

- Treat liveness failure as a process availability issue.
- Pause pilot activity if availability risk affects the approved pilot.
- Escalate to the Technical Lead immediately.

## Secret-Leak Response Procedure

- Preserve evidence using IDs/status summaries only.
- Do not redistribute the leaked value.
- Escalate immediately to Security/Privacy Lead and Final CTO / Approval Owner.

## Health Endpoint Route Prefix Caveat

- This repo currently exposes health routes under /api/health/live and /api/health/ready.
- Operators must verify the deployed route prefix before using this template.
- Health response must not expose secrets.
