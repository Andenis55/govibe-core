# Phase 3.3 Transactional Services

Phase 3.1 remains the locked runtime foundation. Phase 3.2 made the data layer executable. Phase 3.3 adds the transactional application services that form the backend core engine.

## Locked Refinements

- repository interfaces in the domain layer
- explicit use-case naming in the application layer
- request context service for correlation propagation
- global interceptors
- structured Redis services
- clarified realtime gateway boundaries
- strict config validation

## Phase 3.2 Additions

- Prisma schema for the executable data model in `prisma/schema.prisma`
- shared `PrismaService` backed by `PrismaClient`
- `TransactionRunnerService` as the application-layer transaction entry point
- repository provider tokens for inventory, orders, payments, tickets, admissions, and idempotency persistence
- concrete Prisma repositories for the critical transactional domains
- raw SQL only for row locks, optimistic concurrency updates, and tight aggregate reads
- transaction-scoped repository signatures enforced with `TxClient`

## Phase 3.3 Additions

- inventory reservation flow with tight-inventory fallback to reservation-row truth
- checkout and order creation with atomic idempotency claim
- payment verification with terminal-state protection and ledger writes
- ticket issuance with reservation consumption and sold-count updates
- admission scan validation with replay protection, row locks, and optimistic version enforcement
- audit and outbox writes inside the same transaction boundary as state changes
- repository upgrades for payment lookup by order, idempotency completion payloads, audit append, and outbox append
- QR scan event idempotency through unique `scan_event_id`

## Worker Layer

- expired reservation sweeps use `FOR UPDATE SKIP LOCKED` and batch limits to avoid blocking concurrent checkout traffic
- outbox dispatch claims unprocessed rows in batches and marks them processed inside the worker transaction
- worker flows emit telemetry and structured logs for batch size and processing counts
- request-path services remain transactionally isolated from background processors

## Module Responsibilities

### Identity

- user accounts
- authentication sessions
- device binding
- JWT lifecycle

### Organizers

- organizer entities
- staff roles
- event ownership

### Events

- event lifecycle
- scheduling
- capacity configuration

### Inventory

- ticket inventory
- reservation tracking
- TTL logic structure only

### Orders

- order aggregate root
- reservation linkage
- order state transitions later

### Payments

- payment aggregate
- provider abstraction layer
- initiated payment flow with deterministic provider references and persisted local payment state
- webhook parsing plus provider re-verification with Redis duplicate-processing lock
- provider adapters for Paystack and MTN MoMo
- refund remains explicitly unsupported until provider-specific refund orchestration is added

### Tickets

- ticket issuance
- ownership
- serial and public reference handling

### Admissions

- admission state
- scan validation engine structure for later implementation

### Offline Sync

- offline scan ingestion
- reconciliation pipeline structure only

### Fraud

- suspicious events
- risk flags
- anomaly recording

### Audit

- append-only logs
- correlation tracking

### Notifications

- SMS, email, and push abstractions
- provider adapters

### Realtime

- WebSocket gateways
- bounded event broadcasting

## Shared Infrastructure Responsibilities

### Config Module

- environment loading
- strict schema validation
- typed config access

### Prisma Module

- database connection
- transaction entry point
- repository dependency root
- shared `DbClient` and `TxClient` types for repository signatures

### Redis Module

- nonce cache
- rate limiting support
- fast lookup layer

### Logging Module

- structured logging
- correlation ID propagation

### Telemetry Module

- tracing hooks
- metrics hooks

### Auth Module

- JWT strategy
- guards including auth and roles checks

### Idempotency Module

- idempotency key validation
- request hashing
- replay-safe responses
- atomic pending-claim semantics before checkout writes begin

### Outbox Module

- event persistence
- async processing
- retry-safe publishing
- repository append inside domain transactions

### Errors Module

- global exception filter
- domain error mapping
- shared domain conflicts, replay, payment terminal-state, and invalid-transition errors

## Repository Interfaces In Domain Layer

Application use cases depend on domain repository contracts and never on Prisma repositories directly.

```ts
export interface InventoryRepository {
  lockInventory(
    eventId: string,
    ticketTypeId: string,
    tx: TxClient,
  ): Promise<unknown>;

  updateReservedCount(
    inventoryId: string,
    newReservedCount: number,
    tx: TxClient,
  ): Promise<void>;
}
```

This keeps application logic isolated, infrastructure replaceable, tests easy to mock, and module boundaries clean.

## Transaction Discipline

All critical write flows start a transaction in the application or use-case layer, pass the same `tx` handle into every repository call, and keep raw SQL locks inside that active transaction.

