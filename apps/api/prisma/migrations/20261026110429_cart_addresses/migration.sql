-- CreateTable
CREATE TABLE "cart_items" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addresses" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "full_name" VARCHAR(100) NOT NULL,
    "phone" VARCHAR(10) NOT NULL,
    "line1" VARCHAR(200) NOT NULL,
    "line2" VARCHAR(200) NOT NULL DEFAULT '',
    "city" VARCHAR(100) NOT NULL,
    "state" VARCHAR(60) NOT NULL,
    "pincode" CHAR(6) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cart_items_variant_id_idx" ON "cart_items"("variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "cart_items_user_id_variant_id_key" ON "cart_items"("user_id", "variant_id");

-- CreateIndex
CREATE INDEX "addresses_user_id_idx" ON "addresses"("user_id");

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------- Written by hand: rules Prisma can't express ----------

-- The same limits as the shared zod schemas (MAX_QUANTITY)
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_quantity_range" CHECK (quantity BETWEEN 1 AND 10);

-- Stored normalised: 10 digits starting 6-9, no +91; 6-digit PIN not starting with 0
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_phone_format" CHECK (phone ~ '^[6-9][0-9]{9}$');
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_pincode_format" CHECK (pincode ~ '^[1-9][0-9]{5}$');

-- A PARTIAL unique index: unique only among the rows matching WHERE. So a user can have many
-- addresses, but only one of them with is_default = true.
CREATE UNIQUE INDEX "addresses_one_default_per_user" ON "addresses" ("user_id") WHERE is_default;
