-- CreateEnum
CREATE TYPE "DomainVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AuthProviderType" AS ENUM ('OIDC', 'OAUTH', 'SAML_RESERVED');

-- CreateEnum
CREATE TYPE "AuthProviderStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateTable
CREATE TABLE "allowed_email_domains" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "domain" VARCHAR(255) NOT NULL,
    "added_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allowed_email_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verified_email_domains" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "domain" VARCHAR(255) NOT NULL,
    "status" "DomainVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "verification_token" VARCHAR(64) NOT NULL,
    "token_expires_at" TIMESTAMP(3) NOT NULL,
    "verified_at" TIMESTAMP(3),
    "last_checked_at" TIMESTAMP(3),
    "last_check_error" VARCHAR(255),
    "added_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verified_email_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_auth_providers" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "type" "AuthProviderType" NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "status" "AuthProviderStatus" NOT NULL DEFAULT 'DISABLED',
    "domain_id" UUID,
    "issuer_url" VARCHAR(500),
    "client_id" VARCHAR(255),
    "client_secret_enc" JSONB,
    "sso_provider_id" VARCHAR(64),
    "metadata" JSONB,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_auth_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_identity_links" (
    "id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "external_subject" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255),
    "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_identity_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "allowed_email_domains_domain_idx" ON "allowed_email_domains"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "allowed_email_domains_workspace_id_domain_key" ON "allowed_email_domains"("workspace_id", "domain");

-- CreateIndex
CREATE INDEX "verified_email_domains_domain_idx" ON "verified_email_domains"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "verified_email_domains_workspace_id_domain_key" ON "verified_email_domains"("workspace_id", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_auth_providers_sso_provider_id_key" ON "workspace_auth_providers"("sso_provider_id");

-- CreateIndex
CREATE INDEX "workspace_auth_providers_workspace_id_idx" ON "workspace_auth_providers"("workspace_id");

-- CreateIndex
CREATE INDEX "external_identity_links_user_id_idx" ON "external_identity_links"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "external_identity_links_provider_id_external_subject_key" ON "external_identity_links"("provider_id", "external_subject");

-- AddForeignKey
ALTER TABLE "allowed_email_domains" ADD CONSTRAINT "allowed_email_domains_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verified_email_domains" ADD CONSTRAINT "verified_email_domains_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_auth_providers" ADD CONSTRAINT "workspace_auth_providers_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_auth_providers" ADD CONSTRAINT "workspace_auth_providers_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "verified_email_domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_identity_links" ADD CONSTRAINT "external_identity_links_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "workspace_auth_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_identity_links" ADD CONSTRAINT "external_identity_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

