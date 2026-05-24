-- CreateEnum
CREATE TYPE "PageShareAccess" AS ENUM ('RESTRICTED', 'PUBLIC');

-- CreateEnum
CREATE TYPE "PageShareRole" AS ENUM ('READER', 'COMMENTER', 'EDITOR');

-- CreateTable
CREATE TABLE "page_shares" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "page_id" UUID NOT NULL,
    "share_id" VARCHAR(64) NOT NULL,
    "access" "PageShareAccess" NOT NULL DEFAULT 'RESTRICTED',
    "link_role" "PageShareRole" NOT NULL DEFAULT 'READER',
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "page_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_share_users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "page_share_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "PageShareRole" NOT NULL DEFAULT 'READER',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_share_users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "page_shares_page_id_key" ON "page_shares"("page_id");

-- CreateIndex
CREATE UNIQUE INDEX "page_shares_share_id_key" ON "page_shares"("share_id");

-- CreateIndex
CREATE INDEX "page_shares_share_id_idx" ON "page_shares"("share_id");

-- CreateIndex
CREATE INDEX "page_share_users_user_id_idx" ON "page_share_users"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "page_share_users_page_share_id_user_id_key" ON "page_share_users"("page_share_id", "user_id");

-- AddForeignKey
ALTER TABLE "page_shares" ADD CONSTRAINT "page_shares_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_shares" ADD CONSTRAINT "page_shares_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_share_users" ADD CONSTRAINT "page_share_users_page_share_id_fkey" FOREIGN KEY ("page_share_id") REFERENCES "page_shares"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_share_users" ADD CONSTRAINT "page_share_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
