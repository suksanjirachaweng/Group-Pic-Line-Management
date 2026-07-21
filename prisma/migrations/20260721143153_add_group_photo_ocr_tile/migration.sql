-- CreateTable
CREATE TABLE "group_photo_ocr_tiles" (
    "id" TEXT NOT NULL,
    "groupPhotoId" TEXT NOT NULL,
    "tileIndex" INTEGER NOT NULL,
    "left" INTEGER NOT NULL,
    "top" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "uploadWidth" INTEGER NOT NULL,
    "uploadHeight" INTEGER NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "hits" JSONB NOT NULL,
    "failed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_photo_ocr_tiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "group_photo_ocr_tiles_groupPhotoId_idx" ON "group_photo_ocr_tiles"("groupPhotoId");

-- AddForeignKey
ALTER TABLE "group_photo_ocr_tiles" ADD CONSTRAINT "group_photo_ocr_tiles_groupPhotoId_fkey" FOREIGN KEY ("groupPhotoId") REFERENCES "group_photos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
