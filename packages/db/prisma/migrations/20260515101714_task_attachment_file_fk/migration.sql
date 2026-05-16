/*
  Warnings:

  - The primary key for the `task_attachments` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `file_name` on the `task_attachments` table. All the data in the column will be lost.
  - You are about to drop the column `finalized_at` on the `task_attachments` table. All the data in the column will be lost.
  - You are about to drop the column `id` on the `task_attachments` table. All the data in the column will be lost.
  - You are about to drop the column `mime_type` on the `task_attachments` table. All the data in the column will be lost.
  - You are about to drop the column `size` on the `task_attachments` table. All the data in the column will be lost.
  - You are about to drop the column `storage_key` on the `task_attachments` table. All the data in the column will be lost.
  - Added the required column `file_id` to the `task_attachments` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "task_attachments" DROP CONSTRAINT "task_attachments_pkey",
DROP COLUMN "file_name",
DROP COLUMN "finalized_at",
DROP COLUMN "id",
DROP COLUMN "mime_type",
DROP COLUMN "size",
DROP COLUMN "storage_key",
ADD COLUMN     "file_id" UUID NOT NULL,
ADD CONSTRAINT "task_attachments_pkey" PRIMARY KEY ("task_id", "file_id");

-- CreateIndex
CREATE INDEX "task_attachments_file_id_idx" ON "task_attachments"("file_id");

-- AddForeignKey
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;
