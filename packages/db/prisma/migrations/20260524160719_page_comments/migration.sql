-- CreateTable
CREATE TABLE "page_comment_threads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "page_id" UUID NOT NULL,
    "anchor_start" TEXT NOT NULL,
    "anchor_end" TEXT NOT NULL,
    "quoted_text" TEXT NOT NULL,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "page_comment_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_comments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "thread_id" UUID NOT NULL,
    "author_id" UUID,
    "author_name" VARCHAR(255) NOT NULL,
    "author_anon_id" VARCHAR(64),
    "content" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "page_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "page_comment_threads_page_id_idx" ON "page_comment_threads"("page_id");

-- CreateIndex
CREATE INDEX "page_comments_thread_id_created_at_idx" ON "page_comments"("thread_id", "created_at");

-- AddForeignKey
ALTER TABLE "page_comment_threads" ADD CONSTRAINT "page_comment_threads_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_comment_threads" ADD CONSTRAINT "page_comment_threads_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_comments" ADD CONSTRAINT "page_comments_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "page_comment_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_comments" ADD CONSTRAINT "page_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
