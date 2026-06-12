-- CreateTable
CREATE TABLE "sso_providers" (
    "id" UUID NOT NULL,
    "issuer" VARCHAR(500) NOT NULL,
    "domain" VARCHAR(255) NOT NULL,
    "oidc_config" TEXT,
    "saml_config" TEXT,
    "user_id" UUID NOT NULL,
    "provider_id" VARCHAR(64) NOT NULL,
    "organization_id" VARCHAR(255),
    "domain_verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sso_providers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sso_providers_provider_id_key" ON "sso_providers"("provider_id");

-- CreateIndex
CREATE INDEX "sso_providers_domain_idx" ON "sso_providers"("domain");

-- AddForeignKey
ALTER TABLE "sso_providers" ADD CONSTRAINT "sso_providers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

