-- CreateTable
CREATE TABLE "workspace_participants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "user_id" UUID,
    "full_name" VARCHAR(64) NOT NULL,
    "company" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_participants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspace_participants_workspace_id_user_id_key" ON "workspace_participants"("workspace_id", "user_id");

-- CreateIndex
CREATE INDEX "workspace_participants_workspace_id_idx" ON "workspace_participants"("workspace_id");

-- AddForeignKey
ALTER TABLE "workspace_participants" ADD CONSTRAINT "workspace_participants_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_participants" ADD CONSTRAINT "workspace_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: one mirror participant per (workspace, user) that currently has any assignment
INSERT INTO "workspace_participants" ("workspace_id", "user_id", "full_name", "updated_at")
SELECT DISTINCT
    p."workspace_id",
    ta."user_id",
    COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u."firstName", u."lastName")), ''), u."email"),
    CURRENT_TIMESTAMP
FROM "task_assignees" ta
JOIN "tasks" t ON t."id" = ta."task_id"
JOIN "pages" p ON p."id" = t."page_id"
JOIN "users" u ON u."id" = ta."user_id";

-- Add participant_id (nullable for the rewrite)
ALTER TABLE "task_assignees" ADD COLUMN "participant_id" UUID;

-- Rewrite each assignee to point at its participant row
UPDATE "task_assignees" ta
SET "participant_id" = wp."id"
FROM "tasks" t
JOIN "pages" p ON p."id" = t."page_id"
JOIN "workspace_participants" wp ON wp."workspace_id" = p."workspace_id"
WHERE t."id" = ta."task_id" AND wp."user_id" = ta."user_id";

-- Drop old PK, index, FK, and column
ALTER TABLE "task_assignees" DROP CONSTRAINT "task_assignees_pkey";
DROP INDEX IF EXISTS "task_assignees_user_id_idx";
ALTER TABLE "task_assignees" DROP CONSTRAINT IF EXISTS "task_assignees_user_id_fkey";
ALTER TABLE "task_assignees" DROP COLUMN "user_id";

-- Enforce NOT NULL + new PK/index/FK
ALTER TABLE "task_assignees" ALTER COLUMN "participant_id" SET NOT NULL;
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_pkey" PRIMARY KEY ("task_id", "participant_id");
CREATE INDEX "task_assignees_participant_id_idx" ON "task_assignees"("participant_id");
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "workspace_participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
