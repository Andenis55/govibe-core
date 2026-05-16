-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('CUSTOMER', 'ORGANIZER', 'GATE_STAFF', 'ADMIN');

-- CreateEnum
CREATE TYPE "session_status" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "auth_audit_action" AS ENUM (
  'SIGNUP',
  'LOGIN',
  'LOGIN_SUCCESS',
  'LOGIN_FAILED',
  'LOGOUT',
  'REFRESH',
  'REFRESH_SUCCESS',
  'REFRESH_FAILED',
  'REFRESH_REPLAY_DETECTED',
  'SESSION_REVOKED',
  'ME_ACCESSED',
  'AUTH_FAILURE',
  'EXPIRED_SESSION_DETECTED',
  'PASSWORD_RESET_REQUESTED',
  'PASSWORD_RESET_COMPLETED',
  'EMAIL_VERIFICATION_REQUESTED',
  'EMAIL_VERIFIED'
);

-- AlterTable
ALTER TABLE "users"
  ALTER COLUMN "id" SET DEFAULT gen_random_uuid(),
  ADD COLUMN "password_hash" TEXT,
  ADD COLUMN "role" "user_role" NOT NULL DEFAULT 'CUSTOMER',
  ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "email_verified_at" TIMESTAMP(3),
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- UpdateData
UPDATE "users"
SET "password_hash" = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy'
WHERE "password_hash" IS NULL;

-- AlterTable
ALTER TABLE "users"
  ALTER COLUMN "password_hash" SET NOT NULL;

-- CreateTable
CREATE TABLE "sessions" (
  "id" TEXT NOT NULL,
  "user_id" UUID NOT NULL,
  "refresh_token_hash" TEXT,
  "status" "session_status" NOT NULL DEFAULT 'ACTIVE',
  "device_id" TEXT NOT NULL,
  "user_agent" TEXT,
  "ip_address" TEXT,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "revoked_reason" TEXT,
  "refresh_token_version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_audit_logs" (
  "id" TEXT NOT NULL,
  "user_id" UUID,
  "action" "auth_audit_action" NOT NULL,
  "email" TEXT,
  "session_id" TEXT,
  "ip_address" TEXT,
  "user_agent" TEXT,
  "success" BOOLEAN NOT NULL,
  "reason" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "auth_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_users_role" ON "users"("role");

-- CreateIndex
CREATE INDEX "idx_users_email_verified_at" ON "users"("email_verified_at");

-- CreateIndex
CREATE INDEX "idx_sessions_user_status" ON "sessions"("user_id", "status");

-- CreateIndex
CREATE INDEX "idx_sessions_user_id" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "idx_sessions_user_revoked_at" ON "sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "idx_sessions_expires_at" ON "sessions"("expires_at");

-- CreateIndex
CREATE INDEX "idx_sessions_device_id" ON "sessions"("device_id");

-- CreateIndex
CREATE INDEX "idx_sessions_refresh_token_hash" ON "sessions"("refresh_token_hash");


-- CreateIndex
CREATE INDEX "idx_auth_audit_logs_user_action" ON "auth_audit_logs"("user_id", "action");

-- CreateIndex
CREATE INDEX "idx_auth_audit_logs_email" ON "auth_audit_logs"("email");

-- CreateIndex
CREATE INDEX "idx_auth_audit_logs_created_at" ON "auth_audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_audit_logs"
  ADD CONSTRAINT "auth_audit_logs_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;