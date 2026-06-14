-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('UPLOADED', 'TRANSCRIBING', 'SUMMARIZING', 'READY', 'FAILED');

-- AlterEnum
ALTER TYPE "PageType" ADD VALUE 'MEETING';

-- CreateTable
CREATE TABLE "meeting_artifacts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "page_id" UUID,
    "created_by_id" UUID NOT NULL,
    "recording_file_id" UUID NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Встреча',
    "status" "MeetingStatus" NOT NULL DEFAULT 'UPLOADED',
    "summary" TEXT,
    "summary_instruction_id" UUID,
    "consent_ack" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "duration_ms" INTEGER,
    "language" TEXT,
    "heartbeat_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "meeting_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcript_segments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "meeting_id" UUID NOT NULL,
    "idx" INTEGER NOT NULL,
    "start_ms" INTEGER NOT NULL,
    "end_ms" INTEGER NOT NULL,
    "speaker" TEXT,
    "text" TEXT NOT NULL,

    CONSTRAINT "transcript_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "meeting_id" UUID NOT NULL,
    "idx" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "action_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "summary_instructions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "summary_instructions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "meeting_artifacts_page_id_key" ON "meeting_artifacts"("page_id");

-- CreateIndex
CREATE INDEX "meeting_artifacts_workspace_id_idx" ON "meeting_artifacts"("workspace_id");

-- CreateIndex
CREATE INDEX "transcript_segments_meeting_id_idx_idx" ON "transcript_segments"("meeting_id", "idx");

-- CreateIndex
CREATE INDEX "action_items_meeting_id_idx_idx" ON "action_items"("meeting_id", "idx");

-- CreateIndex
CREATE INDEX "summary_instructions_workspace_id_idx" ON "summary_instructions"("workspace_id");

-- AddForeignKey
ALTER TABLE "meeting_artifacts" ADD CONSTRAINT "meeting_artifacts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_artifacts" ADD CONSTRAINT "meeting_artifacts_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_artifacts" ADD CONSTRAINT "meeting_artifacts_recording_file_id_fkey" FOREIGN KEY ("recording_file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_artifacts" ADD CONSTRAINT "meeting_artifacts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_artifacts" ADD CONSTRAINT "meeting_artifacts_summary_instruction_id_fkey" FOREIGN KEY ("summary_instruction_id") REFERENCES "summary_instructions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meeting_artifacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meeting_artifacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "summary_instructions" ADD CONSTRAINT "summary_instructions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

