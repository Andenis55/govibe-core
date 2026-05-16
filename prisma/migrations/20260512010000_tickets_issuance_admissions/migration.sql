-- AlterEnum
ALTER TYPE "ticket_status" ADD VALUE IF NOT EXISTS 'VOIDED';

-- AlterEnum
ALTER TYPE "ticket_status" ADD VALUE IF NOT EXISTS 'EXPIRED';

-- CreateEnum
CREATE TYPE "admission_scan_status" AS ENUM ('ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "admission_rejection_reason" AS ENUM (
    'INVALID_TOKEN',
    'TICKET_NOT_FOUND',
    'TICKET_NOT_ISSUED',
    'TICKET_VOIDED',
    'TICKET_EXPIRED',
    'TICKET_ALREADY_USED',
    'EVENT_NOT_ACTIVE',
    'EVENT_MISMATCH',
    'ORGANIZER_MISMATCH',
    'TOKEN_REPLAY_DETECTED',
    'STAFF_NOT_AUTHORIZED'
);

-- AlterTable
ALTER TABLE "tickets"
ADD COLUMN "ticket_number" TEXT,
ADD COLUMN "organizer_id" UUID,
ALTER COLUMN "ticket_type_id" DROP NOT NULL,
ADD COLUMN "payment_intent_id" UUID,
ADD COLUMN "admission_token_hash" TEXT,
ADD COLUMN "admission_token_version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "used_at" TIMESTAMP(3),
ADD COLUMN "voided_at" TIMESTAMP(3),
ADD COLUMN "expires_at" TIMESTAMP(3),
ADD COLUMN "created_at" TIMESTAMP(3),
ADD COLUMN "updated_at" TIMESTAMP(3);

UPDATE "tickets" AS t
SET "organizer_id" = e."organizer_id",
    "created_at" = COALESCE(t."issued_at", CURRENT_TIMESTAMP),
    "updated_at" = COALESCE(t."issued_at", CURRENT_TIMESTAMP)
FROM "events" AS e
WHERE e."id" = t."event_id";

UPDATE "tickets"
SET "created_at" = COALESCE("created_at", CURRENT_TIMESTAMP),
    "updated_at" = COALESCE("updated_at", CURRENT_TIMESTAMP)
WHERE "created_at" IS NULL
   OR "updated_at" IS NULL;

ALTER TABLE "tickets"
ALTER COLUMN "status" SET DEFAULT 'ISSUED',
ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "created_at" SET NOT NULL,
ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "updated_at" SET NOT NULL;

-- CreateTable
CREATE TABLE "ticket_issuance_audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payment_intent_id" UUID NOT NULL,
    "ticket_id" UUID,
    "buyer_user_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "organizer_id" UUID NOT NULL,
    "audit_event" TEXT NOT NULL,
    "reason" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_issuance_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admission_scan_audits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ticket_id" UUID,
    "event_id" UUID,
    "organizer_id" UUID,
    "scanned_by_user_id" UUID,
    "status" "admission_scan_status" NOT NULL,
    "rejection_reason" "admission_rejection_reason",
    "token_hash" TEXT,
    "scan_nonce_hash" TEXT,
    "device_id" TEXT,
    "gate_label" TEXT,
    "metadata" JSONB,
    "scanned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admission_scan_audits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_tickets_ticket_number" ON "tickets"("ticket_number");

-- CreateIndex
CREATE UNIQUE INDEX "uq_tickets_admission_token_hash" ON "tickets"("admission_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "uq_tickets_payment_owner_event" ON "tickets"("payment_intent_id", "owner_user_id", "event_id");

-- CreateIndex
CREATE INDEX "idx_tickets_organizer" ON "tickets"("organizer_id");

-- CreateIndex
CREATE INDEX "idx_tickets_payment_intent" ON "tickets"("payment_intent_id");

-- CreateIndex
CREATE INDEX "idx_tickets_status" ON "tickets"("status");

-- CreateIndex
CREATE INDEX "idx_tickets_issued_at" ON "tickets"("issued_at");

-- CreateIndex
CREATE INDEX "idx_ticket_issuance_audit_payment_intent" ON "ticket_issuance_audit_logs"("payment_intent_id");

-- CreateIndex
CREATE INDEX "idx_ticket_issuance_audit_ticket" ON "ticket_issuance_audit_logs"("ticket_id");

-- CreateIndex
CREATE INDEX "idx_ticket_issuance_audit_buyer" ON "ticket_issuance_audit_logs"("buyer_user_id");

-- CreateIndex
CREATE INDEX "idx_ticket_issuance_audit_event" ON "ticket_issuance_audit_logs"("event_id");

-- CreateIndex
CREATE INDEX "idx_ticket_issuance_audit_organizer" ON "ticket_issuance_audit_logs"("organizer_id");

-- CreateIndex
CREATE INDEX "idx_ticket_issuance_audit_event_type" ON "ticket_issuance_audit_logs"("audit_event");

-- CreateIndex
CREATE INDEX "idx_ticket_issuance_audit_created_at" ON "ticket_issuance_audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "idx_admission_scan_audit_ticket" ON "admission_scan_audits"("ticket_id");

-- CreateIndex
CREATE INDEX "idx_admission_scan_audit_event" ON "admission_scan_audits"("event_id");

-- CreateIndex
CREATE INDEX "idx_admission_scan_audit_organizer" ON "admission_scan_audits"("organizer_id");

-- CreateIndex
CREATE INDEX "idx_admission_scan_audit_scanned_by" ON "admission_scan_audits"("scanned_by_user_id");

-- CreateIndex
CREATE INDEX "idx_admission_scan_audit_status" ON "admission_scan_audits"("status");

-- CreateIndex
CREATE INDEX "idx_admission_scan_audit_rejection_reason" ON "admission_scan_audits"("rejection_reason");

-- CreateIndex
CREATE INDEX "idx_admission_scan_audit_token_hash" ON "admission_scan_audits"("token_hash");

-- CreateIndex
CREATE INDEX "idx_admission_scan_audit_scan_nonce_hash" ON "admission_scan_audits"("scan_nonce_hash");

-- CreateIndex
CREATE INDEX "idx_admission_scan_audit_scanned_at" ON "admission_scan_audits"("scanned_at");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_organizer_id_fkey" FOREIGN KEY ("organizer_id") REFERENCES "organizers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_payment_intent_id_fkey" FOREIGN KEY ("payment_intent_id") REFERENCES "payment_intents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_issuance_audit_logs" ADD CONSTRAINT "ticket_issuance_audit_logs_payment_intent_id_fkey" FOREIGN KEY ("payment_intent_id") REFERENCES "payment_intents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_issuance_audit_logs" ADD CONSTRAINT "ticket_issuance_audit_logs_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_issuance_audit_logs" ADD CONSTRAINT "ticket_issuance_audit_logs_buyer_user_id_fkey" FOREIGN KEY ("buyer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_issuance_audit_logs" ADD CONSTRAINT "ticket_issuance_audit_logs_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_issuance_audit_logs" ADD CONSTRAINT "ticket_issuance_audit_logs_organizer_id_fkey" FOREIGN KEY ("organizer_id") REFERENCES "organizers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_scan_audits" ADD CONSTRAINT "admission_scan_audits_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_scan_audits" ADD CONSTRAINT "admission_scan_audits_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_scan_audits" ADD CONSTRAINT "admission_scan_audits_organizer_id_fkey" FOREIGN KEY ("organizer_id") REFERENCES "organizers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_scan_audits" ADD CONSTRAINT "admission_scan_audits_scanned_by_user_id_fkey" FOREIGN KEY ("scanned_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;