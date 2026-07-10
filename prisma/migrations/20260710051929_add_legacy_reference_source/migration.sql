-- CreateEnum
CREATE TYPE "LegacyReferenceSource" AS ENUM ('EXCEL_FILE', 'GOOGLE_SHEET');

-- AlterTable
ALTER TABLE "group_photo_legacy_references" ADD COLUMN     "source" "LegacyReferenceSource" NOT NULL DEFAULT 'EXCEL_FILE';
