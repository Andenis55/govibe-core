-- CreateEnum
CREATE TYPE "admin_action_status" AS ENUM ('SUCCEEDED', 'REJECTED', 'FAILED');

-- CreateTable
CREATE TABLE "admin_support_audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_user_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "status" "admin_action_status" NOT NULL,
    "target_type" TEXT,
    "target_id" UUID,
    "reason_code" TEXT NOT NULL,
    "reason_note" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_support_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_admin_support_audit_logs_actor_user_id" ON "admin_support_audit_logs"("actor_user_id");

-- CreateIndex
CREATE INDEX "idx_admin_support_audit_logs_action" ON "admin_support_audit_logs"("action");

-- CreateIndex
CREATE INDEX "idx_admin_support_audit_logs_status" ON "admin_support_audit_logs"("status");

-- CreateIndex
CREATE INDEX "idx_admin_support_audit_logs_target_type" ON "admin_support_audit_logs"("target_type");

-- CreateIndex
CREATE INDEX "idx_admin_support_audit_logs_target_id" ON "admin_support_audit_logs"("target_id");

-- CreateIndex
CREATE INDEX "idx_admin_support_audit_logs_reason_code" ON "admin_support_audit_logs"("reason_code");

-- CreateIndex
CREATE INDEX "idx_admin_support_audit_logs_created_at" ON "admin_support_audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "admin_support_audit_logs" ADD CONSTRAINT "admin_support_audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
