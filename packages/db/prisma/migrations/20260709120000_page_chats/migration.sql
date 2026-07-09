-- AlterEnum
ALTER TYPE "ChatKind" ADD VALUE 'PAGE';

-- AlterTable
ALTER TABLE "chats" ADD COLUMN     "page_id" UUID;

-- CreateIndex
CREATE INDEX "chats_page_id_idx" ON "chats"("page_id");

-- AddForeignKey
ALTER TABLE "chats" ADD CONSTRAINT "chats_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
