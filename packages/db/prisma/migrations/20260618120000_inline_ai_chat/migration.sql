-- CreateEnum
CREATE TYPE "ChatKind" AS ENUM ('NORMAL', 'INLINE_AI');

-- AlterTable
ALTER TABLE "chats" ADD COLUMN     "inline_ai_page_id" UUID,
ADD COLUMN     "kind" "ChatKind" NOT NULL DEFAULT 'NORMAL';

-- CreateIndex
CREATE UNIQUE INDEX "chats_created_by_id_inline_ai_page_id_key" ON "chats"("created_by_id", "inline_ai_page_id");

-- AddForeignKey
ALTER TABLE "chats" ADD CONSTRAINT "chats_inline_ai_page_id_fkey" FOREIGN KEY ("inline_ai_page_id") REFERENCES "pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
