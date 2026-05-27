-- AlterTable
ALTER TABLE "plans" ADD COLUMN     "max_file_bytes" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "workspace_limits" (
    "workspace_id" UUID NOT NULL,
    "max_members" INTEGER NOT NULL,
    "max_file_bytes" BIGINT NOT NULL,
    "source_plan_slug" VARCHAR(50),
    "synced_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "workspace_limits_pkey" PRIMARY KEY ("workspace_id")
);

-- AddForeignKey
ALTER TABLE "workspace_limits" ADD CONSTRAINT "workspace_limits_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Set plan storage limits
UPDATE plans SET max_file_bytes = 524288000 WHERE slug = 'personal';
UPDATE plans SET max_file_bytes = 5368709120 WHERE slug = 'pro';
UPDATE plans SET max_file_bytes = 21474836480 WHERE slug = 'max';

-- Cap MAX plan workspaces at 10 (was unlimited / null)
UPDATE plans SET max_workspaces = 10 WHERE slug = 'max' AND max_workspaces IS NULL;

-- Backfill workspace_limits from owner's active plan, falling back to personal
INSERT INTO workspace_limits (workspace_id, max_members, max_file_bytes, source_plan_slug, synced_at, created_at, updated_at)
SELECT
  w.id,
  COALESCE(p.max_members_per_workspace, fallback.max_members_per_workspace),
  COALESCE(p.max_file_bytes, fallback.max_file_bytes),
  COALESCE(p.slug, fallback.slug),
  NOW(),
  NOW(),
  NOW()
FROM workspaces w
LEFT JOIN subscriptions s ON s.user_id = w.created_by_id AND s.status = 'ACTIVE'
LEFT JOIN plans p ON p.id = s.plan_id
CROSS JOIN (SELECT max_members_per_workspace, max_file_bytes, slug FROM plans WHERE slug = 'personal') fallback
ON CONFLICT (workspace_id) DO NOTHING;
