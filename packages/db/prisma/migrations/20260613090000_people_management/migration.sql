-- CreateTable
CREATE TABLE "workspace_invitations" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "role" "RoleType" NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "inviter_id" UUID NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "accepted_by_id" UUID,
    "revoked_at" TIMESTAMP(3),
    "revoked_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_invite_links" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "role" "RoleType" NOT NULL DEFAULT 'EDITOR',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID NOT NULL,
    "rotated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_invite_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_guest_invites" (
    "id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "role" "PageShareRole" NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "inviter_id" UUID NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "accepted_by_id" UUID,
    "revoked_at" TIMESTAMP(3),
    "revoked_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "page_guest_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_blocked_users" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "blocked_by_id" UUID NOT NULL,
    "reason" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_blocked_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_audit_logs" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "actor_id" UUID,
    "action" VARCHAR(64) NOT NULL,
    "target_user_id" UUID,
    "target_email" VARCHAR(255),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspace_invitations_token_hash_key" ON "workspace_invitations"("token_hash");

-- CreateIndex
CREATE INDEX "workspace_invitations_workspace_id_created_at_idx" ON "workspace_invitations"("workspace_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "workspace_invitations_email_idx" ON "workspace_invitations"("email");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_invite_links_workspace_id_key" ON "workspace_invite_links"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_invite_links_token_hash_key" ON "workspace_invite_links"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "page_guest_invites_token_hash_key" ON "page_guest_invites"("token_hash");

-- CreateIndex
CREATE INDEX "page_guest_invites_workspace_id_idx" ON "page_guest_invites"("workspace_id");

-- CreateIndex
CREATE INDEX "page_guest_invites_page_id_idx" ON "page_guest_invites"("page_id");

-- CreateIndex
CREATE INDEX "workspace_blocked_users_user_id_idx" ON "workspace_blocked_users"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_blocked_users_workspace_id_user_id_key" ON "workspace_blocked_users"("workspace_id", "user_id");

-- CreateIndex
CREATE INDEX "workspace_audit_logs_workspace_id_created_at_idx" ON "workspace_audit_logs"("workspace_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_invite_links" ADD CONSTRAINT "workspace_invite_links_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_guest_invites" ADD CONSTRAINT "page_guest_invites_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_guest_invites" ADD CONSTRAINT "page_guest_invites_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_blocked_users" ADD CONSTRAINT "workspace_blocked_users_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_blocked_users" ADD CONSTRAINT "workspace_blocked_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_audit_logs" ADD CONSTRAINT "workspace_audit_logs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- CreateIndex (partial unique, hand-appended: at most one active invitation per (workspace, email))
CREATE UNIQUE INDEX "workspace_invitations_one_active" ON "workspace_invitations" ("workspace_id", "email") WHERE "accepted_at" IS NULL AND "revoked_at" IS NULL;

-- CreateIndex (partial unique, hand-appended: at most one active guest invite per (page, email))
CREATE UNIQUE INDEX "page_guest_invites_one_active" ON "page_guest_invites" ("page_id", "email") WHERE "accepted_at" IS NULL AND "revoked_at" IS NULL;
