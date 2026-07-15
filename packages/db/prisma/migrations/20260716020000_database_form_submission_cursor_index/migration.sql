-- CreateIndex
CREATE INDEX "database_form_submissions_form_id_submitted_at_id_idx"
ON "database_form_submissions"("form_id", "submitted_at" DESC, "id" DESC);
