-- CreateEnum
CREATE TYPE "role" AS ENUM ('CUSTOMER', 'ADMIN');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "role" "role" NOT NULL DEFAULT 'CUSTOMER',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- ---------- Added by hand ----------
-- Emails are stored trimmed and lower-case, so the UNIQUE index really means "one account per
-- email address", whatever capitalisation people type
ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase" CHECK ("email" = lower(btrim("email")));
-- Only real Argon2id hashes, never a plain password stored by mistake
ALTER TABLE "users" ADD CONSTRAINT "users_password_is_argon2id" CHECK ("password_hash" LIKE '$argon2id$%');
