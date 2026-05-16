# Workstream 5 Tickets Issuance And Admissions Evidence

## Final CTO Closure

- Project: GoVibe
- Governing baseline: GoVibe Governing Package v1.0.1
- Review type: Repo evidence closure review
- Final CTO status: approved and closed
- Implementation blockers: none
- Workstream 6: not started

## Review Scope

- Approved scope implemented: issue exactly one ticket from a `PaymentIntent.VERIFIED`, expose owned ticket read routes, admit tickets through `POST /api/admissions/scan`, and persist issuance plus admission audit evidence.
- Review status: final CTO closure accepted.
- Evidence packet accepted as the stable Workstream 5 closure artifact. This note does not replace the broader pilot decision in [README.md](./README.md).

## Accepted Evidence

- Evidence packet: [ws5-tickets-admissions-evidence.md](./ws5-tickets-admissions-evidence.md)
- Stable repo entrypoint: [README.md](./README.md)
- Prisma generate: passed
- WS5 migration deploy on clean PostgreSQL 16: passed
- WS5 focused suite: passed, 58 tests
- Regression slice: passed, 147 tests
- Nest build: passed
- Intermediate CTO evidence review: pass

## Implementation Evidence

### Schema And Migration

- Schema additions and active enums: [prisma/schema.prisma](../../prisma/schema.prisma)
  - [TicketStatus](../../prisma/schema.prisma#L143)
  - [AdmissionScanStatus](../../prisma/schema.prisma#L157)
  - [AdmissionRejectionReason](../../prisma/schema.prisma#L164)
  - [Ticket](../../prisma/schema.prisma#L579)
  - [TicketIssuanceAuditLog](../../prisma/schema.prisma#L625)
  - [AdmissionScanAudit](../../prisma/schema.prisma#L652)
- Migration artifact: [20260512010000_tickets_issuance_admissions/migration.sql](../../prisma/migrations/20260512010000_tickets_issuance_admissions/migration.sql)
  - ticket table evolution at [line 26](../../prisma/migrations/20260512010000_tickets_issuance_admissions/migration.sql#L26)
  - ticket issuance audit table at [line 60](../../prisma/migrations/20260512010000_tickets_issuance_admissions/migration.sql#L60)
  - admission scan audit table at [line 76](../../prisma/migrations/20260512010000_tickets_issuance_admissions/migration.sql#L76)

### Permission And Auth Surface

- New permissions: [src/common/constants/permissions.ts](../../src/common/constants/permissions.ts#L26)
- Role grants: [src/auth/auth.types.ts](../../src/auth/auth.types.ts#L21), [src/auth/auth.types.ts](../../src/auth/auth.types.ts#L39), [src/auth/auth.types.ts](../../src/auth/auth.types.ts#L63)

### Payments Boundary

- Additive read-only ticket issuance contract: [src/modules/payments/domain/repositories/payment-intent.repository.interface.ts](../../src/modules/payments/domain/repositories/payment-intent.repository.interface.ts#L4)
- Repository method: [src/modules/payments/domain/repositories/payment-intent.repository.interface.ts](../../src/modules/payments/domain/repositories/payment-intent.repository.interface.ts#L39)
- Prisma implementation: [src/modules/payments/infrastructure/repositories/prisma-payment-intent.repository.ts](../../src/modules/payments/infrastructure/repositories/prisma-payment-intent.repository.ts#L66)

### Ticket Issuance And Reads

- Token and ticket material generation: [src/modules/tickets/application/ticket-token.service.ts](../../src/modules/tickets/application/ticket-token.service.ts#L6)
- Verified-payment issuance service: [src/modules/tickets/application/ticket-issuance.service.ts](../../src/modules/tickets/application/ticket-issuance.service.ts#L41)
- Owned ticket read service: [src/modules/tickets/application/tickets.service.ts](../../src/modules/tickets/application/tickets.service.ts#L16)
- HTTP routes: [src/modules/tickets/controllers/tickets.controller.ts](../../src/modules/tickets/controllers/tickets.controller.ts#L13)
- Repository contract: [src/modules/tickets/domain/repositories/ticket.repository.interface.ts](../../src/modules/tickets/domain/repositories/ticket.repository.interface.ts#L61)
- Prisma persistence: [src/modules/tickets/infrastructure/repositories/prisma-ticket.repository.ts](../../src/modules/tickets/infrastructure/repositories/prisma-ticket.repository.ts#L166)

### Admissions Scan And Audit

- Admission decision service: [src/modules/admissions/application/admissions.service.ts](../../src/modules/admissions/application/admissions.service.ts#L29)
- Scan entrypoint: [src/modules/admissions/application/admissions.service.ts](../../src/modules/admissions/application/admissions.service.ts#L38)
- Rejection classification logic: [src/modules/admissions/application/admissions.service.ts](../../src/modules/admissions/application/admissions.service.ts#L208)
- Durable audit service: [src/modules/admissions/application/admission-audit.service.ts](../../src/modules/admissions/application/admission-audit.service.ts#L12)
- Prisma audit persistence: [src/modules/admissions/infrastructure/repositories/prisma-admission.repository.ts](../../src/modules/admissions/infrastructure/repositories/prisma-admission.repository.ts#L70)
- HTTP route: [src/modules/admissions/controllers/admissions.controller.ts](../../src/modules/admissions/controllers/admissions.controller.ts#L14)

## Validation Evidence

### Schema Validation

- `npm run prisma:generate` passed after the WS5 schema and migration landed.
- `npx prisma migrate deploy` was executed against a clean disposable PostgreSQL 16 database on `localhost:5450` and applied the full migration history, including [20260512010000_tickets_issuance_admissions/migration.sql](../../prisma/migrations/20260512010000_tickets_issuance_admissions/migration.sql).

### Test Validation

- WS5 admissions controller e2e: [test/e2e/admissions/admissions.e2e-spec.ts](../../test/e2e/admissions/admissions.e2e-spec.ts#L50)
  - result: 3 passing tests
- WS5 integration suite: [test/tickets-issuance-admissions.integration-spec.ts](../../test/tickets-issuance-admissions.integration-spec.ts#L107)
  - result: 58 passing tests
- Requested regression slice:
  - [test/auth/auth.integration-spec.ts](../../test/auth/auth.integration-spec.ts)
  - [test/organizer-event.integration-spec.ts](../../test/organizer-event.integration-spec.ts)
  - [test/e2e/orders/checkout.e2e-spec.ts](../../test/e2e/orders/checkout.e2e-spec.ts)
  - [test/e2e/payments/payments.e2e-spec.ts](../../test/e2e/payments/payments.e2e-spec.ts)
  - [test/integration/purchase/purchase-flow.spec.ts](../../test/integration/purchase/purchase-flow.spec.ts)
  - [test/payments-verification-webhooks.integration-spec.ts](../../test/payments-verification-webhooks.integration-spec.ts)
  - [test/tickets-issuance-admissions.integration-spec.ts](../../test/tickets-issuance-admissions.integration-spec.ts)
  - result: 147 passing tests

### Build Validation

- `npm run build` passed on the current workspace state.

## Closure Basis

- Ticket issuance occurs only from the verified payment boundary.
- Ticket issuance is idempotent.
- Ticket ownership read surface is enforced.
- Ticket token service exists and does not expose raw token or hash material on the owned read surface.
- Admission scan validation is implemented.
- Admission replay prevention is implemented.
- Admission audit logging is durable.
- Permission and auth boundary is enforced.
- Focused WS5 tests passed.
- Broader regression coverage passed.
- Build passed.

## Scope Boundary Accepted

- Workstream 1: approved and closed.
- Workstream 2: approved and closed.
- Pre-WS3 Security Patch: approved and closed.
- Workstream 3: approved and closed.
- Workstream 4: approved and closed.
- Workstream 5: approved and closed.
- Workstream 6: not started.

Excluded from this workstream and still preserved:

- No new payment initiation logic.
- No new payment verification or webhook logic.
- No payouts.
- No refunds.
- No tables or bottle service.
- No admin or support tooling.
- No observability workstream.
- No pilot runbooks as part of WS5 scope.
- No CityOps.

## Accepted Caveat

- The WS5 migration was hand-authored.
- This is accepted as non-blocking because it was validated through clean `prisma migrate deploy` on PostgreSQL 16, `npm run prisma:generate`, the focused WS5 suite, the broader regression slice, and `npm run build`.

## Review Notes

- Payment verification and webhook behavior from Workstream 4 was preserved. The payments module change is additive and read-only for ticket issuance data access.
- The WS5 Prisma migration was hand-authored and then deploy-validated against a clean PostgreSQL instance. That was chosen because a long Windows PowerShell bootstrap plus Prisma one-liner stalled in the terminal wrapper even though the individual `initdb`, `pg_ctl`, `createdb`, and Prisma steps succeeded when run separately.
- Pilot-gate documentation has been aligned to the active admissions route and permission surface. Legacy references to `POST /api/admissions/validate` and `admissions:scan` were updated to `POST /api/admissions/scan` and `admission:scan:event`.

## Locked Boundary

Do not begin Workstream 6 automatically.

Next valid command only:

`Begin Workstream 6: Observability / Health / Rollback`