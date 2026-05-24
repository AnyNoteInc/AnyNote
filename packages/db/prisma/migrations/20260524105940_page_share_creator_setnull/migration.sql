-- DropForeignKey
ALTER TABLE "page_shares" DROP CONSTRAINT "page_shares_created_by_id_fkey";

-- DropIndex
DROP INDEX "page_shares_share_id_idx";

-- AlterTable
ALTER TABLE "page_shares" ALTER COLUMN "created_by_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "page_shares" ADD CONSTRAINT "page_shares_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
