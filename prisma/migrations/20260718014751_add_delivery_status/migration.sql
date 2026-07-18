-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('REGISTERED', 'PHOTO_ORDERED', 'PHOTO_RECEIVED', 'NO_SHOW', 'OTHER');

-- AlterTable
ALTER TABLE "registrants" ADD COLUMN     "deliveryStatus" "DeliveryStatus" NOT NULL DEFAULT 'REGISTERED';
