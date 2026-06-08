
-- CreateEnum
CREATE TYPE "PageShareMode" AS ENUM ('LINK', 'SITE');

-- AlterTable
ALTER TABLE "page_shares" ADD COLUMN     "allow_copy" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "allow_indexing" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "analytics_google_id" TEXT,
ADD COLUMN     "analytics_yandex_metrica_id" TEXT,
ADD COLUMN     "expires_at" TIMESTAMPTZ(6),
ADD COLUMN     "exposes_at" TIMESTAMPTZ(6),
ADD COLUMN     "mode" "PageShareMode" NOT NULL DEFAULT 'LINK',
ADD COLUMN     "password_hash" TEXT,
ADD COLUMN     "publish_subpages" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "published_at" TIMESTAMPTZ(6),
ADD COLUMN     "unpublished_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "pages" ADD COLUMN     "copied_at" TIMESTAMPTZ(6),
ADD COLUMN     "copied_from_page_id" UUID,
ADD COLUMN     "copied_from_share_id" TEXT;

