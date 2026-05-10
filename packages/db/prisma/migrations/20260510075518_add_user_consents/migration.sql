-- CreateEnum
CREATE TYPE "ConsentDocumentType" AS ENUM ('USER_AGREEMENT', 'PRIVACY_POLICY', 'PII_PROCESSING', 'MARKETING', 'PUBLIC_OFFER');

-- CreateEnum
CREATE TYPE "ConsentSource" AS ENUM ('SIGN_UP', 'ONBOARDING', 'SETTINGS');

-- CreateTable
CREATE TABLE "user_consents" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "document_type" "ConsentDocumentType" NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "document_version" VARCHAR(80) NOT NULL,
    "source" "ConsentSource" NOT NULL,
    "ip_address" VARCHAR(45),
    "user_agent" VARCHAR(1024),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_consents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_consents_user_id_document_type_created_at_idx" ON "user_consents"("user_id", "document_type", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "user_consents" ADD CONSTRAINT "user_consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
