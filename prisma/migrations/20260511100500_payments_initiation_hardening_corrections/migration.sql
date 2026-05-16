-- CreateEnum
CREATE TYPE "payment_provider" AS ENUM ('PAYSTACK', 'MTN_MOMO');

-- CreateEnum
CREATE TYPE "payment_intent_status" AS ENUM ('INITIATION_PENDING', 'INITIATED', 'INITIATION_FAILED');

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "payment_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "price_currency" TEXT NOT NULL DEFAULT 'GHS',
ADD COLUMN     "price_minor" INTEGER;

-- CreateTable
CREATE TABLE "payment_intents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "buyer_user_id" UUID NOT NULL,
    "organizer_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "provider" "payment_provider" NOT NULL,
    "status" "payment_intent_status" NOT NULL DEFAULT 'INITIATION_PENDING',
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "idempotency_use_case" TEXT NOT NULL DEFAULT 'payments.initiate',
    "idempotency_key_hash" TEXT NOT NULL,
    "request_fingerprint_hash" TEXT NOT NULL,
    "provider_reference" TEXT NOT NULL,
    "provider_checkout_url" TEXT,
    "provider_access_code" TEXT,
    "provider_raw_response" JSONB,
    "failure_code" TEXT,
    "failure_message" TEXT,
    "initiated_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_intent_audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payment_intent_id" UUID NOT NULL,
    "buyer_user_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_intent_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_payment_intents_provider_reference" ON "payment_intents"("provider_reference");

-- CreateIndex
CREATE INDEX "idx_payment_intents_buyer_created" ON "payment_intents"("buyer_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_payment_intents_organizer_created" ON "payment_intents"("organizer_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_payment_intents_event_created" ON "payment_intents"("event_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_payment_intents_status_created" ON "payment_intents"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_payment_intents_provider_created" ON "payment_intents"("provider", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_payment_intents_buyer_use_case_key" ON "payment_intents"("buyer_user_id", "idempotency_use_case", "idempotency_key_hash");

-- CreateIndex
CREATE INDEX "idx_payment_intent_audits_intent_created" ON "payment_intent_audit_logs"("payment_intent_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_payment_intent_audits_buyer_created" ON "payment_intent_audit_logs"("buyer_user_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_buyer_user_id_fkey" FOREIGN KEY ("buyer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_organizer_id_fkey" FOREIGN KEY ("organizer_id") REFERENCES "organizers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_intent_audit_logs" ADD CONSTRAINT "payment_intent_audit_logs_payment_intent_id_fkey" FOREIGN KEY ("payment_intent_id") REFERENCES "payment_intents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_intent_audit_logs" ADD CONSTRAINT "payment_intent_audit_logs_buyer_user_id_fkey" FOREIGN KEY ("buyer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;