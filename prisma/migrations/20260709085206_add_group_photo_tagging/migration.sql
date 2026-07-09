-- CreateEnum
CREATE TYPE "TagMatchSource" AS ENUM ('REGISTRANT', 'LEGACY_REFERENCE', 'MANUAL');

-- CreateTable
CREATE TABLE "group_photos" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "imageWidth" INTEGER NOT NULL,
    "imageHeight" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_photo_tags" (
    "id" TEXT NOT NULL,
    "groupPhotoId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "normalizedCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "row" INTEGER NOT NULL,
    "order" INTEGER NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "registrantId" TEXT,
    "matchSource" "TagMatchSource" NOT NULL DEFAULT 'MANUAL',
    "editedViaPublicLink" BOOLEAN NOT NULL DEFAULT false,
    "publicLinkEditedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_photo_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_photo_legacy_references" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "normalizedCode" TEXT NOT NULL,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_photo_legacy_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_photo_share_links" (
    "id" TEXT NOT NULL,
    "groupPhotoId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_photo_share_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "group_photos_universityId_idx" ON "group_photos"("universityId");

-- CreateIndex
CREATE INDEX "group_photo_tags_groupPhotoId_normalizedCode_idx" ON "group_photo_tags"("groupPhotoId", "normalizedCode");

-- CreateIndex
CREATE INDEX "group_photo_tags_groupPhotoId_row_order_idx" ON "group_photo_tags"("groupPhotoId", "row", "order");

-- CreateIndex
CREATE INDEX "group_photo_legacy_references_universityId_normalizedCode_idx" ON "group_photo_legacy_references"("universityId", "normalizedCode");

-- CreateIndex
CREATE UNIQUE INDEX "group_photo_share_links_token_key" ON "group_photo_share_links"("token");

-- AddForeignKey
ALTER TABLE "group_photos" ADD CONSTRAINT "group_photos_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "universities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_photo_tags" ADD CONSTRAINT "group_photo_tags_groupPhotoId_fkey" FOREIGN KEY ("groupPhotoId") REFERENCES "group_photos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_photo_tags" ADD CONSTRAINT "group_photo_tags_registrantId_fkey" FOREIGN KEY ("registrantId") REFERENCES "registrants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_photo_legacy_references" ADD CONSTRAINT "group_photo_legacy_references_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "universities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_photo_share_links" ADD CONSTRAINT "group_photo_share_links_groupPhotoId_fkey" FOREIGN KEY ("groupPhotoId") REFERENCES "group_photos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
