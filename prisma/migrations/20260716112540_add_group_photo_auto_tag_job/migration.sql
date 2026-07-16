-- CreateEnum
CREATE TYPE "GroupPhotoAutoTagStage" AS ENUM ('OCR', 'ACCEPTING', 'FIXING_ORDER', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "group_photo_auto_tag_jobs" (
    "id" TEXT NOT NULL,
    "groupPhotoId" TEXT NOT NULL,
    "stage" "GroupPhotoAutoTagStage" NOT NULL DEFAULT 'OCR',
    "tilesTotal" INTEGER NOT NULL,
    "tilesDone" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "group_photo_auto_tag_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_photo_auto_tag_hits" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "tileIndex" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "group_photo_auto_tag_hits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "group_photo_auto_tag_jobs_stage_idx" ON "group_photo_auto_tag_jobs"("stage");

-- CreateIndex
CREATE INDEX "group_photo_auto_tag_jobs_groupPhotoId_idx" ON "group_photo_auto_tag_jobs"("groupPhotoId");

-- CreateIndex
CREATE INDEX "group_photo_auto_tag_hits_jobId_idx" ON "group_photo_auto_tag_hits"("jobId");

-- AddForeignKey
ALTER TABLE "group_photo_auto_tag_jobs" ADD CONSTRAINT "group_photo_auto_tag_jobs_groupPhotoId_fkey" FOREIGN KEY ("groupPhotoId") REFERENCES "group_photos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_photo_auto_tag_hits" ADD CONSTRAINT "group_photo_auto_tag_hits_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "group_photo_auto_tag_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
