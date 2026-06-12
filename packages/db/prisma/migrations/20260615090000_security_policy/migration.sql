-- CreateEnum
CREATE TYPE "GuestInviteRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "NotificationEventType" ADD VALUE 'GUEST_INVITE_REQUESTED';

-- CreateTable
CREATE TABLE "workspace_security_policies" (
    "workspace_id" UUID NOT NULL,
    "disable_guest_invites" BOOLEAN NOT NULL DEFAULT false,
    "allow_guest_invite_requests" BOOLEAN NOT NULL DEFAULT true,
    "disable_public_links_sites_forms" BOOLEAN NOT NULL DEFAULT false,
    "disable_export" BOOLEAN NOT NULL DEFAULT false,
    "disable_move_duplicate_outside_workspace" BOOLEAN NOT NULL DEFAULT false,
    "admin_content_search_acknowledged_at" TIMESTAMP(3),
    "admin_content_search_acknowledged_by_id" UUID,
    "configured_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_security_policies_pkey" PRIMARY KEY ("workspace_id")
);

-- CreateTable
CREATE TABLE "page_guest_invite_requests" (
    "id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "role" "PageShareRole" NOT NULL,
    "requester_id" UUID NOT NULL,
    "status" "GuestInviteRequestStatus" NOT NULL DEFAULT 'PENDING',
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "page_guest_invite_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "page_guest_invite_requests_workspace_id_status_idx" ON "page_guest_invite_requests"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "page_guest_invite_requests_page_id_idx" ON "page_guest_invite_requests"("page_id");

-- CreateIndex (partial unique: at most one PENDING request per page+email, the job-infra pattern)
CREATE UNIQUE INDEX "page_guest_invite_requests_one_pending" ON "page_guest_invite_requests"("page_id", "email") WHERE "status" = 'PENDING';

-- AddForeignKey
ALTER TABLE "workspace_security_policies" ADD CONSTRAINT "workspace_security_policies_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_guest_invite_requests" ADD CONSTRAINT "page_guest_invite_requests_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_guest_invite_requests" ADD CONSTRAINT "page_guest_invite_requests_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
