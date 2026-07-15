-- AlterEnum
ALTER TYPE "DatabaseViewType" ADD VALUE 'FORM';

-- AlterEnum
ALTER TYPE "NotificationEventType" ADD VALUE 'FORM_SUBMITTED';

-- CreateEnum
CREATE TYPE "DatabaseFormState" AS ENUM ('DRAFT', 'OPEN', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DatabaseFormAudience" AS ENUM ('ANYONE_WITH_LINK', 'SIGNED_IN_WITH_LINK', 'WORKSPACE_MEMBERS_WITH_LINK');

-- CreateEnum
CREATE TYPE "DatabaseFormRespondentAccess" AS ENUM ('NONE', 'VIEW', 'EDIT');

-- CreateTable
CREATE TABLE "database_forms" (
    "id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "view_id" UUID,
    "route_key" VARCHAR(64) NOT NULL,
    "custom_slug" VARCHAR(64),
    "link_revision" INTEGER NOT NULL DEFAULT 1,
    "state" "DatabaseFormState" NOT NULL DEFAULT 'DRAFT',
    "audience" "DatabaseFormAudience" NOT NULL DEFAULT 'ANYONE_WITH_LINK',
    "respondent_access" "DatabaseFormRespondentAccess" NOT NULL DEFAULT 'NONE',
    "draft_schema" JSONB NOT NULL,
    "draft_revision" INTEGER NOT NULL DEFAULT 1,
    "published_version_id" UUID,
    "opens_at" TIMESTAMPTZ(6),
    "closes_at" TIMESTAMPTZ(6),
    "response_limit" INTEGER,
    "accepted_responses" INTEGER NOT NULL DEFAULT 0,
    "notify_owners" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "database_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "database_form_versions" (
    "id" UUID NOT NULL,
    "form_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "schema" JSONB NOT NULL,
    "schema_hash" VARCHAR(64) NOT NULL,
    "published_by_id" UUID NOT NULL,
    "published_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accept_until" TIMESTAMPTZ(6),

    CONSTRAINT "database_form_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "database_form_submissions" (
    "id" UUID NOT NULL,
    "form_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "row_id" UUID NOT NULL,
    "respondent_user_id" UUID,
    "ending_id" VARCHAR(64) NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "database_form_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "database_form_uploads" (
    "id" UUID NOT NULL,
    "form_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "question_id" VARCHAR(64) NOT NULL,
    "file_id" UUID NOT NULL,
    "upload_token_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "database_form_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "database_forms_view_id_key" ON "database_forms"("view_id");

-- CreateIndex
CREATE UNIQUE INDEX "database_forms_route_key_key" ON "database_forms"("route_key");

-- CreateIndex
CREATE UNIQUE INDEX "database_forms_custom_slug_key" ON "database_forms"("custom_slug");

-- CreateIndex
CREATE UNIQUE INDEX "database_forms_published_version_id_key" ON "database_forms"("published_version_id");

-- CreateIndex
CREATE INDEX "database_forms_source_id_idx" ON "database_forms"("source_id");

-- CreateIndex
CREATE INDEX "database_forms_state_opens_at_closes_at_idx" ON "database_forms"("state", "opens_at", "closes_at");

-- CreateIndex
CREATE INDEX "database_form_versions_form_id_published_at_idx" ON "database_form_versions"("form_id", "published_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "database_form_versions_form_id_version_number_key" ON "database_form_versions"("form_id", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "database_form_submissions_row_id_key" ON "database_form_submissions"("row_id");

-- CreateIndex
CREATE INDEX "database_form_submissions_form_id_submitted_at_idx" ON "database_form_submissions"("form_id", "submitted_at" DESC);

-- CreateIndex
CREATE INDEX "database_form_submissions_respondent_user_id_submitted_at_idx" ON "database_form_submissions"("respondent_user_id", "submitted_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "database_form_submissions_form_id_idempotency_key_key" ON "database_form_submissions"("form_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "database_form_uploads_file_id_key" ON "database_form_uploads"("file_id");

-- CreateIndex
CREATE INDEX "database_form_uploads_form_id_version_id_question_id_idx" ON "database_form_uploads"("form_id", "version_id", "question_id");

-- CreateIndex
CREATE INDEX "database_form_uploads_form_id_expires_at_idx" ON "database_form_uploads"("form_id", "expires_at");

-- CreateIndex
CREATE INDEX "database_form_uploads_expires_at_consumed_at_idx" ON "database_form_uploads"("expires_at", "consumed_at");

-- AddForeignKey
ALTER TABLE "database_forms" ADD CONSTRAINT "database_forms_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "database_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "database_forms" ADD CONSTRAINT "database_forms_view_id_fkey" FOREIGN KEY ("view_id") REFERENCES "database_views"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "database_forms" ADD CONSTRAINT "database_forms_published_version_id_fkey" FOREIGN KEY ("published_version_id") REFERENCES "database_form_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "database_forms" ADD CONSTRAINT "database_forms_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "database_form_versions" ADD CONSTRAINT "database_form_versions_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "database_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "database_form_versions" ADD CONSTRAINT "database_form_versions_published_by_id_fkey" FOREIGN KEY ("published_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "database_form_submissions" ADD CONSTRAINT "database_form_submissions_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "database_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "database_form_submissions" ADD CONSTRAINT "database_form_submissions_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "database_form_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "database_form_submissions" ADD CONSTRAINT "database_form_submissions_row_id_fkey" FOREIGN KEY ("row_id") REFERENCES "database_rows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "database_form_submissions" ADD CONSTRAINT "database_form_submissions_respondent_user_id_fkey" FOREIGN KEY ("respondent_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "database_form_uploads" ADD CONSTRAINT "database_form_uploads_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "database_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "database_form_uploads" ADD CONSTRAINT "database_form_uploads_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "database_form_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "database_form_uploads" ADD CONSTRAINT "database_form_uploads_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Convert legacy FILE cell values from scalar file IDs to arrays of file IDs.
UPDATE "database_cell_values" AS c
SET "value" = jsonb_build_array(c."value")
FROM "database_properties" AS p
WHERE p."id" = c."property_id"
  AND p."type" = 'FILE'
  AND jsonb_typeof(c."value") = 'string'
  AND c."value" <> '""'::jsonb;
