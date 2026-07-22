-- CreateTable
CREATE TABLE "group_photo_image_history" (
    "id" TEXT NOT NULL,
    "groupPhotoId" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "imageWidth" INTEGER NOT NULL,
    "imageHeight" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_photo_image_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "group_photo_image_history_groupPhotoId_createdAt_idx" ON "group_photo_image_history"("groupPhotoId", "createdAt");

-- AddForeignKey
ALTER TABLE "group_photo_image_history" ADD CONSTRAINT "group_photo_image_history_groupPhotoId_fkey" FOREIGN KEY ("groupPhotoId") REFERENCES "group_photos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
