-- CreateEnum
CREATE TYPE "McpTransport" AS ENUM ('HTTP_JSONRPC', 'SSE');

-- CreateEnum
CREATE TYPE "AgentMemoryScope" AS ENUM ('WORKSPACE', 'USER');

-- CreateEnum
CREATE TYPE "AgentMemorySource" AS ENUM ('USER', 'AGENT');

-- CreateEnum
CREATE TYPE "AgentActionStatus" AS ENUM ('OK', 'ERROR', 'DENIED');

-- AlterTable
ALTER TABLE "workspace_ai_settings" ADD COLUMN     "agent_system_prompt" TEXT,
ADD COLUMN     "allow_destructive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "chat_model_connection" JSONB,
ADD COLUMN     "embedding_model_connection" JSONB;

-- CreateTable
CREATE TABLE "workspace_mcp_servers" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "url" TEXT NOT NULL,
    "transport" "McpTransport" NOT NULL DEFAULT 'HTTP_JSONRPC',
    "headers" JSONB NOT NULL DEFAULT '{}',
    "tools_allowlist" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "verify_tls" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by_id" UUID NOT NULL,

    CONSTRAINT "workspace_mcp_servers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_agent_memories" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "scope" "AgentMemoryScope" NOT NULL,
    "user_id" UUID,
    "key" VARCHAR(255) NOT NULL,
    "content" TEXT NOT NULL,
    "source" "AgentMemorySource" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "workspace_agent_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_action_logs" (
    "id" UUID NOT NULL,
    "chat_id" UUID,
    "message_id" UUID,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "tool_name" VARCHAR(255) NOT NULL,
    "tool_input" JSONB NOT NULL,
    "tool_output" JSONB,
    "status" "AgentActionStatus" NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_action_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workspace_mcp_servers_workspace_id_enabled_idx" ON "workspace_mcp_servers"("workspace_id", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_mcp_servers_workspace_id_name_key" ON "workspace_mcp_servers"("workspace_id", "name");

-- CreateIndex
CREATE INDEX "workspace_agent_memories_workspace_id_scope_idx" ON "workspace_agent_memories"("workspace_id", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_agent_memories_workspace_id_scope_user_id_key_key" ON "workspace_agent_memories"("workspace_id", "scope", "user_id", "key");

-- CreateIndex
CREATE INDEX "agent_action_logs_workspace_id_created_at_idx" ON "agent_action_logs"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_action_logs_chat_id_created_at_idx" ON "agent_action_logs"("chat_id", "created_at");

-- AddForeignKey
ALTER TABLE "workspace_mcp_servers" ADD CONSTRAINT "workspace_mcp_servers_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_mcp_servers" ADD CONSTRAINT "workspace_mcp_servers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_agent_memories" ADD CONSTRAINT "workspace_agent_memories_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_agent_memories" ADD CONSTRAINT "workspace_agent_memories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_action_logs" ADD CONSTRAINT "agent_action_logs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_action_logs" ADD CONSTRAINT "agent_action_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
