-- CreateEnum
CREATE TYPE "FileStatus" AS ENUM ('ACTIVE', 'PENDING', 'DELETED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "files" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "workspace_id" UUID,
    "name" VARCHAR(512) NOT NULL,
    "ext" VARCHAR(16) NOT NULL,
    "file_size" BIGINT NOT NULL,
    "mime_type" VARCHAR(128) NOT NULL,
    "hash" VARCHAR(64) NOT NULL,
    "path" VARCHAR(512) NOT NULL,
    "status" "FileStatus" NOT NULL DEFAULT 'ACTIVE',
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "download_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "block_files" (
    "block_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "block_files_pkey" PRIMARY KEY ("block_id","file_id")
);

-- CreateIndex
CREATE INDEX "files_user_id_idx" ON "files"("user_id");

-- CreateIndex
CREATE INDEX "files_created_at_idx" ON "files"("created_at");

-- CreateIndex
CREATE INDEX "files_workspace_id_idx" ON "files"("workspace_id");

-- CreateIndex
CREATE INDEX "block_files_file_id_idx" ON "block_files"("file_id");

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "block_files" ADD CONSTRAINT "block_files_block_id_fkey" FOREIGN KEY ("block_id") REFERENCES "blocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "block_files" ADD CONSTRAINT "block_files_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Partial unique indexes (Prisma cannot express these in schema.prisma)
-- Dedup key for user-level files (avatars): same user + same hash, only one row.
CREATE UNIQUE INDEX "files_user_hash_no_ws"
  ON "files"("user_id", "hash")
  WHERE "workspace_id" IS NULL;

-- Dedup key for workspace-scoped files: same (user, workspace, hash), only one row.
CREATE UNIQUE INDEX "files_user_ws_hash"
  ON "files"("user_id", "workspace_id", "hash")
  WHERE "workspace_id" IS NOT NULL;
