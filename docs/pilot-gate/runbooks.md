# Operational Runbooks

## 1. Readiness Failure: Postgres Unavailable

Symptoms:

- `GET /api/health/ready` fails.
- Application logs show database connection or query errors.
- Purchase, webhook, and admissions traffic may fail.

Immediate actions:

1. Stop new pilot traffic if the failure lasts more than 2 minutes.
2. Confirm whether the database is reachable from the application network.
3. Verify connection limits, storage, failover state, and recent infrastructure changes.
4. Do not restart the application repeatedly until the database state is understood.

Recovery check:

1. `GET /api/health/ready` returns healthy.
2. Synthetic order creation succeeds.
3. No growing backlog appears in `outbox_events`.

Manual fallback:

- Gate scanning should switch to manual admission checks only if the venue has a pre-approved manifest or operator lookup path.
- Do not continue normal QR validation when the authoritative database path is unavailable.

## 2. Readiness Failure: Redis Unavailable

Symptoms:

- `GET /api/health/ready` fails.
- Logs show Redis ping or connection failures.
- The current `/api/admissions/scan` flow remains available on its DB-authoritative path, but any Redis-backed coordination that still depends on nonce or lock helpers is impaired.

Immediate actions:

1. Keep the pilot in a guarded operating mode rather than fully normal mode.
2. Verify whether the outage is isolated to Redis or part of a broader network issue.
3. Treat nonce-backed replay protection and webhook coordination as impaired until Redis is restored.

Operational impact based on current code:

- The current WS5 admissions scan path is already DB-authoritative and does not depend on the retired admission-cache flow.
- Nonce replay protection fails closed, so any path that still depends on nonce consumption should be treated as unavailable.
- Payment webhook serialization relies on Redis-backed short-lived locks, so duplicate-delivery protection is degraded if Redis is down.

Manual fallback:

1. Reduce gate throughput and add operator supervision.
2. If admission latency becomes unacceptable, switch the affected gate to manual verification.
3. Record every manual admit with ticket reference, gate, timestamp, and operator name for later reconciliation.

Recovery check:

1. `GET /api/health/ready` returns healthy.
2. A controlled scan through `POST /api/admissions/scan` succeeds.
3. Webhook processing resumes without new signature or duplicate-processing anomalies.

## 3. Payment Timeout Or Unknown Payment State

Symptoms:

- `POST /api/payments/initiate` returns a timeout or 5xx.
- A provider dashboard shows pending activity but the application state is unclear.
- Customer reports a charge attempt without confirmation.

Immediate actions:

1. Do not create a second order.
2. Retry payment initiation with the same idempotency key and identical request body.
3. Check the current order and payment records before any further customer action.

Useful queries:

```sql
select id, status, total_amount, currency, created_at
from orders
where id = '<order-id>';

select id, order_id, provider, provider_ref, status, amount, created_at
from payments
where order_id = '<order-id>'
order by created_at desc;
```

Decision rules:

- If no payment row exists, re-initiation with the same idempotency key is the preferred recovery path.
- If a payment row exists with `INITIATED` or `PENDING`, do not create another payment until provider state is verified.
- If a payment row is already `SUCCESS`, do not retry initiation.

Manual fallback for support:

1. Put the order in operator review rather than asking the customer to retry blindly.
2. Confirm provider state from the provider dashboard using `provider_ref` when available.
3. If the provider captured funds but webhook completion failed, reconcile the order before issuing any new payment link.
4. If state cannot be resolved quickly, stop the transaction and issue a customer follow-up rather than risking duplicate charge attempts.

## 4. Webhook Signature Failures

Symptoms:

- Repeated 4xx responses on `POST /api/payments/webhooks/paystack` or `POST /api/payments/webhooks/momo`.
- Logs show signature validation failures.
- Provider dashboard shows successful payments that are not being reflected in the application.

Immediate actions:

1. Confirm the correct secret is configured.
2. Confirm any proxy, CDN, or ingress layer is not rewriting the request body.
3. Confirm required signature headers are forwarded unchanged.
4. For MoMo, confirm `MTN_MOMO_WEBHOOK_SECRET` is set when MoMo is enabled.

Diagnosis notes:

- Paystack authenticity depends on raw-body signature validation.
- MoMo authenticity depends on the configured shared secret and `x-momo-signature`.
- Replaying a payload with a modified body is expected to fail.

Manual fallback:

1. Do not mark orders paid purely from a customer claim.
2. Use provider dashboard evidence plus `provider_ref` to reconcile the payment.
3. After the secret or proxy issue is fixed, reprocess only the affected events under change control.

## 5. Outbox Backlog Or Dead-Letter Growth

Symptoms:

- `outbox.processor.dispatch_failed` increases.
- Dead-lettered rows appear in `outbox_events`.
- Notifications or downstream side effects stop appearing.

Inspection query:

```sql
select id, event_type, processed, retry_count, next_attempt_at, last_error_code, dead_lettered_at, created_at
from outbox_events
where processed = false
order by created_at asc;
```

Immediate actions:

1. Identify whether the failure is retryable infrastructure failure or non-retryable payload or auth failure.
2. If the root cause is credentials, signature validation, or malformed payload, fix the root cause before any replay.
3. If the root cause is transient network or provider timeout, verify the dependency has recovered first.

Controlled requeue example:

```sql
update outbox_events
set dead_lettered_at = null,
    retry_count = 0,
    next_attempt_at = now(),
    last_error_code = null
where id = '<event-id>';
```

Use the requeue procedure only after root cause correction and with an operator record of who performed it.

Recovery check:

1. The outbox backlog drains.
2. No new dead-letter rows appear for the same error class.
3. The downstream side effect is observed exactly once.

## 6. Gate Operations Degraded: Manual Admission Fallback

Use this only when the normal scanning path cannot meet pilot safety or throughput expectations.

Trigger conditions:

- `POST /api/admissions/scan` is failing or timing out repeatedly.
- Redis degradation causes unacceptable latency at the gate.
- Venue network conditions prevent reliable online verification.

Manual fallback procedure:

1. Pause the affected gate and move it into supervised manual mode.
2. Use the pre-approved attendee manifest or operator lookup process.
3. For each admitted guest, record ticket reference, gate, timestamp, and operator name.
4. Keep a separate record of denied or suspicious attempts.
5. Reconcile manual admissions into the system after the incident window ends.

Rules:

- Do not mix unsupervised manual entry with active automated scans at the same gate.
- Do not use manual mode without a reconciliation owner.
- Do not continue admitting guests if the venue cannot establish a trusted attendee source.
