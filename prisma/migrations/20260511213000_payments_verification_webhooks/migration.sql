-- AlterEnum
ALTER TYPE "payment_intent_status" ADD VALUE IF NOT EXISTS 'VERIFIED';

-- AlterEnum
ALTER TYPE "payment_intent_status" ADD VALUE IF NOT EXISTS 'FAILED';

-- CreateEnum
CREATE TYPE "webhook_processing_status" AS ENUM (
    'RECEIVED',
    'VERIFIED',
    'REJECTED',
    'DUPLICATE',
    'PROCESSED',
    'FAILED'
);

-- AlterTable
ALTER TABLE "payment_intents"
ADD COLUMN "verified_at" TIMESTAMP(3),
ADD COLUMN "provider_verified_status" TEXT,
ADD COLUMN "provider_verified_amount" INTEGER,
ADD COLUMN "provider_verified_currency" TEXT,
ADD COLUMN "provider_verification_raw" JSONB;

-- CreateTable
CREATE TABLE "provider_webhook_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" "payment_provider" NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "provider_reference" TEXT,
    "payload_hash" TEXT NOT NULL,
    "signature_valid" BOOLEAN,
    "processing_status" "webhook_processing_status" NOT NULL DEFAULT 'RECEIVED',
    "failure_code" TEXT,
    "failure_message" TEXT,
    "raw_headers" JSONB NOT NULL,
    "raw_payload" TEXT NOT NULL,
    "verified_payload" JSONB,
    "payment_intent_id" UUID,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "provider_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_provider_webhook_events_provider_event"
ON "provider_webhook_events"("provider", "provider_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_provider_webhook_events_provider_payload_hash"
ON "provider_webhook_events"("provider", "payload_hash");

-- CreateIndex
CREATE INDEX "idx_provider_webhook_events_provider"
ON "provider_webhook_events"("provider");

-- CreateIndex
CREATE INDEX "idx_provider_webhook_events_reference"
ON "provider_webhook_events"("provider_reference");

-- CreateIndex
CREATE INDEX "idx_provider_webhook_events_payment_intent"
ON "provider_webhook_events"("payment_intent_id");

-- CreateIndex
CREATE INDEX "idx_provider_webhook_events_processing_status"
ON "provider_webhook_events"("processing_status");

-- CreateIndex
CREATE INDEX "idx_provider_webhook_events_received_at"
ON "provider_webhook_events"("received_at");

-- AddForeignKey
ALTER TABLE "provider_webhook_events"
ADD CONSTRAINT "provider_webhook_events_payment_intent_id_fkey"
FOREIGN KEY ("payment_intent_id") REFERENCES "payment_intents"("id")
ON DELETE SET NULL ON UPDATE CASCADE;