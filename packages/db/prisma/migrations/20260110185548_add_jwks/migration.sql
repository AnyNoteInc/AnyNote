-- CreateTable
CREATE TABLE "jwks" (
    "id" UUID NOT NULL,
    "public_key" TEXT NOT NULL,
    "private_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6),

    CONSTRAINT "jwks_pkey" PRIMARY KEY ("id")
);
