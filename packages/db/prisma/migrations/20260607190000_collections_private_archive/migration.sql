/*
  Notion-parity Phase 1: collections, private pages, archive.

  Adds the Collection model, Page.collectionId/archivedAt/archivedById,
  UserPreference.collectionOrder, then backfills:
    - one TEAM collection per workspace,
    - one PERSONAL collection per (workspace, member),
    - legacy non-template pages -> their workspace TEAM collection,
    - existing page-level archive (the dropped `archived` boolean) -> archivedAt.
  The `pages.archived` boolean is dropped LAST, after its value is preserved.
*/

-- CreateEnum
CREATE TYPE "CollectionKind" AS ENUM ('TEAM', 'PERSONAL', 'SITE');

-- AlterTable: add new page columns (archived boolean dropped at the very end)
ALTER TABLE "pages"
ADD COLUMN     "archived_at" TIMESTAMPTZ(6),
ADD COLUMN     "archived_by_id" UUID,
ADD COLUMN     "collection_id" UUID;

-- AlterTable
ALTER TABLE "user_preferences" ADD COLUMN     "collection_order" JSONB;

-- CreateTable
CREATE TABLE "collections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "kind" "CollectionKind" NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "icon" TEXT,
    "color" TEXT,
    "owner_id" UUID,
    "home_page_id" UUID,
    "position" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "collections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "collections_home_page_id_key" ON "collections"("home_page_id");

-- CreateIndex
CREATE INDEX "collections_workspace_id_kind_idx" ON "collections"("workspace_id", "kind");

-- CreateIndex
CREATE INDEX "collections_owner_id_idx" ON "collections"("owner_id");

-- CreateIndex
CREATE INDEX "pages_collection_id_idx" ON "pages"("collection_id");

-- CreateIndex
CREATE INDEX "pages_archived_at_idx" ON "pages"("archived_at");

-- AddForeignKey
ALTER TABLE "pages" ADD CONSTRAINT "pages_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pages" ADD CONSTRAINT "pages_archived_by_id_fkey" FOREIGN KEY ("archived_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_home_page_id_fkey" FOREIGN KEY ("home_page_id") REFERENCES "pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Partial unique indexes (Prisma can't express WHERE): one team space per workspace; one personal collection per user
CREATE UNIQUE INDEX "collections_one_team_per_workspace"
  ON "collections" ("workspace_id") WHERE "kind" = 'TEAM' AND "owner_id" IS NULL;
CREATE UNIQUE INDEX "collections_one_personal_per_user"
  ON "collections" ("workspace_id", "owner_id") WHERE "kind" = 'PERSONAL';

-- Backfill: one TEAM collection per workspace
INSERT INTO "collections" ("id", "workspace_id", "kind", "title", "position", "created_at", "updated_at")
SELECT gen_random_uuid(), w."id", 'TEAM', 'Общее', 0, now(), now()
FROM "workspaces" w;

-- Backfill: one PERSONAL collection per (workspace, member)
INSERT INTO "collections" ("id", "workspace_id", "kind", "title", "owner_id", "position", "created_at", "updated_at")
SELECT gen_random_uuid(), m."workspace_id", 'PERSONAL', 'Личное', m."user_id", 0, now(), now()
FROM "workspace_members" m;

-- Backfill: legacy pages (no collection, not a template page) -> their workspace TEAM collection
UPDATE "pages" p
SET "collection_id" = c."id"
FROM "collections" c
WHERE c."workspace_id" = p."workspace_id"
  AND c."kind" = 'TEAM' AND c."owner_id" IS NULL
  AND p."collection_id" IS NULL
  AND p."is_template" IS NULL;

-- Preserve existing page-level archive state before dropping the boolean column
UPDATE "pages" SET "archived_at" = now() WHERE "archived" = true;

-- DropIndex + DropColumn: remove the legacy archived boolean LAST (value already preserved above)
DROP INDEX "pages_archived_idx";
ALTER TABLE "pages" DROP COLUMN "archived";
