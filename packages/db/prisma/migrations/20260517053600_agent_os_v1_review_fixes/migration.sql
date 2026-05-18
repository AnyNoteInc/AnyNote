-- DropForeignKey
ALTER TABLE "agent_action_logs" DROP CONSTRAINT "agent_action_logs_user_id_fkey";

-- DropForeignKey
ALTER TABLE "workspace_mcp_servers" DROP CONSTRAINT "workspace_mcp_servers_created_by_id_fkey";

-- AlterTable
ALTER TABLE "agent_action_logs" ALTER COLUMN "user_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "workspace_mcp_servers" ALTER COLUMN "created_by_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "workspace_agent_memories_workspace_id_scope_user_id_idx" ON "workspace_agent_memories"("workspace_id", "scope", "user_id");

-- AddForeignKey
ALTER TABLE "workspace_mcp_servers" ADD CONSTRAINT "workspace_mcp_servers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_action_logs" ADD CONSTRAINT "agent_action_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
