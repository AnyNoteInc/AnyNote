-- CreateTable
CREATE TABLE "synced_blocks" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "origin_page_id" UUID,
    "content" JSONB,
    "content_yjs" BYTEA,
    "created_by_id" UUID,
    "unsynced_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "synced_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "synced_blocks_workspace_id_idx" ON "synced_blocks"("workspace_id");

-- AddForeignKey
ALTER TABLE "synced_blocks" ADD CONSTRAINT "synced_blocks_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "synced_blocks" ADD CONSTRAINT "synced_blocks_origin_page_id_fkey" FOREIGN KEY ("origin_page_id") REFERENCES "pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
