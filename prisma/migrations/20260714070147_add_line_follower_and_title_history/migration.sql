-- CreateTable
CREATE TABLE "line_followers" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "lineUserId" TEXT NOT NULL,
    "displayName" TEXT,
    "pictureUrl" TEXT,
    "followedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unfollowedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "line_followers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_photo_title_history" (
    "id" TEXT NOT NULL,
    "groupPhotoId" TEXT NOT NULL,
    "title" TEXT,
    "source" "TagHistorySource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_photo_title_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "line_followers_channelId_idx" ON "line_followers"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "line_followers_channelId_lineUserId_key" ON "line_followers"("channelId", "lineUserId");

-- CreateIndex
CREATE INDEX "group_photo_title_history_groupPhotoId_createdAt_idx" ON "group_photo_title_history"("groupPhotoId", "createdAt");

-- AddForeignKey
ALTER TABLE "line_followers" ADD CONSTRAINT "line_followers_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_photo_title_history" ADD CONSTRAINT "group_photo_title_history_groupPhotoId_fkey" FOREIGN KEY ("groupPhotoId") REFERENCES "group_photos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
