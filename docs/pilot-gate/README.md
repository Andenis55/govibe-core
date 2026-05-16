# Pilot Gate And Release Readiness

## Current Recommendation

Current verdict: CONDITIONAL NO-GO.

The backend and test harness are materially stronger than they were at the start of this work. Core purchase, webhook, admissions, concurrency, readiness, and retry behavior now have real evidence. The remaining blockers are not correctness bugs in the covered paths; they are observability, migration and rollback, and deployment-configuration gaps that are still too weak for a controlled pilot.

Backend launch-control enforcement now exists for checkout, payment initiation, and admissions. The remaining work is to configure the pilot values in the target environment and verify them during deployment.

Launch should not proceed until the mandatory pre-pilot items in this document are complete.

## Critical Flow Coverage Summary

| Critical flow | Evidence | Status | Notes |
| --- | --- | --- | --- |
| Reservation to order to payment initiation | [purchase-flow.spec.ts](../../test/integration/purchase/purchase-flow.spec.ts), [checkout.e2e-spec.ts](../../test/e2e/orders/checkout.e2e-spec.ts), [payments.e2e-spec.ts](../../test/e2e/payments/payments.e2e-spec.ts) | Green | Core purchase path is exercised end to end. |
| Paystack verification timeout and safe retry | [provider-operational.spec.ts](../../test/reliability/providers/provider-operational.spec.ts), [verify-payment-timeout.spec.ts](../../test/reliability/providers/verify-payment-timeout.spec.ts) | Green | Timeouts do not incorrectly advance order or payment state. |
| Paystack webhook authenticity and duplicate handling | [paystack-valid-signature.spec.ts](../../test/integration/webhooks/paystack-valid-signature.spec.ts), [paystack-tampered-body.spec.ts](../../test/integration/webhooks/paystack-tampered-body.spec.ts), [paystack-unknown-provider-ref.spec.ts](../../test/integration/webhooks/paystack-unknown-provider-ref.spec.ts), [paystack-duplicate-webhook.spec.ts](../../test/integration/webhooks/paystack-duplicate-webhook.spec.ts), [payment-webhooks.e2e-spec.ts](../../test/e2e/payments/payment-webhooks.e2e-spec.ts) | Green | Raw-body signature verification and duplicate delivery handling are proven for Paystack. |
| Inventory oversell protection | [no-oversell.spec.ts](../../test/concurrency/inventory/no-oversell.spec.ts) | Green | Concurrency protection exists for competing reservations. |
| Admission validation and rejected scan recording | [tickets-issuance-admissions.integration-spec.ts](../../test/tickets-issuance-admissions.integration-spec.ts), [admissions.e2e-spec.ts](../../test/e2e/admissions/admissions.e2e-spec.ts) | Green | Verified-payment ticket issuance, owned ticket reads, accepted scans, and rejected scan auditing are covered on the current WS5 path. |
| Authorization boundaries | [authz-boundaries.spec.ts](../../test/integration/authz/authz-boundaries.spec.ts), [tickets-issuance-admissions.integration-spec.ts](../../test/tickets-issuance-admissions.integration-spec.ts), [admissions.e2e-spec.ts](../../test/e2e/admissions/admissions.e2e-spec.ts) | Green | JWT and `admission:scan:event` route protection are proven on the current admissions surface; webhook path is signature-gated instead of JWT-gated by design. |
| Redis failure posture for gate operations | [nonce-cache.fail-closed.spec.ts](../../test/reliability/redis/nonce-cache.fail-closed.spec.ts) | Green | The current `/api/admissions/scan` path is DB-authoritative and does not depend on the retired admission-cache flow. The nonce cache helper still fails closed where it is used. |
| Outbox retry, retry exhaustion, and dead-letter behavior | [outbox.processor.spec.ts](../../test/reliability/outbox/outbox.processor.spec.ts), [outbox-operational.spec.ts](../../test/reliability/outbox/outbox-operational.spec.ts) | Green | Retryable and non-retryable failures are differentiated and dead-lettering is covered. |
| Liveness and readiness endpoints | [readiness.spec.ts](../../test/e2e/health/readiness.spec.ts), [readiness-negative.e2e-spec.ts](../../test/e2e/health/readiness-negative.e2e-spec.ts) | Green | `/api/health/live` and `/api/health/ready` are covered, including dependency failure cases. |
| Bootstrap smoke | [migration-bootstrap-smoke.spec.ts](../../test/e2e/bootstrap/migration-bootstrap-smoke.spec.ts) | Green | Bootstrap now validates `prisma migrate deploy` against the committed migration history. |
| MoMo pilot readiness | [payments-smoke.ts](../../scripts/payments-smoke.ts), [momo.adapter.ts](../../src/modules/payments/infrastructure/providers/momo.adapter.ts) | Red | Adapter exists, but MoMo does not yet have pilot-grade integration, webhook, and failure-mode evidence comparable to Paystack. |

## Mandatory Pre-Pilot Items

