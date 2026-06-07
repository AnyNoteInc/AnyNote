-- AlterTable
ALTER TABLE "user_preferences" ADD COLUMN "active_workspace_id" UUID;

-- CreateIndex
CREATE INDEX "user_preferences_active_workspace_id_idx" ON "user_preferences"("active_workspace_id");

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_active_workspace_id_fkey" FOREIGN KEY ("active_workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;