```ts
await this.transactionRunner.runInTransaction(async (tx) => {
  const inventory = await this.inventoryRepository.lockInventory(
    eventId,
    ticketTypeId,
    tx,
  );

  if (!inventory) {
    throw new Error('Inventory not found');
  }

  const activeReserved = await this.reservationRepository.getActiveReservationQuantity(
    eventId,
    ticketTypeId,
    tx,
  );

  void activeReserved;
});
```

Rules:

- start transactions in the application layer, not in repositories
- use raw SQL only for `SELECT ... FOR UPDATE`, version-checked updates, and tight-path aggregates
- keep standard inserts, reads, and updates on Prisma ORM
- never mix transaction-scoped writes with non-transaction-scoped writes in the same critical flow

Isolation levels:

- inventory reservation: `Serializable`
- checkout flow: `Serializable`
- payment verification: `Serializable`
- ticket issuance: `Serializable`
- admission scan: `RepeatableRead` with row locks and optimistic version checks

Worker note:

- background sweepers use `FOR UPDATE SKIP LOCKED`, not plain blocking locks
- outbox dispatchers use the same `SKIP LOCKED` pattern for safe parallel batch processing

## Application Layer Structure

All business orchestration lives in `application/use-cases`.

- Controllers call use cases, not repositories.
- Complex flows coordinate repositories and shared services from use-case classes.
- Use-case files use explicit operational names such as `reserve-inventory.use-case.ts` and `validate-admission-scan.use-case.ts`.

Core transactional use cases now implemented:

- `reserve-inventory.use-case.ts`
- `create-order.use-case.ts`
- `verify-payment.use-case.ts`
- `issue-tickets.use-case.ts`
- `validate-admission-scan.use-case.ts`

Background worker flows now implemented:

- `sweep-expired-reservations.use-case.ts`
- `OutboxService.dispatchPendingBatch()`
- `OutboxProcessor.processPending()`

## Request Context Service

Request context is a required runtime primitive backed by `AsyncLocalStorage`.

Tracked fields:

- request_id
- correlation_id
- user_id
- device_id
- organizer_id when applicable
- ip_address
- user_agent

Middleware responsibilities:

- create a request ID at request start
- reuse inbound `x-correlation-id` when valid, otherwise generate one
- attach context before the request continues
- propagate request and correlation IDs back in response headers

## Global Interceptors

Global interceptors are registered in bootstrap.

### Logging Interceptor

- logs request start and end
- attaches latency, route, method, and status
- includes request ID, correlation ID, and user or device context when present

### Correlation Interceptor

- ensures response headers include correlation and request IDs
- keeps downstream propagation aligned with request context

### Timing Interceptor

- computes execution duration
- feeds telemetry timing metrics
- flags slow paths above the configured threshold

## Structured Redis Services

### RedisService

- connection lifecycle
- raw command surface
- health checks

### NonceCacheService

- replay detection
- TTL enforcement
- atomic nonce consumption via set-if-not-exists behavior

### Payment Webhook Locking

- webhook processing uses `payment_lock:{provider}:{providerRef}` keys
- duplicate webhook deliveries are serialized through short-lived Redis locks before verification runs

## Payment Validation Path

- `npm run prisma:generate`
- `npm run build`
- `npm run payments:smoke`

Smoke-test environment variables:

- required base provider credentials: `PAYSTACK_SECRET_KEY`, `MTN_MOMO_API_KEY`, `MTN_MOMO_API_SECRET`, `MTN_MOMO_SUBSCRIPTION_KEY`, `MTN_MOMO_ENVIRONMENT`
- optional webhook authenticity secret: `MTN_MOMO_WEBHOOK_SECRET`
- Paystack smoke inputs: `PAYMENT_SMOKE_PAYSTACK_EMAIL`, optional `PAYMENT_SMOKE_PAYSTACK_AMOUNT_MINOR`, `PAYMENT_SMOKE_PAYSTACK_CURRENCY`, `PAYMENT_SMOKE_PAYSTACK_CALLBACK_URL`
- MoMo smoke inputs: `PAYMENT_SMOKE_MOMO_PHONE`, `PAYMENT_SMOKE_MOMO_CURRENCY`, optional `PAYMENT_SMOKE_MOMO_AMOUNT_MINOR`
- live execution safety switch: `PAYMENT_SMOKE_ALLOW_LIVE=true`

### AdmissionCacheService

- hot ticket state lookups
- revoked ticket checks
- admission-state priming for hot paths
- fail-open behavior to authoritative DB validation when Redis is unavailable

Use cases should depend on specialized cache services instead of the generic Redis service where possible.

### Phase 3.4 Hardening

