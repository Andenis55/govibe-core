# CI Validation Commands

> This document is a validation/evidence artifact only. It does not authorize launch, does not define a production runbook, does not perform deployment, and does not replace Final CTO approval.

Use the exact commands below for Workstream 8 validation evidence.

## Prisma Generate

```txt
npx prisma generate
```

## Focused WS8 Reliability Validation

```txt
npx jest --runInBand test/reliability/critical-flows.reliability.spec.ts test/reliability/idempotency-concurrency.reliability.spec.ts test/reliability/provider-failures.reliability.spec.ts test/reliability/audit-fail-closed.reliability.spec.ts test/reliability/admission-replay.reliability.spec.ts test/reliability/health-readiness.reliability.spec.ts
```

## Workstreams 1-8 Regression Validation

```txt
npx jest --runInBand test/integration/authz/authz-boundaries.spec.ts test/organizer-event.integration-spec.ts test/e2e/orders/checkout.e2e-spec.ts test/e2e/payments/payments.e2e-spec.ts test/integration/purchase/purchase-flow.spec.ts test/payments-verification-webhooks.integration-spec.ts test/tickets-issuance-admissions.integration-spec.ts test/e2e/health/health.e2e-spec.ts test/e2e/health/readiness.spec.ts test/e2e/health/readiness-negative.e2e-spec.ts test/admin-support.integration-spec.ts test/reliability/critical-flows.reliability.spec.ts test/reliability/idempotency-concurrency.reliability.spec.ts test/reliability/provider-failures.reliability.spec.ts test/reliability/audit-fail-closed.reliability.spec.ts test/reliability/admission-replay.reliability.spec.ts test/reliability/health-readiness.reliability.spec.ts
```

## Build Validation

```txt
npm run build
```

No deployment commands, launch commands, or production runbook steps are authorized in this document.