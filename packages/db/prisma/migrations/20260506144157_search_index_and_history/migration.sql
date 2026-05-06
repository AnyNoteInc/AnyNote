-- WARNING: This migration adds a STORED generated column to "pages",
-- which performs a full table rewrite under an ACCESS EXCLUSIVE lock.
-- On large tables this will block reads and writes for minutes. Schedule
-- during a maintenance window or use a blue/green deployment in production.

-- Generated tsvector column on pages
ALTER TABLE "pages" ADD COLUMN "search_vector" tsvector
GENERATED ALWAYS AS (
  setweight(to_tsvector('russian', coalesce(title, '')), 'A') ||
  setweight(jsonb_to_tsvector('russian', coalesce(content, '{}'::jsonb), '["string"]'), 'B')
) STORED;

-- CreateTable
CREATE TABLE "search_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "last_visited_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "search_history_user_id_workspace_id_last_visited_at_idx" ON "search_history"("user_id", "workspace_id", "last_visited_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "search_history_user_id_workspace_id_page_id_key" ON "search_history"("user_id", "workspace_id", "page_id");

-- CreateIndex
CREATE INDEX "Page_searchVector_idx" ON "pages" USING GIN ("search_vector");

-- AddForeignKey
ALTER TABLE "search_history" ADD CONSTRAINT "search_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_history" ADD CONSTRAINT "search_history_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_history" ADD CONSTRAINT "search_history_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
