-- CreateEnum
CREATE TYPE "CronHeartbeatStatus" AS ENUM ('OK', 'ERROR');

-- CreateTable
CREATE TABLE "cron_heartbeats" (
    "id" TEXT NOT NULL,
    "jobKey" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3) NOT NULL,
    "lastStatus" "CronHeartbeatStatus" NOT NULL,
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cron_heartbeats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cron_heartbeats_jobKey_key" ON "cron_heartbeats"("jobKey");