- webhook authenticity verification uses raw-body signatures for Paystack and configurable shared-secret verification for MoMo
- provider adapters normalize timeout, auth, network, and response failures through shared provider error types
- Redis replay protection fails closed for nonce validation, while admission caching fails open back to the DB path
- QR payloads are signature-verified and schema-validated with a strict 60-second maximum lifetime window
- ticket issuance uses a shared batch reference allocator so serial and public-reference collisions retry with fresh values
- outbox dispatch uses `FOR UPDATE SKIP LOCKED`, capped exponential backoff, dead-lettering, and non-retryable error classification

### QR Rotation Policy

- one active online HMAC signing key is selected by `QR_HMAC_ACTIVE_KID`
- grace verification keys remain available as `QR_HMAC_SECRET_<kid>` during overlap windows
- old HMAC keys remain accepted for at least twice the max token lifetime plus operational buffer before removal
- offline Ed25519 verification keys remain keyed by `kid`, with old public keys retained during scanner refresh overlap
- compromised key IDs are revoked by immediate config removal and fresh token or manifest rollout

## Realtime Gateway Boundaries

Realtime is separated into bounded gateways instead of one global channel.

### Admissions Gateway

- entry and exit updates
- occupancy deltas
- gate-level scan events

### Events Gateway

- event status changes
- ticket sale milestones
- publish and unpublish updates

### Organizer Dashboard Gateway

- revenue counters
- attendance summaries
- live operational dashboard signals

### Fraud Alerts Gateway

- suspicious scan activity
- duplicate attempts
- device and ticket risk alerts

Room examples:

- `event:{eventId}`
- `organizer:{organizerId}`
- `gate:{gateId}`
- `fraud:{eventId}`

## Strict Config Validation

Configuration is fail-fast and validated before the app starts listening.

Validated categories:

- database: `DATABASE_URL`
- Redis: `REDIS_URL`
- auth: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`
- payments: `PAYSTACK_SECRET_KEY`, `MTN_MOMO_API_KEY`, `MTN_MOMO_API_SECRET`, `MTN_MOMO_SUBSCRIPTION_KEY`, `MTN_MOMO_ENVIRONMENT`
- observability: `SENTRY_DSN` when present
- app: `NODE_ENV`, `PORT`, `API_BASE_URL`

Validation rules include required keys, enum checks, URL validation, numeric coercion, and minimum secret length checks.

## DI And Provider Wiring Strategy

Services depend on interfaces or abstract contracts where useful. Infrastructure stays isolated in feature infrastructure folders and shared modules. Shared infrastructure providers remain singleton-scoped.

### Domain Repository Tokens

- `INVENTORY_REPOSITORY`
- `RESERVATION_REPOSITORY`
- `ORDER_REPOSITORY`
- `PAYMENT_REPOSITORY`
- `TICKET_REPOSITORY`
- `ADMISSION_REPOSITORY`

### Adapter Tokens

- `PAYSTACK_PROVIDER`
- `MOMO_PROVIDER`
- `SMS_PROVIDER`
- `EMAIL_PROVIDER`

### Inventory Provider Pattern

```ts
@Module({
  imports: [PrismaModule],
  providers: [
    ReserveInventoryUseCase,
    PrismaInventoryRepository,
    {
      provide: INVENTORY_REPOSITORY,
      useExisting: PrismaInventoryRepository,
    },
  ],
  exports: [INVENTORY_REPOSITORY],
})
export class InventoryModule {}
```

### Payment Provider Adapter Pattern

```ts
@Module({
  providers: [
    PaystackAdapter,
    MomoAdapter,
    {
      provide: PAYSTACK_PROVIDER,
      useExisting: PaystackAdapter,
    },
    {
      provide: MOMO_PROVIDER,
      useExisting: MomoAdapter,
    },
  ],
  exports: [PAYSTACK_PROVIDER, MOMO_PROVIDER],
})
export class PaymentsModule {}
```

### Transaction Boundary Strategy

Transactions are controlled at the service or use-case layer.

```ts
await this.prisma.$transaction(async (tx) => {
  // tx passed into repositories
});
```

Repositories accept transaction context through `RepositoryOptions`.

## Bootstrap Composition

Bootstrap wiring includes:

- validation pipe
- global exception filter
- request context middleware
- logging interceptor
- correlation interceptor
- timing interceptor

Startup expectations:

- validate environment
- initialize logger
- initialize telemetry
- connect Prisma
- connect Redis
- register global middleware, interceptors, and filters
- start the app

## Extraction-Ready Design

- each module is self-contained
- each module is layered
- each module is interface-driven
- coupling stays minimal

This keeps admissions, payments, and realtime ready for future extraction without rewriting core logic.

## Phase 3.1 Status

Phase 3.1 is now defined as a proper execution foundation with:

- repository interfaces in the domain layer
- explicit use-case structure
- request context propagation
- production interceptors
- structured Redis responsibilities
- bounded realtime gateways
- strict fail-fast config validation
