-- CreateEnum
CREATE TYPE "GroupPhotoStatus" AS ENUM ('NOT_STARTED', 'NEEDS_EDIT', 'DONE');

-- CreateEnum
CREATE TYPE "TagHistorySource" AS ENUM ('ADMIN', 'AUTO_SYNC', 'PUBLIC_LINK');

-- AlterTable
ALTER TABLE "group_photos" ADD COLUMN     "status" "GroupPhotoStatus" NOT NULL DEFAULT 'NOT_STARTED';

-- CreateTable
CREATE TABLE "group_photo_tag_history" (
    "id" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "row" INTEGER NOT NULL,
    "order" INTEGER NOT NULL,
    "source" "TagHistorySource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_photo_tag_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "group_photo_tag_history_tagId_createdAt_idx" ON "group_photo_tag_history"("tagId", "createdAt");

-- AddForeignKey
ALTER TABLE "group_photo_tag_history" ADD CONSTRAINT "group_photo_tag_history_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "group_photo_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
