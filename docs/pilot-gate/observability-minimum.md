# Observability Minimum For Pilot

## Current State

Current logging is usable. Metrics export is now wired. Traces are still not.

- `AppLoggerService` provides structured application logging with correlation-aware context.
- `TelemetryService` now exports Prometheus-formatted metrics on `GET /api/metrics` in production and `GET /metrics` in test apps without a global prefix.
- `SENTRY_DSN` is present in config validation, but no runtime sink wiring was found.

This means the code now has a real metrics sink, but pilot readiness still depends on scraping, dashboards, alert routing, and on-call ownership in the deployment environment.

## Minimum Signals Required Before Pilot

The following signals already exist in code and should be exported before launch:

- `app.bootstrap.initialized`
- `http.request.duration`
- `http.request.slow`
- `outbox.processor.enforced_batch_size`
- `outbox.processor.dispatch_failed`
- `outbox.processor.completed`
- `inventory.expired_reservations.swept`

The metrics families exported by the app are:

- `govibe_application_events_total`
- `govibe_application_counters_total`
- `govibe_application_gauges`
- `govibe_application_duration_milliseconds`

Alert rules for the pilot baseline are in [ops/observability/prometheus-alerts.yaml](../../ops/observability/prometheus-alerts.yaml).

## Required Route Coverage

At minimum, route-level visibility must exist for:

- `GET /api/health/live`
- `GET /api/health/ready`
- `POST /api/payments/initiate`
- `POST /api/payments/webhooks/paystack`
- `POST /api/admissions/scan`

If MoMo is in scope, add:

- `POST /api/payments/webhooks/momo`

## Minimum Dashboards

1. API health dashboard.
   Show readiness availability, liveness availability, request rate, 5xx rate, and deploy markers.
2. Payments dashboard.
   Show initiation request rate, 5xx rate, provider timeout rate, webhook success rate, and signature failure count.
3. Admissions dashboard.
   Show request rate, p95 latency, rejection rate, and error rate for `POST /api/admissions/scan`.
4. Outbox dashboard.
   Show processed count, dispatch failures by error code, retry counts, and dead-letter count.

## Minimum Alerts

1. Readiness red for more than 2 minutes.
2. `POST /api/admissions/scan` p95 latency above 750 ms for 5 minutes.
3. `POST /api/admissions/scan` 5xx rate above 1% for 5 minutes.
4. `POST /api/payments/initiate` 5xx rate above 1% for 10 minutes.
5. Webhook signature failures above 3 events in 5 minutes.
6. Any outbox dead-letter event.
7. Sustained `outbox.processor.dispatch_failed` growth over 10 minutes.
8. Redis connectivity failures.
9. Postgres connectivity failures.

## Logging Requirements

Every log event used operationally should include:

- timestamp
- severity
- correlation ID
- request ID when present
- route or logical operation
- provider name when payment-related
- event ID when outbox-related
- gate ID when admissions-related

## Acceptance Criteria

Observability is acceptable for pilot only when:

1. The telemetry sink is active in the target environment.
2. Prometheus or the equivalent scraper is collecting `GET /api/metrics` successfully.
3. At least the minimum dashboards above exist.
4. At least the minimum alerts above are routed to an on-call owner.
5. The alert rules in [ops/observability/prometheus-alerts.yaml](../../ops/observability/prometheus-alerts.yaml) are deployed or translated into the platform alerting system.
6. A release marker or deployment annotation is visible for each pilot deployment.
7. Operators can trace a payment or admission incident end to end using correlation IDs.

Until then, observability remains a launch blocker rather than a nice-to-have.
