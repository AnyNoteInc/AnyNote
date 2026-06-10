-- CreateEnum
CREATE TYPE "ImportSource" AS ENUM ('GENERIC', 'NOTION', 'CONFLUENCE', 'YANDEX_WIKI');

-- AlterTable
ALTER TABLE "import_jobs" ADD COLUMN     "source" "ImportSource" NOT NULL DEFAULT 'GENERIC';
