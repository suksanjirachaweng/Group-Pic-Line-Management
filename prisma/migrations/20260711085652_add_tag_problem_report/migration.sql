-- AlterTable
ALTER TABLE "group_photo_tags" ADD COLUMN     "reportedAt" TIMESTAMP(3),
ADD COLUMN     "reportedProblem" BOOLEAN NOT NULL DEFAULT false;
