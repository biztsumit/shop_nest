-- CreateTable
CREATE TABLE "stock_alerts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notified_at" TIMESTAMPTZ(3),

    CONSTRAINT "stock_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_alerts_notified_at_variant_id_idx" ON "stock_alerts"("notified_at", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_alerts_user_id_variant_id_key" ON "stock_alerts"("user_id", "variant_id");

-- AddForeignKey
ALTER TABLE "stock_alerts" ADD CONSTRAINT "stock_alerts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_alerts" ADD CONSTRAINT "stock_alerts_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

