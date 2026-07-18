-- CreateEnum
CREATE TYPE "PhotoEventArchiveStage" AS ENUM ('EXPORTING_DATA', 'COPYING_IMAGES', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "photo_event_archive_jobs" (
    "id" TEXT NOT NULL,
    "photoEventId" TEXT NOT NULL,
    "stage" "PhotoEventArchiveStage" NOT NULL DEFAULT 'EXPORTING_DATA',
    "imagesTotal" INTEGER NOT NULL DEFAULT 0,
    "imagesDone" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "photo_event_archive_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "photo_event_archive_jobs_stage_idx" ON "photo_event_archive_jobs"("stage");

-- CreateIndex
CREATE INDEX "photo_event_archive_jobs_photoEventId_idx" ON "photo_event_archive_jobs"("photoEventId");

-- AddForeignKey
ALTER TABLE "photo_event_archive_jobs" ADD CONSTRAINT "photo_event_archive_jobs_photoEventId_fkey" FOREIGN KEY ("photoEventId") REFERENCES "photo_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
