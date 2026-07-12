-- AlterTable
ALTER TABLE "group_photo_tags" ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "confirmedViaPublicLink" BOOLEAN NOT NULL DEFAULT false;
