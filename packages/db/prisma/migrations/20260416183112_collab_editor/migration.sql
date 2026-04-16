DROP TABLE IF EXISTS "block_files";
DROP TABLE IF EXISTS "blocks";
DROP TYPE IF EXISTS "BlockType";

ALTER TABLE "pages" DROP COLUMN "parent_type";
ALTER TABLE "pages" DROP COLUMN "cover_url";
ALTER TABLE "pages" DROP COLUMN "is_database_row";

DROP TYPE IF EXISTS "ParentType";

CREATE TYPE "PageType" AS ENUM ('TEXT', 'EXCALIDRAW', 'DATABASE', 'KANBAN', 'FORM');

ALTER TABLE "pages" ADD COLUMN "type" "PageType" NOT NULL DEFAULT 'TEXT';
ALTER TABLE "pages" ADD COLUMN "content" JSONB;
ALTER TABLE "pages" ADD COLUMN "content_yjs" BYTEA;

CREATE TABLE "page_files" (
  "page_id"    UUID NOT NULL,
  "file_id"    UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "page_files_pkey" PRIMARY KEY ("page_id", "file_id")
);
CREATE INDEX "page_files_file_id_idx" ON "page_files"("file_id");
ALTER TABLE "page_files"
  ADD CONSTRAINT "page_files_page_id_fkey"
  FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "page_files"
  ADD CONSTRAINT "page_files_file_id_fkey"
  FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP INDEX IF EXISTS "pages_parent_type_parent_id_idx";
CREATE INDEX "pages_parent_id_idx" ON "pages"("parent_id");
