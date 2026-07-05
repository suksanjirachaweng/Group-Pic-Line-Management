-- DropIndex
DROP INDEX "registrants_universityId_lineUserId_key";

-- CreateIndex
CREATE INDEX "registrants_universityId_lineUserId_idx" ON "registrants"("universityId", "lineUserId");
