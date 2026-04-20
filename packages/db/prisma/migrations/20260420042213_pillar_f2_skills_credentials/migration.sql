-- AlterTable
ALTER TABLE "workspace_ai_settings" ADD COLUMN     "skill_page_ids" UUID[] DEFAULT ARRAY[]::UUID[];
