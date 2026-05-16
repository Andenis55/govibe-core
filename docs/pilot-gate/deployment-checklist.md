# Pilot Deployment Checklist

## Release Preparation

1. Freeze the release commit SHA and deployment window.
2. Confirm the pilot scope in [scope-and-controls.md](./scope-and-controls.md) is still accurate.
3. Verify environment configuration for the target deployment:
   - `APP_NAME`
   - `NODE_ENV`
   - `PORT`
   - `DATABASE_URL`
   - `REDIS_URL`
   - `JWT_ACCESS_SECRET`
   - `JWT_REFRESH_SECRET`
   - `JWT_ACCESS_TTL`
   - `JWT_REFRESH_TTL`
   - `PAYSTACK_SECRET_KEY`
   - `MTN_MOMO_API_KEY`
   - `MTN_MOMO_API_SECRET`
   - `MTN_MOMO_SUBSCRIPTION_KEY`
   - `MTN_MOMO_ENVIRONMENT`
   - `MTN_MOMO_WEBHOOK_SECRET` if MoMo is enabled in any environment
   - `QR_HMAC_ACTIVE_KID`
   - `QR_HMAC_ACTIVE_SECRET`
   - `API_BASE_URL`
   - `PILOT_CHECKOUT_ENABLED`
   - `PILOT_PAYMENTS_ENABLED`
   - `PILOT_ADMISSIONS_ENABLED`
   - `PILOT_ALLOWED_PAYMENT_PROVIDERS`
   - `PILOT_ALLOWED_CURRENCIES`
   - `PILOT_ALLOWED_ORGANIZER_IDS`
   - `PILOT_ALLOWED_EVENT_IDS`
   - `PILOT_ALLOWED_GATE_IDS`
   - Prometheus or equivalent scraper configuration for `GET /api/metrics`
   - Alert-rule deployment from [ops/observability/prometheus-alerts.yaml](../../ops/observability/prometheus-alerts.yaml)
   - `SENTRY_DSN` if exception forwarding is added later
4. Confirm that secrets are real values, not placeholders.
5. If MoMo is out of pilot scope, verify that `PILOT_ALLOWED_PAYMENT_PROVIDERS` excludes it. Do not rely on undocumented client behavior.
6. If the release contains schema changes, confirm a pre-deploy database snapshot exists and the restore procedure from [schema-deployment.md](./schema-deployment.md) has been rehearsed.
7. If the release process has changed materially, rerun `npm run schema:rehearsal:plan` and `npm run schema:rehearsal:run` before approving the deployment.

## Build And Test Gate

Run the following on the release commit:

```bash
npm ci
npm run prisma:generate
npm run prisma:migrate:status
npm run build
npm test
npm run test:bootstrap-smoke
```

Required result: all commands succeed.

If the release includes schema changes or the deployment process changed, also confirm the most recent `npm run schema:rehearsal:run` artifacts are attached to the release record.

## Payment Provider Validation Gate

1. Prepare the exact pilot environment credentials.
2. Confirm callback URLs and provider dashboard settings match `API_BASE_URL`.
3. Run:

```bash
npm run payments:smoke
```

If the pilot is provider-scoped, set `PAYMENT_SMOKE_PROVIDERS` explicitly for the smoke lane. The script now defaults to `PILOT_ALLOWED_PAYMENT_PROVIDERS` when present, otherwise it validates both providers.

1. Confirm the smoke lane is pointed at sandbox or explicitly approved live-like credentials.
2. If `PAYMENT_SMOKE_ALLOW_LIVE=true` is required, treat that as a separate approval item.
3. Record the smoke output with timestamp and operator name in the release record.

Examples:

- Paystack-only pilot smoke: `PAYMENT_SMOKE_PROVIDERS=paystack npm run payments:smoke`
- Inherit provider scope from pilot controls: set `PILOT_ALLOWED_PAYMENT_PROVIDERS=paystack` and run `npm run payments:smoke`

## Deployment Execution

1. Deploy the release artifact.
2. If the release contains schema changes, take a pre-deploy database snapshot.
3. Run:

```bash
npm run prisma:migrate:deploy
```

1. Start the service.
2. Verify startup logs show successful bootstrap.
3. Verify the live endpoint:

```text
GET /api/health/live
```

Expected result:

```json
{"status":"ok","service":"govibe-api"}
```

1. Verify the ready endpoint:

```text
GET /api/health/ready
```

Expected result:

```json
{"status":"ready","dependencies":{"postgres":"ok","redis":"ok"}}
```

1. Confirm `GET /api/metrics` responds successfully and contains the Govibe metric families.
2. Confirm Prometheus or the platform scraper is collecting `GET /api/metrics`.
3. Confirm alerting is armed from [ops/observability/prometheus-alerts.yaml](../../ops/observability/prometheus-alerts.yaml) or the equivalent translated rules.
4. Confirm release markers or deployment annotations are visible in the observability system.

## Post-Deploy Functional Checks

1. Execute one synthetic purchase through the approved pilot provider.
2. Confirm payment initiation succeeds on `POST /api/payments/initiate` with an idempotency key.
3. Confirm the resulting order and payment records are created in `orders` and `payments`.
4. Confirm webhook processing updates payment and order state correctly.
5. Confirm one controlled gate scan succeeds on `POST /api/admissions/scan` using an operator account with `admission:scan:event`.
6. Confirm the scan creates the expected state transition and audit trail.
7. Confirm no dead-lettered outbox events appear after the smoke transaction.

## Launch Approval Checklist

All boxes must be true:

- Build is green.
- Test suite is green.
- Bootstrap smoke is green.
- Payment smoke is green.
- `/api/health/live` is green.
- `/api/health/ready` is green.
- Metrics and alerts are live.
- Launch controls are configured and active.
- Runbooks are distributed to support and gate operators.
- Rollback owner is assigned.

If any item is false, do not open the pilot.
