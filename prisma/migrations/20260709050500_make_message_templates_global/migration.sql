-- DropForeignKey
ALTER TABLE "message_templates" DROP CONSTRAINT "message_templates_universityId_fkey";

-- DropIndex
DROP INDEX "message_templates_universityId_name_key";

-- AlterTable
ALTER TABLE "message_templates" DROP COLUMN "universityId";

-- CreateIndex
CREATE UNIQUE INDEX "message_templates_name_key" ON "message_templates"("name");
