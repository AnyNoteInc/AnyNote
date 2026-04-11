-- CreateEnum
CREATE TYPE "BlockType" AS ENUM ('PARAGRAPH', 'HEADING_1', 'HEADING_2', 'HEADING_3', 'TO_DO', 'BULLETED_LIST_ITEM', 'NUMBERED_LIST_ITEM', 'TOGGLE', 'QUOTE', 'CALLOUT', 'DIVIDER', 'CODE', 'IMAGE', 'VIDEO', 'FILE', 'PDF', 'BOOKMARK', 'EQUATION', 'TABLE', 'COLUMN', 'SYNCED_BLOCK', 'LINK_TO_PAGE');

-- CreateEnum
CREATE TYPE "SearchMessageRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateTable
CREATE TABLE "blocks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" "BlockType" NOT NULL,
    "page_id" UUID NOT NULL,
    "parent_block_id" UUID,
    "prev_block_id" UUID,
    "content" JSONB NOT NULL DEFAULT '{}',
    "created_by_id" UUID NOT NULL,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_chats" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Новый поиск',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "search_chats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "chat_id" UUID NOT NULL,
    "role" "SearchMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "sources" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "blocks_prev_block_id_key" ON "blocks"("prev_block_id");

-- CreateIndex
CREATE INDEX "blocks_page_id_parent_block_id_idx" ON "blocks"("page_id", "parent_block_id");

-- CreateIndex
CREATE INDEX "search_chats_workspace_id_updated_at_idx" ON "search_chats"("workspace_id", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "search_messages_chat_id_created_at_idx" ON "search_messages"("chat_id", "created_at");

-- AddForeignKey
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_parent_block_id_fkey" FOREIGN KEY ("parent_block_id") REFERENCES "blocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_prev_block_id_fkey" FOREIGN KEY ("prev_block_id") REFERENCES "blocks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_chats" ADD CONSTRAINT "search_chats_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_chats" ADD CONSTRAINT "search_chats_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_messages" ADD CONSTRAINT "search_messages_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "search_chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---- manual additions below ----

-- Exactly one root-level head block per page (prev_block_id=null and parent_block_id=null)
CREATE UNIQUE INDEX "blocks_head_root"
  ON "blocks" ("page_id")
  WHERE "parent_block_id" IS NULL AND "prev_block_id" IS NULL;

-- Exactly one head per nested sibling group (prev_block_id=null, parent_block_id not null)
CREATE UNIQUE INDEX "blocks_head_nested"
  ON "blocks" ("parent_block_id")
  WHERE "parent_block_id" IS NOT NULL AND "prev_block_id" IS NULL;
