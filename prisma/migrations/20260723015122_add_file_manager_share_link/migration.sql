-- CreateTable
CREATE TABLE "file_manager_share_links" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "isFolder" BOOLEAN NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_manager_share_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "file_manager_share_links_token_key" ON "file_manager_share_links"("token");
