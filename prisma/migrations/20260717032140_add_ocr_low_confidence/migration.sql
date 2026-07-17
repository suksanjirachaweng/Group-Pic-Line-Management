-- AlterTable
ALTER TABLE "group_photo_auto_tag_hits" ADD COLUMN     "confident" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "group_photo_tags" ADD COLUMN     "ocrLowConfidence" BOOLEAN NOT NULL DEFAULT false;
