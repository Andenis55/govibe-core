-- CreateEnum
CREATE TYPE "organizer_status" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'SUSPENDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "event_status" AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "event_visibility" AS ENUM ('PRIVATE', 'UNLISTED', 'PUBLIC');

-- CreateEnum
CREATE TYPE "event_category" AS ENUM ('NIGHTLIFE', 'CONCERT', 'FESTIVAL', 'CAMPUS', 'CORPORATE', 'COMMUNITY', 'SPORTS', 'ARTS', 'OTHER');

-- CreateTable
CREATE TABLE "organizers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_user_id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "status" "organizer_status" NOT NULL DEFAULT 'DRAFT',
    "contact_email" TEXT,
    "contact_phone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizers_pkey" PRIMARY KEY ("id")
);

-- Seed existing organizer identities so event organizer_id values remain valid.
INSERT INTO "organizers" (
  "id",
  "owner_user_id",
  "display_name",
  "slug",
  "status",
  "created_at",
  "updated_at"
)
SELECT DISTINCT
  e."organizer_id",
  e."organizer_id",
  COALESCE(u."email", CONCAT('Legacy Organizer ', SUBSTRING(e."organizer_id"::text, 1, 8))),
  CONCAT('legacy-organizer-', REPLACE(e."organizer_id"::text, '-', '')),
  'APPROVED'::"organizer_status",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "events" e
INNER JOIN "users" u
  ON u."id" = e."organizer_id"
ON CONFLICT ("id") DO NOTHING;

-- AlterTable
ALTER TABLE "events"
ADD COLUMN     "address_line_1" TEXT,
ADD COLUMN     "address_line_2" TEXT,
ADD COLUMN     "archived_at" TIMESTAMP(3),
ADD COLUMN     "cancelled_at" TIMESTAMP(3),
ADD COLUMN     "capacity_held" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "category" "event_category" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "city" TEXT,
ADD COLUMN     "country" TEXT NOT NULL DEFAULT 'Ghana',
ADD COLUMN     "description" TEXT,
ADD COLUMN     "latitude" DECIMAL(10,7),
ADD COLUMN     "longitude" DECIMAL(10,7),
ADD COLUMN     "published_at" TIMESTAMP(3),
ADD COLUMN     "region" TEXT,
ADD COLUMN     "slug" TEXT,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Africa/Accra',
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "venue_name" TEXT,
ADD COLUMN     "visibility" "event_visibility" NOT NULL DEFAULT 'PRIVATE',
ADD COLUMN     "status_new" "event_status" NOT NULL DEFAULT 'DRAFT',
ALTER COLUMN "id" SET DEFAULT gen_random_uuid(),
ALTER COLUMN "capacity_total" DROP NOT NULL;

UPDATE "events"
SET "slug" = CONCAT('legacy-event-', REPLACE("id"::text, '-', ''))
WHERE "slug" IS NULL;

UPDATE "events"
SET "status_new" = CASE
  WHEN "status" = 'PUBLISHED' THEN 'PUBLISHED'::"event_status"
  WHEN "status" = 'CANCELLED' THEN 'CANCELLED'::"event_status"
  WHEN "status" = 'ARCHIVED' THEN 'ARCHIVED'::"event_status"
  ELSE 'DRAFT'::"event_status"
END;

ALTER TABLE "events"
ALTER COLUMN "slug" SET NOT NULL;

ALTER TABLE "events" DROP COLUMN "status";

ALTER TABLE "events" RENAME COLUMN "status_new" TO "status";

-- AlterTable
ALTER TABLE "venues" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- DropForeignKey
ALTER TABLE "events" DROP CONSTRAINT "events_organizer_id_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "organizers_slug_key" ON "organizers"("slug");

-- CreateIndex
CREATE INDEX "idx_organizers_owner_user_id" ON "organizers"("owner_user_id");

-- CreateIndex
CREATE INDEX "idx_organizers_status" ON "organizers"("status");

-- CreateIndex
CREATE INDEX "idx_organizers_slug" ON "organizers"("slug");

-- CreateIndex
CREATE INDEX "idx_events_status" ON "events"("status");

-- CreateIndex
CREATE INDEX "idx_events_visibility" ON "events"("visibility");

-- CreateIndex
CREATE INDEX "idx_events_category" ON "events"("category");

-- CreateIndex
CREATE INDEX "idx_events_starts_at" ON "events"("starts_at");

-- CreateIndex
CREATE INDEX "idx_events_city" ON "events"("city");

-- CreateIndex
CREATE INDEX "idx_events_country" ON "events"("country");

-- CreateIndex
CREATE UNIQUE INDEX "uq_events_organizer_slug" ON "events"("organizer_id", "slug");

-- AddForeignKey
ALTER TABLE "organizers" ADD CONSTRAINT "organizers_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_organizer_id_fkey" FOREIGN KEY ("organizer_id") REFERENCES "organizers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
