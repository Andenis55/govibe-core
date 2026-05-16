-- AlterTable: add previous_refresh_token_hash for single-depth replay detection
ALTER TABLE "sessions"
  ADD COLUMN "previous_refresh_token_hash" TEXT;

-- CreateIndex
CREATE INDEX "idx_sessions_previous_refresh_token_hash" ON "sessions"("previous_refresh_token_hash");
