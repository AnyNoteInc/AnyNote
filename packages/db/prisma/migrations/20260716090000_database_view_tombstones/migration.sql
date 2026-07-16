ALTER TABLE "database_views" ADD COLUMN "archived_at" TIMESTAMPTZ(6);

CREATE INDEX "database_views_source_id_archived_at_position_idx"
ON "database_views"("source_id", "archived_at", "position");
