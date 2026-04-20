CREATE UNIQUE INDEX IF NOT EXISTS "outbox_events_active_unique"
  ON "outbox_events" ("aggregate_type", "aggregate_id", "event_type")
  WHERE status IN ('PENDING', 'PROCESSING');