1. Deploy and verify metrics scraping and alert routing.
   Current state: Prometheus-format metrics are now exported from `GET /api/metrics`, and baseline alert rules exist in [ops/observability/prometheus-alerts.yaml](../../ops/observability/prometheus-alerts.yaml). Pilot operations still need scraper configuration, dashboard wiring, and on-call alert routing in the target environment.
2. Configure pilot launch controls with the exact provider, currency, organizer, event, and gate scope for the initial rollout.
   Current state: backend launch-control enforcement now exists, but production values still need to be set and verified.
3. Lock pilot scope to one payment provider and one currency pair, then hard-disable everything else in deployment configuration.
   Recommended initial scope: Paystack plus GHS. That is the most heavily exercised path in the current test corpus. If the business requires NGN or MoMo at pilot start, additional targeted validation is required before approval.
4. Execute the scripted schema rehearsal and record a successful restore cycle.
   Current state: the repo now has a real `prisma/migrations/` baseline, release scripts for `prisma migrate status` and `prisma migrate deploy`, and an executable rehearsal flow through [schema-deployment.md](./schema-deployment.md). Pilot launch still requires one successful end-to-end rehearsal on the actual deployment path.
5. Run payment smoke validation against the exact pilot credentials and callback URLs.
   Current state: the smoke script exists and includes safety guards, but launch approval should require a clean run in the pilot environment with the real sandbox or pilot credentials.

## Deferred Risks And Post-Pilot Improvements

1. MoMo should remain out of pilot scope until it has parity with Paystack for initiation, verification, webhook authenticity, duplicate delivery, provider timeout, and operational failure tests.
2. Observability should evolve from minimum viable counters to full traces, dashboards, and release markers.
3. A dedicated organizer-only HTTP surface should be added and explicitly authorization-tested when those routes exist.
4. Rollout automation can move from environment allowlists to a formal feature-flag service after the initial pilot.
5. Offline sync should not be treated as a primary pilot operating mode until it has equivalent operational proofs and venue rehearsal coverage.

## Pilot Scope Decision

Recommended pilot scope:

- Single payment provider: Paystack.
- Single currency for the first launch ring: GHS.
- Small organizer cohort only.
- Staffed entry gates only.
- QR-based admissions only.
- No MoMo in the initial launch ring.
- No unattended self-service gate operations.
- No release containing unreviewed schema changes.

The reason for this recommendation is simple: the proven surface area is not evenly distributed. Paystack and GHS dominate the current integration and reliability evidence. MoMo is present in code and config, but not at the same operational confidence level.

Detailed rollout controls are in [scope-and-controls.md](./scope-and-controls.md).

## Go Or No-Go Criteria

All of the following must be true for a GO decision:

1. `npm run build`, `npm test`, and `npm run test:bootstrap-smoke` are green on the release commit.
2. Payment smoke is green against the exact pilot credentials and callback URLs.
3. `/api/health/live` and `/api/health/ready` are green in the pilot environment after deployment.
4. `/api/metrics` is being scraped successfully, and alerting is active for HTTP latency, readiness failures, dependency health, and outbox dispatch failures.
5. Backend launch controls are in place to restrict provider, organizer, event, and gate scope.
6. A rollback rehearsal has been performed for the exact release process, including the scripted database-side rehearsal and the environment-specific artifact redeploy step.
7. Gate operators have the manual fallback runbook and a tested reconciliation path.

If any of the above is false, the decision remains NO-GO.

## Rollback Posture

Current rollback posture is migration-backed but still rehearsal-dependent.

- If a release contains no schema change, rollback can be handled by redeploying the previous artifact and re-running health checks.
- If a release contains schema changes, use the pre-deploy database snapshot and restore path documented in [schema-deployment.md](./schema-deployment.md) before redeploying the previous artifact.
- For pilot launch, do not ship schema-changing releases until the backup and restore rehearsal has been performed on the actual deployment path.

## Supporting Documents

- [../pilot-readiness/ws8-evidence-packet-template.md](../pilot-readiness/ws8-evidence-packet-template.md)
- [../pilot-readiness/critical-flow-coverage-matrix.md](../pilot-readiness/critical-flow-coverage-matrix.md)
- [../pilot-readiness/pilot-readiness-validation-matrix.md](../pilot-readiness/pilot-readiness-validation-matrix.md)
- [../pilot-readiness/no-go-triggers.md](../pilot-readiness/no-go-triggers.md)
- [../pilot-readiness/pilot-readiness-checklist.md](../pilot-readiness/pilot-readiness-checklist.md)
- [../pilot-readiness/ci-validation-commands.md](../pilot-readiness/ci-validation-commands.md)
- [../pilot-ops/ws9-operator-index.md](../pilot-ops/ws9-operator-index.md)
- [deployment-checklist.md](./deployment-checklist.md)
- [runbooks.md](./runbooks.md)
- [observability-minimum.md](./observability-minimum.md)
- [schema-deployment.md](./schema-deployment.md)
- [scope-and-controls.md](./scope-and-controls.md)
- [ws5-tickets-admissions-evidence.md](./ws5-tickets-admissions-evidence.md)
