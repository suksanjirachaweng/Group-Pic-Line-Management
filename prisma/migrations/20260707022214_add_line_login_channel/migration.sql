/*
  Warnings:

  - You are about to drop the column `accessTokenKeyId` on the `channels` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "channels" DROP COLUMN "accessTokenKeyId";

-- CreateTable
CREATE TABLE "line_login_channel" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "channelId" TEXT NOT NULL,
    "channelSecretEncrypted" TEXT NOT NULL,
    "accessTokenEncrypted" TEXT NOT NULL DEFAULT '',
    "accessTokenExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "line_login_channel_pkey" PRIMARY KEY ("id")
);
