-- AlterTable
ALTER TABLE "favorite_pages" ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;

-- backfill: assign position = row_number per user, ordered by createdAt
UPDATE "favorite_pages" fp
SET position = sub.rn
FROM (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at ASC) - 1 AS rn
  FROM "favorite_pages"
) sub
WHERE fp.id = sub.id;
