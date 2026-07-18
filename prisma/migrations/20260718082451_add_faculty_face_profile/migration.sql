-- AlterEnum
ALTER TYPE "PhotoEventArchiveStage" ADD VALUE 'EMBEDDING_FACES';

-- AlterTable
ALTER TABLE "photo_event_archive_jobs" ADD COLUMN     "facesDone" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "facesTotal" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "faculty_face_profiles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "embedding" DOUBLE PRECISION[],
    "sourceCropUrl" TEXT NOT NULL,
    "lastSeenPhotoEventId" TEXT,
    "timesMatched" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "faculty_face_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "faculty_face_profiles_name_key" ON "faculty_face_profiles"("name");
