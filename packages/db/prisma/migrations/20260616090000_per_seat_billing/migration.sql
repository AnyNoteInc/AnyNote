-- CreateEnum
CREATE TYPE "SeatBillingEventType" AS ENUM ('MEMBER_JOINED', 'MEMBER_REMOVED', 'SEATS_PURCHASED', 'SEATS_REDUCTION_SCHEDULED', 'SEATS_RENEWED', 'ADDONS_RESET');

-- CreateEnum
CREATE TYPE "InvoiceRequestStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'COMPLETED', 'REJECTED');

-- AlterTable
ALTER TABLE "plans" ADD COLUMN     "price_per_extra_seat_monthly_kopecks" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "price_per_extra_seat_yearly_kopecks" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "workspace_seat_addons" (
    "workspace_id" UUID NOT NULL,
    "paid_seats" INTEGER NOT NULL DEFAULT 0,
    "scheduled_seats" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_seat_addons_pkey" PRIMARY KEY ("workspace_id")
);

-- CreateTable
CREATE TABLE "seat_billing_events" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "type" "SeatBillingEventType" NOT NULL,
    "seats_delta" INTEGER NOT NULL DEFAULT 0,
    "seats_after" INTEGER,
    "amount_kopecks" INTEGER,
    "order_id" UUID,
    "actor_id" UUID,
    "target_user_id" UUID,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seat_billing_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_seat_snapshots" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "subscription_id" UUID,
    "order_id" UUID,
    "member_count" INTEGER NOT NULL,
    "included_seats" INTEGER NOT NULL,
    "extra_seats" INTEGER NOT NULL,
    "seat_amount_kopecks" INTEGER NOT NULL DEFAULT 0,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_seat_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_requests" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "legal_name" VARCHAR(255) NOT NULL,
    "inn" VARCHAR(12) NOT NULL,
    "kpp" VARCHAR(9),
    "legal_address" VARCHAR(500) NOT NULL,
    "contact_email" VARCHAR(255) NOT NULL,
    "period_months" INTEGER NOT NULL DEFAULT 12,
    "seats" INTEGER NOT NULL,
    "comment" VARCHAR(1000),
    "status" "InvoiceRequestStatus" NOT NULL DEFAULT 'NEW',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "seat_billing_events_workspace_id_created_at_idx" ON "seat_billing_events"("workspace_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "workspace_seat_snapshots_workspace_id_captured_at_idx" ON "workspace_seat_snapshots"("workspace_id", "captured_at" DESC);

-- CreateIndex
CREATE INDEX "invoice_requests_workspace_id_created_at_idx" ON "invoice_requests"("workspace_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "workspace_seat_addons" ADD CONSTRAINT "workspace_seat_addons_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_billing_events" ADD CONSTRAINT "seat_billing_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_seat_snapshots" ADD CONSTRAINT "workspace_seat_snapshots_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_requests" ADD CONSTRAINT "invoice_requests_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Seed-parity price values for the shared dev DB (the seed only runs on fresh DBs;
-- mid-phase the shared DB never re-seeds — idempotent, additive UPDATEs instead).
-- personal stays 0/0 (the column default); pro/max follow the existing 10x yearly pattern.
UPDATE "plans" SET "price_per_extra_seat_monthly_kopecks" = 19000, "price_per_extra_seat_yearly_kopecks" = 190000 WHERE "slug" = 'pro';
UPDATE "plans" SET "price_per_extra_seat_monthly_kopecks" = 29000, "price_per_extra_seat_yearly_kopecks" = 290000 WHERE "slug" = 'max';
