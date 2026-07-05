-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPERADMIN', 'UNIVERSITY_ADMIN');

-- CreateEnum
CREATE TYPE "FormFieldType" AS ENUM ('TEXT', 'NUMBER', 'SELECT', 'DATE', 'DATETIME', 'PHONE', 'EMAIL');

-- CreateEnum
CREATE TYPE "RegistrantStatus" AS ENUM ('PENDING', 'CONFIRMED', 'PROBLEM', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RuleTrigger" AS ENUM ('ON_REGISTRATION', 'SCHEDULED_TICK');

-- CreateEnum
CREATE TYPE "RuleExecutionStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED_QUOTA', 'SKIPPED_NOT_REACHABLE');

-- CreateEnum
CREATE TYPE "MessageJobSource" AS ENUM ('RULE', 'MANUAL');

-- CreateEnum
CREATE TYPE "MessageJobStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "SheetSyncStatus" AS ENUM ('SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "admin_users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'UNIVERSITY_ADMIN',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_user_universities" (
    "adminUserId" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_user_universities_pkey" PRIMARY KEY ("adminUserId","universityId")
);

-- CreateTable
CREATE TABLE "universities" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "universities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_field_definitions" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fieldType" "FormFieldType" NOT NULL DEFAULT 'TEXT',
    "options" JSONB,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "form_field_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channels" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lineChannelId" TEXT NOT NULL,
    "accessTokenEncrypted" TEXT NOT NULL,
    "channelSecretEncrypted" TEXT NOT NULL,
    "liffId" TEXT NOT NULL,
    "monthlyFreeQuota" INTEGER NOT NULL DEFAULT 200,
    "allowOverage" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "university_channel_pools" (
    "universityId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "university_channel_pools_pkey" PRIMARY KEY ("universityId","channelId")
);

-- CreateTable
CREATE TABLE "channel_usage_counters" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "yearMonth" TEXT NOT NULL,
    "messagesSent" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_usage_counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registrants" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "channelId" TEXT,
    "lineUserId" TEXT,
    "isFriend" BOOLEAN NOT NULL DEFAULT false,
    "displayName" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "status" "RegistrantStatus" NOT NULL DEFAULT 'PENDING',
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "registrants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rules" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "trigger" "RuleTrigger" NOT NULL DEFAULT 'ON_REGISTRATION',
    "conditionTree" JSONB NOT NULL,
    "messageTemplate" TEXT NOT NULL,
    "scheduleConfig" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rule_executions" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "registrantId" TEXT NOT NULL,
    "status" "RuleExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "errorDetail" TEXT,

    CONSTRAINT "rule_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_jobs" (
    "id" TEXT NOT NULL,
    "registrantId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "source" "MessageJobSource" NOT NULL DEFAULT 'MANUAL',
    "ruleExecutionId" TEXT,
    "body" TEXT NOT NULL,
    "status" "MessageJobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "message_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_logs" (
    "id" TEXT NOT NULL,
    "registrantId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "lineApiResponseStatus" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sheet_export_configs" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "googleSheetId" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncStatus" "SheetSyncStatus",
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sheet_export_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "universities_slug_key" ON "universities"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "form_field_definitions_universityId_key_key" ON "form_field_definitions"("universityId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "channels_lineChannelId_key" ON "channels"("lineChannelId");

-- CreateIndex
CREATE UNIQUE INDEX "channel_usage_counters_channelId_yearMonth_key" ON "channel_usage_counters"("channelId", "yearMonth");

-- CreateIndex
CREATE INDEX "registrants_universityId_status_idx" ON "registrants"("universityId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "registrants_universityId_lineUserId_key" ON "registrants"("universityId", "lineUserId");

-- CreateIndex
CREATE INDEX "rules_universityId_isActive_idx" ON "rules"("universityId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "rule_executions_ruleId_registrantId_key" ON "rule_executions"("ruleId", "registrantId");

-- CreateIndex
CREATE UNIQUE INDEX "message_jobs_ruleExecutionId_key" ON "message_jobs"("ruleExecutionId");

-- CreateIndex
CREATE INDEX "message_jobs_status_createdAt_idx" ON "message_jobs"("status", "createdAt");

-- CreateIndex
CREATE INDEX "message_logs_registrantId_idx" ON "message_logs"("registrantId");

-- CreateIndex
CREATE UNIQUE INDEX "sheet_export_configs_universityId_key" ON "sheet_export_configs"("universityId");

-- AddForeignKey
ALTER TABLE "admin_user_universities" ADD CONSTRAINT "admin_user_universities_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_user_universities" ADD CONSTRAINT "admin_user_universities_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "universities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_field_definitions" ADD CONSTRAINT "form_field_definitions_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "universities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "university_channel_pools" ADD CONSTRAINT "university_channel_pools_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "universities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "university_channel_pools" ADD CONSTRAINT "university_channel_pools_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_usage_counters" ADD CONSTRAINT "channel_usage_counters_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registrants" ADD CONSTRAINT "registrants_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "universities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registrants" ADD CONSTRAINT "registrants_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rules" ADD CONSTRAINT "rules_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "universities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_executions" ADD CONSTRAINT "rule_executions_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_executions" ADD CONSTRAINT "rule_executions_registrantId_fkey" FOREIGN KEY ("registrantId") REFERENCES "registrants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_jobs" ADD CONSTRAINT "message_jobs_registrantId_fkey" FOREIGN KEY ("registrantId") REFERENCES "registrants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_jobs" ADD CONSTRAINT "message_jobs_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_jobs" ADD CONSTRAINT "message_jobs_ruleExecutionId_fkey" FOREIGN KEY ("ruleExecutionId") REFERENCES "rule_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_logs" ADD CONSTRAINT "message_logs_registrantId_fkey" FOREIGN KEY ("registrantId") REFERENCES "registrants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_logs" ADD CONSTRAINT "message_logs_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sheet_export_configs" ADD CONSTRAINT "sheet_export_configs_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "universities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
