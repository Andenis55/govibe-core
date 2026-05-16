-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('CREATED', 'RESERVED', 'PAYMENT_PENDING', 'PAID', 'FULFILLED', 'COMPLETED', 'EXPIRED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('INITIATED', 'PENDING', 'SUCCESS', 'FAILED', 'REVERSED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "ticket_status" AS ENUM ('ISSUED', 'ACTIVE', 'USED', 'EXITED', 'INVALIDATED', 'REFUNDED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('HELD', 'EXPIRED', 'CONSUMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "admission_state" AS ENUM ('NOT_USED', 'INSIDE', 'EXITED', 'REJECTED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "scan_direction" AS ENUM ('ENTRY', 'EXIT');

-- CreateEnum
CREATE TYPE "admission_event_result" AS ENUM ('ACCEPTED', 'REJECTED', 'CONFLICT_DUPLICATE_OFFLINE_ENTRY', 'CONFLICT_EXIT_WITHOUT_ENTRY', 'CONFLICT_ALREADY_CONSUMED_ONLINE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "ledger_direction" AS ENUM ('DEBIT', 'CREDIT');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "venues" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "venues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "organizer_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "venue_id" UUID NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "capacity_total" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_types" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_ticket_inventory" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "ticket_type_id" UUID NOT NULL,
    "capacity_total" INTEGER NOT NULL,
    "reserved_count" INTEGER NOT NULL DEFAULT 0,
    "sold_count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_ticket_inventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_reservations" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "ticket_type_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "ReservationStatus" NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "reservation_id" UUID,
    "status" "order_status" NOT NULL,
    "total_amount" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_ref" TEXT,
    "status" "payment_status" NOT NULL,
    "amount" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "order_id" UUID,
    "payment_id" UUID,
    "direction" "ledger_direction" NOT NULL,
    "account_type" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "correlation_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "ticket_type_id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "order_id" UUID,
    "status" "ticket_status" NOT NULL,
    "ticket_serial" TEXT NOT NULL,
    "public_reference" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_admission_state" (
    "ticket_id" UUID NOT NULL,
    "current_state" "admission_state" NOT NULL,
    "admission_cycle_no" INTEGER NOT NULL DEFAULT 0,
    "last_entry_at" TIMESTAMP(3),
    "last_exit_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ticket_admission_state_pkey" PRIMARY KEY ("ticket_id")
);

-- CreateTable
CREATE TABLE "gates" (
    "id" UUID NOT NULL,
    "venue_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admission_events" (
    "id" UUID NOT NULL,
    "scan_event_id" UUID,
    "ticket_id" UUID NOT NULL,
    "admission_cycle_no" INTEGER NOT NULL DEFAULT 0,
    "direction" "scan_direction" NOT NULL,
    "result" "admission_event_result" NOT NULL,
    "scanned_at" TIMESTAMP(3) NOT NULL,
    "gate_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admission_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_devices" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "device_fingerprint" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offline_scan_events" (
    "scan_event_id" UUID NOT NULL,
    "ticket_id" UUID,
    "device_id" UUID,
    "direction" TEXT,
    "local_timestamp" TIMESTAMP(3),
    "server_received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reconciliation_status" TEXT NOT NULL,

    CONSTRAINT "offline_scan_events_pkey" PRIMARY KEY ("scan_event_id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "idempotency_key" TEXT NOT NULL,
    "actor_id" UUID,
    "endpoint" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_code" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("idempotency_key")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "correlation_id" UUID,
    "metadata" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suspicious_events" (
    "id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "ticket_id" UUID,
    "device_id" UUID,
    "severity" TEXT,
    "metadata" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suspicious_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_risk_flags" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "risk_type" TEXT NOT NULL,
    "risk_score" INTEGER NOT NULL,
    "flagged_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_risk_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_risk_flags" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "risk_type" TEXT NOT NULL,
    "risk_score" INTEGER NOT NULL,
    "flagged_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_risk_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processed_at" TIMESTAMP(3),
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "last_error_code" TEXT,
    "dead_lettered_at" TIMESTAMP(3),

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "idx_events_organizer" ON "events"("organizer_id");

-- CreateIndex
CREATE INDEX "idx_events_venue" ON "events"("venue_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_ticket_types_id_event" ON "ticket_types"("id", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_ticket_types_event_name" ON "ticket_types"("event_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "event_ticket_inventory_event_id_ticket_type_id_key" ON "event_ticket_inventory"("event_id", "ticket_type_id");

-- CreateIndex
CREATE INDEX "idx_reservation_event_type" ON "ticket_reservations"("event_id", "ticket_type_id");

-- CreateIndex
CREATE INDEX "idx_reservation_expiry" ON "ticket_reservations"("expires_at");

-- CreateIndex
CREATE INDEX "idx_orders_user_event_created" ON "orders"("user_id", "event_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_payments_order" ON "payments"("order_id");

-- CreateIndex
CREATE INDEX "idx_payments_status" ON "payments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_provider_ref_key" ON "payments"("provider", "provider_ref");

-- CreateIndex
CREATE INDEX "idx_ledger_order" ON "ledger_entries"("order_id");

-- CreateIndex
CREATE INDEX "idx_ledger_payment" ON "ledger_entries"("payment_id");

-- CreateIndex
CREATE INDEX "idx_tickets_event" ON "tickets"("event_id");

-- CreateIndex
CREATE INDEX "idx_tickets_owner" ON "tickets"("owner_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_ticket_serial" ON "tickets"("ticket_serial");

-- CreateIndex
CREATE UNIQUE INDEX "uq_ticket_public_ref" ON "tickets"("public_reference");

-- CreateIndex
CREATE INDEX "idx_admission_state_status" ON "ticket_admission_state"("current_state");

-- CreateIndex
CREATE UNIQUE INDEX "uq_gates_venue_label" ON "gates"("venue_id", "label");

-- CreateIndex
CREATE UNIQUE INDEX "admission_events_scan_event_id_key" ON "admission_events"("scan_event_id");

-- CreateIndex
CREATE INDEX "idx_admission_ticket" ON "admission_events"("ticket_id");

-- CreateIndex
CREATE INDEX "idx_admission_event_time" ON "admission_events"("ticket_id", "scanned_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_user_device_fingerprint" ON "user_devices"("user_id", "device_fingerprint");

-- CreateIndex
CREATE INDEX "idx_offline_ticket" ON "offline_scan_events"("ticket_id");

-- CreateIndex
CREATE INDEX "idx_offline_reconcile_status" ON "offline_scan_events"("reconciliation_status");

-- CreateIndex
CREATE INDEX "idx_risk_device" ON "device_risk_flags"("device_id");

-- CreateIndex
CREATE INDEX "idx_risk_ticket" ON "ticket_risk_flags"("ticket_id");

-- CreateIndex
CREATE INDEX "idx_outbox_dispatch" ON "outbox_events"("processed", "dead_lettered_at", "next_attempt_at", "created_at");

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_organizer_id_fkey" FOREIGN KEY ("organizer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_types" ADD CONSTRAINT "ticket_types_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_ticket_inventory" ADD CONSTRAINT "event_ticket_inventory_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_ticket_inventory" ADD CONSTRAINT "event_ticket_inventory_ticket_type_id_event_id_fkey" FOREIGN KEY ("ticket_type_id", "event_id") REFERENCES "ticket_types"("id", "event_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_reservations" ADD CONSTRAINT "ticket_reservations_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_reservations" ADD CONSTRAINT "ticket_reservations_ticket_type_id_event_id_fkey" FOREIGN KEY ("ticket_type_id", "event_id") REFERENCES "ticket_types"("id", "event_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "ticket_reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_ticket_type_id_event_id_fkey" FOREIGN KEY ("ticket_type_id", "event_id") REFERENCES "ticket_types"("id", "event_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_admission_state" ADD CONSTRAINT "ticket_admission_state_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gates" ADD CONSTRAINT "gates_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_events" ADD CONSTRAINT "admission_events_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_events" ADD CONSTRAINT "admission_events_gate_id_fkey" FOREIGN KEY ("gate_id") REFERENCES "gates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_devices" ADD CONSTRAINT "user_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offline_scan_events" ADD CONSTRAINT "offline_scan_events_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offline_scan_events" ADD CONSTRAINT "offline_scan_events_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "user_devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suspicious_events" ADD CONSTRAINT "suspicious_events_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suspicious_events" ADD CONSTRAINT "suspicious_events_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "user_devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_risk_flags" ADD CONSTRAINT "device_risk_flags_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "user_devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_risk_flags" ADD CONSTRAINT "ticket_risk_flags_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Database-only indexes that Prisma does not model precisely enough for these paths.
CREATE INDEX "idx_reservation_expiry_held"
ON "ticket_reservations"("expires_at")
WHERE "status" = 'HELD'::"ReservationStatus";

CREATE INDEX "idx_active_reservations_held"
ON "ticket_reservations"("event_id", "ticket_type_id", "expires_at")
WHERE "status" = 'HELD'::"ReservationStatus";

CREATE UNIQUE INDEX "uq_admission_events_cycle_direction_accepted"
ON "admission_events"("ticket_id", "admission_cycle_no", "direction")
WHERE "result" = 'ACCEPTED'::"admission_event_result";

COMMENT ON TABLE "ticket_admission_state" IS
  'Admission state writes must predicate on version and increment it atomically.';

COMMENT ON COLUMN "ticket_admission_state"."version" IS
  'Optimistic concurrency counter for stale update prevention and race-safe state transitions.';