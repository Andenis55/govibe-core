CREATE EXTENSION IF NOT EXISTS "pgcrypto";

ALTER TABLE "ticket_reservations"
ADD COLUMN "owner_user_id" UUID;

WITH attributed_reservations AS (
  SELECT
    "reservation_id",
    MIN("user_id"::text)::uuid AS "owner_user_id"
  FROM "orders"
  WHERE "reservation_id" IS NOT NULL
  GROUP BY "reservation_id"
  HAVING COUNT(DISTINCT "user_id") = 1
)
UPDATE "ticket_reservations" AS tr
SET "owner_user_id" = attributed_reservations."owner_user_id"
FROM attributed_reservations
WHERE attributed_reservations."reservation_id" = tr."id";

DELETE FROM "ticket_reservations"
WHERE "owner_user_id" IS NULL;

ALTER TABLE "ticket_reservations"
ALTER COLUMN "owner_user_id" SET NOT NULL;

CREATE INDEX "idx_reservation_owner_user_id"
ON "ticket_reservations"("owner_user_id");

ALTER TABLE "ticket_reservations"
ADD CONSTRAINT "ticket_reservations_owner_user_id_fkey"
FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "idempotency_keys"
ADD COLUMN "actor_user_id" UUID,
ADD COLUMN "use_case" TEXT,
ADD COLUMN "idempotency_key_hash" TEXT;

UPDATE "idempotency_keys"
SET
  "actor_user_id" = "actor_id",
  "use_case" = CASE
    WHEN "endpoint" = 'POST:/checkout/order' THEN 'checkout.create_order'
    WHEN "endpoint" = 'POST:/payments/initiate' THEN 'payments.initiate'
    ELSE "endpoint"
  END,
  "idempotency_key_hash" = encode(digest("idempotency_key", 'sha256'), 'hex')
WHERE "actor_id" IS NOT NULL;

DELETE FROM "idempotency_keys"
WHERE "actor_user_id" IS NULL
   OR "use_case" IS NULL
   OR "idempotency_key_hash" IS NULL;

ALTER TABLE "idempotency_keys"
DROP CONSTRAINT "idempotency_keys_actor_id_fkey";

ALTER TABLE "idempotency_keys"
DROP CONSTRAINT "idempotency_keys_pkey";

ALTER TABLE "idempotency_keys"
DROP COLUMN "actor_id",
DROP COLUMN "endpoint",
DROP COLUMN "idempotency_key";

ALTER TABLE "idempotency_keys"
ALTER COLUMN "actor_user_id" SET NOT NULL,
ALTER COLUMN "use_case" SET NOT NULL,
ALTER COLUMN "idempotency_key_hash" SET NOT NULL;

ALTER TABLE "idempotency_keys"
ADD CONSTRAINT "idempotency_keys_pkey"
PRIMARY KEY ("actor_user_id", "use_case", "idempotency_key_hash");

CREATE INDEX "idx_idempotency_actor_user_id"
ON "idempotency_keys"("actor_user_id");

CREATE INDEX "idx_idempotency_use_case"
ON "idempotency_keys"("use_case");

CREATE INDEX "idx_idempotency_key_hash"
ON "idempotency_keys"("idempotency_key_hash");

ALTER TABLE "idempotency_keys"
ADD CONSTRAINT "idempotency_keys_actor_user_id_fkey"
FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
