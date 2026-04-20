-- CreateEnum
CREATE TYPE "OutboxEventStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" BIGSERIAL NOT NULL,
    "event_type" VARCHAR(64) NOT NULL,
    "aggregate_type" VARCHAR(32) NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "workspace_id" UUID,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "OutboxEventStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMPTZ(6),
    "locked_by" VARCHAR(64),
    "processed_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outbox_events_status_next_attempt_at_idx" ON "outbox_events"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "outbox_events_aggregate_type_aggregate_id_idx" ON "outbox_events"("aggregate_type", "aggregate_id");
