-- Written by hand: the counter behind order numbers (SN000001, SN000002...). Created first: the
-- orders table uses it. Sequences never roll back, so a failed order leaves a gap in the
-- numbers; that is normal and harmless.
CREATE SEQUENCE "order_number_seq";

-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('PENDING_PAYMENT', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'EXPIRED', 'REFUNDED');

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "number" VARCHAR(20) NOT NULL DEFAULT ('SN'::text || lpad((nextval('order_number_seq'::regclass))::text, 6, '0'::text)),
    "user_id" UUID NOT NULL,
    "status" "order_status" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "idempotency_key" VARCHAR(100) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "shipping_address" JSONB NOT NULL,
    "subtotal" INTEGER NOT NULL,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "shipping_fee" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "coupon_code" VARCHAR(30),
    "expires_at" TIMESTAMPTZ(3),
    "paid_at" TIMESTAMPTZ(3),
    "shipped_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "variant_id" UUID,
    "product_slug" VARCHAR(220) NOT NULL,
    "product_name" VARCHAR(200) NOT NULL,
    "options" JSONB NOT NULL DEFAULT '{}',
    "sku" VARCHAR(64),
    "image_url" VARCHAR(2000),
    "unit_price" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "line_total" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_number_key" ON "orders"("number");

-- CreateIndex
CREATE INDEX "orders_user_id_id_idx" ON "orders"("user_id", "id" DESC);

-- CreateIndex
CREATE INDEX "orders_status_expires_at_idx" ON "orders"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "orders_user_id_idempotency_key_key" ON "orders"("user_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_items_variant_id_idx" ON "order_items"("variant_id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------- Written by hand: rules Prisma can't express ----------

-- The sequence belongs to the column: dropping the table drops the counter too
ALTER SEQUENCE "order_number_seq" OWNED BY "orders"."number";

-- Money can't go negative, and the parts must add up to what's charged
ALTER TABLE "orders" ADD CONSTRAINT "orders_amounts_not_negative"
  CHECK (subtotal >= 0 AND discount >= 0 AND shipping_fee >= 0 AND total >= 0 AND discount <= subtotal);
ALTER TABLE "orders" ADD CONSTRAINT "orders_total_adds_up"
  CHECK (total = subtotal - discount + shipping_fee);

ALTER TABLE "order_items" ADD CONSTRAINT "order_items_quantity_positive" CHECK (quantity > 0);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_line_total"
  CHECK (unit_price >= 0 AND line_total = unit_price * quantity);
