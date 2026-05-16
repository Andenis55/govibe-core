-- CreateEnum
CREATE TYPE "venue_table_status" AS ENUM ('ACTIVE', 'INACTIVE', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "event_table_status" AS ENUM ('AVAILABLE', 'HELD', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "table_reservation_status" AS ENUM ('HELD', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "table_audit_event" AS ENUM (
  'VENUE_TABLE_CREATED',
  'VENUE_TABLE_UPDATED',
  'EVENT_TABLE_CREATED',
  'EVENT_TABLE_UPDATED',
  'TABLE_HOLD_CREATED',
  'TABLE_HOLD_EXPIRED',
  'TABLE_HOLD_CANCELLED',
  'TABLE_RESERVATION_REJECTED'
);

-- CreateTable
CREATE TABLE "venue_floor_sections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizer_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "venue_floor_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "venue_tables" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizer_id" UUID NOT NULL,
    "floor_section_id" UUID,
    "label" TEXT NOT NULL,
    "seat_count" INTEGER NOT NULL,
    "status" "venue_table_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "venue_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_tables" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizer_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "venue_table_id" UUID NOT NULL,
    "status" "event_table_status" NOT NULL DEFAULT 'AVAILABLE',
    "price_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "hold_expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "table_reservations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_user_id" UUID NOT NULL,
    "organizer_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "event_table_id" UUID NOT NULL,
    "status" "table_reservation_status" NOT NULL DEFAULT 'HELD',
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "idempotency_use_case" TEXT NOT NULL DEFAULT 'tables.hold',
    "idempotency_key_hash" TEXT NOT NULL,
    "request_fingerprint_hash" TEXT NOT NULL,
    "hold_expires_at" TIMESTAMP(3) NOT NULL,
    "cancelled_at" TIMESTAMP(3),
    "expired_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "table_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "table_audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_user_id" UUID,
    "organizer_id" UUID,
    "event_id" UUID,
    "venue_table_id" UUID,
    "event_table_id" UUID,
    "reservation_id" UUID,
    "event" "table_audit_event" NOT NULL,
    "reason" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "table_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "venue_floor_sections_organizer_id_name_key" ON "venue_floor_sections"("organizer_id", "name");

-- CreateIndex
CREATE INDEX "venue_floor_sections_organizer_id_idx" ON "venue_floor_sections"("organizer_id");

-- CreateIndex
CREATE UNIQUE INDEX "venue_tables_organizer_id_label_key" ON "venue_tables"("organizer_id", "label");

-- CreateIndex
CREATE INDEX "venue_tables_organizer_id_idx" ON "venue_tables"("organizer_id");

-- CreateIndex
CREATE INDEX "venue_tables_floor_section_id_idx" ON "venue_tables"("floor_section_id");

-- CreateIndex
CREATE INDEX "venue_tables_status_idx" ON "venue_tables"("status");

-- CreateIndex
CREATE UNIQUE INDEX "event_tables_event_id_venue_table_id_key" ON "event_tables"("event_id", "venue_table_id");

-- CreateIndex
CREATE INDEX "event_tables_organizer_id_idx" ON "event_tables"("organizer_id");

-- CreateIndex
CREATE INDEX "event_tables_event_id_idx" ON "event_tables"("event_id");

-- CreateIndex
CREATE INDEX "event_tables_venue_table_id_idx" ON "event_tables"("venue_table_id");

-- CreateIndex
CREATE INDEX "event_tables_status_idx" ON "event_tables"("status");

-- CreateIndex
CREATE INDEX "event_tables_hold_expires_at_idx" ON "event_tables"("hold_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "table_reservations_actor_user_id_idempotency_use_case_idempotency_key_hash_key" ON "table_reservations"("actor_user_id", "idempotency_use_case", "idempotency_key_hash");

-- CreateIndex
CREATE INDEX "table_reservations_actor_user_id_idx" ON "table_reservations"("actor_user_id");

-- CreateIndex
CREATE INDEX "table_reservations_organizer_id_idx" ON "table_reservations"("organizer_id");

-- CreateIndex
CREATE INDEX "table_reservations_event_id_idx" ON "table_reservations"("event_id");

-- CreateIndex
CREATE INDEX "table_reservations_event_table_id_idx" ON "table_reservations"("event_table_id");

-- CreateIndex
CREATE INDEX "table_reservations_status_idx" ON "table_reservations"("status");

-- CreateIndex
CREATE INDEX "table_reservations_hold_expires_at_idx" ON "table_reservations"("hold_expires_at");

-- CreateIndex
CREATE INDEX "table_audit_logs_actor_user_id_idx" ON "table_audit_logs"("actor_user_id");

-- CreateIndex
CREATE INDEX "table_audit_logs_organizer_id_idx" ON "table_audit_logs"("organizer_id");

-- CreateIndex
CREATE INDEX "table_audit_logs_event_id_idx" ON "table_audit_logs"("event_id");

-- CreateIndex
CREATE INDEX "table_audit_logs_venue_table_id_idx" ON "table_audit_logs"("venue_table_id");

-- CreateIndex
CREATE INDEX "table_audit_logs_event_table_id_idx" ON "table_audit_logs"("event_table_id");

-- CreateIndex
CREATE INDEX "table_audit_logs_reservation_id_idx" ON "table_audit_logs"("reservation_id");

-- CreateIndex
CREATE INDEX "table_audit_logs_event_idx" ON "table_audit_logs"("event");

-- CreateIndex
CREATE INDEX "table_audit_logs_created_at_idx" ON "table_audit_logs"("created_at");

-- AddCheckConstraint
ALTER TABLE "venue_tables"
ADD CONSTRAINT "venue_tables_seat_count_check" CHECK ("seat_count" > 0);

-- AddCheckConstraint
ALTER TABLE "event_tables"
ADD CONSTRAINT "event_tables_price_minor_check" CHECK ("price_minor" >= 0);

-- AddForeignKey
ALTER TABLE "venue_floor_sections" ADD CONSTRAINT "venue_floor_sections_organizer_id_fkey" FOREIGN KEY ("organizer_id") REFERENCES "organizers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venue_tables" ADD CONSTRAINT "venue_tables_organizer_id_fkey" FOREIGN KEY ("organizer_id") REFERENCES "organizers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venue_tables" ADD CONSTRAINT "venue_tables_floor_section_id_fkey" FOREIGN KEY ("floor_section_id") REFERENCES "venue_floor_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_tables" ADD CONSTRAINT "event_tables_organizer_id_fkey" FOREIGN KEY ("organizer_id") REFERENCES "organizers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_tables" ADD CONSTRAINT "event_tables_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_tables" ADD CONSTRAINT "event_tables_venue_table_id_fkey" FOREIGN KEY ("venue_table_id") REFERENCES "venue_tables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_reservations" ADD CONSTRAINT "table_reservations_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_reservations" ADD CONSTRAINT "table_reservations_organizer_id_fkey" FOREIGN KEY ("organizer_id") REFERENCES "organizers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_reservations" ADD CONSTRAINT "table_reservations_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_reservations" ADD CONSTRAINT "table_reservations_event_table_id_fkey" FOREIGN KEY ("event_table_id") REFERENCES "event_tables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_audit_logs" ADD CONSTRAINT "table_audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;