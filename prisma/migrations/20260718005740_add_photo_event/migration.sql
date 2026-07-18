-- AlterTable: add the new FK columns as nullable first — group_photos/group_photo_legacy_references
-- will be tightened to NOT NULL further down, once every existing row has been backfilled to a
-- synthetic PhotoEvent. registrants.photoEventId stays nullable forever by design (see schema.prisma).
ALTER TABLE "group_photo_legacy_references" ADD COLUMN     "photoEventId" TEXT;

ALTER TABLE "group_photos" ADD COLUMN     "photoEventId" TEXT;

ALTER TABLE "registrants" ADD COLUMN     "photoEventId" TEXT;

-- CreateEnum
CREATE TYPE "PhotoEventStatus" AS ENUM ('ACTIVE', 'ARCHIVE_READY', 'ARCHIVED');

-- CreateTable
CREATE TABLE "photo_events" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "codeRangeMin" INTEGER,
    "codeRangeMax" INTEGER,
    "status" "PhotoEventStatus" NOT NULL DEFAULT 'ACTIVE',
    "archiveFileUrl" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "photo_events_pkey" PRIMARY KEY ("id")
);

-- Backfill: one synthetic PhotoEvent per university that has any existing group_photos or
-- group_photo_legacy_references rows, spanning that university's whole existing registrant date
-- range (so every registrant already tagged under it falls inside the bootstrap window too).
INSERT INTO "photo_events" ("id", "universityId", "code", "label", "startDate", "endDate", "status", "createdAt", "updatedAt")
SELECT
  'migrated-' || u.id,
  u.id,
  'MIGRATED',
  'ข้อมูลเดิมก่อนมีระบบรุ่น/งาน (สร้างอัตโนมัติตอน migrate)',
  COALESCE((SELECT MIN(r."registeredAt") FROM "registrants" r WHERE r."universityId" = u.id), TIMESTAMP '1970-01-01 00:00:00'),
  TIMESTAMP '2100-01-01 00:00:00',
  'ACTIVE',
  NOW(),
  NOW()
FROM "universities" u
WHERE EXISTS (SELECT 1 FROM "group_photos" gp WHERE gp."universityId" = u.id)
   OR EXISTS (SELECT 1 FROM "group_photo_legacy_references" glr WHERE glr."universityId" = u.id);

UPDATE "group_photos"
SET "photoEventId" = 'migrated-' || "universityId"
WHERE "photoEventId" IS NULL;

UPDATE "group_photo_legacy_references"
SET "photoEventId" = 'migrated-' || "universityId"
WHERE "photoEventId" IS NULL;

-- Retroactively stamp any registrant already linked to a (now-backfilled) tag, matching the new
-- sticky-assignment model exactly as if they had been matched under the real event system.
UPDATE "registrants" r
SET "photoEventId" = gp."photoEventId"
FROM "group_photo_tags" gpt
JOIN "group_photos" gp ON gp."id" = gpt."groupPhotoId"
WHERE gpt."registrantId" = r."id"
  AND r."photoEventId" IS NULL;

-- AlterTable: every row has a value now — tighten to NOT NULL.
ALTER TABLE "group_photos" ALTER COLUMN "photoEventId" SET NOT NULL;

ALTER TABLE "group_photo_legacy_references" ALTER COLUMN "photoEventId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "photo_events_universityId_code_key" ON "photo_events"("universityId", "code");

-- CreateIndex
CREATE INDEX "group_photo_legacy_references_photoEventId_normalizedCode_idx" ON "group_photo_legacy_references"("photoEventId", "normalizedCode");

-- CreateIndex
CREATE INDEX "group_photos_photoEventId_idx" ON "group_photos"("photoEventId");

-- CreateIndex
CREATE INDEX "registrants_photoEventId_idx" ON "registrants"("photoEventId");

-- AddForeignKey
ALTER TABLE "registrants" ADD CONSTRAINT "registrants_photoEventId_fkey" FOREIGN KEY ("photoEventId") REFERENCES "photo_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photo_events" ADD CONSTRAINT "photo_events_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "universities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_photos" ADD CONSTRAINT "group_photos_photoEventId_fkey" FOREIGN KEY ("photoEventId") REFERENCES "photo_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_photo_legacy_references" ADD CONSTRAINT "group_photo_legacy_references_photoEventId_fkey" FOREIGN KEY ("photoEventId") REFERENCES "photo_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
