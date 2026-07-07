-- AlterTable
ALTER TABLE "channels" ADD COLUMN     "accessTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN     "accessTokenKeyId" TEXT;
