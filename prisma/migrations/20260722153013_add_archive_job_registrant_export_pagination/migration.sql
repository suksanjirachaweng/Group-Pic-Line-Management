-- AlterTable
ALTER TABLE "photo_event_archive_jobs" ADD COLUMN     "exportedRegistrantsJson" JSONB,
ADD COLUMN     "lastExportedRegistrantId" TEXT,
ADD COLUMN     "registrantsDone" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "registrantsTotal" INTEGER NOT NULL DEFAULT 0;
