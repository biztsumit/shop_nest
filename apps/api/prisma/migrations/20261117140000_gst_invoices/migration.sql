-- AlterTable
ALTER TABLE "products" ADD COLUMN     "gst_rate" INTEGER NOT NULL DEFAULT 18,
ADD COLUMN     "hsn_code" VARCHAR(8) NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "gst_rate" INTEGER NOT NULL DEFAULT 18,
ADD COLUMN     "hsn_code" VARCHAR(8) NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "number" VARCHAR(16) NOT NULL,
    "financial_year" CHAR(7) NOT NULL,
    "serial" INTEGER NOT NULL,
    "issued_at" TIMESTAMPTZ(3) NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_counters" (
    "financial_year" CHAR(7) NOT NULL,
    "last" INTEGER NOT NULL,

    CONSTRAINT "invoice_counters_pkey" PRIMARY KEY ("financial_year")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoices_order_id_key" ON "invoices"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_financial_year_serial_key" ON "invoices"("financial_year", "serial");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ---------- Added by hand ----------

-- The same rules as gstRateSchema and hsnCodeSchema in @shop/shared
ALTER TABLE "products" ADD CONSTRAINT "products_gst_rate_known" CHECK (gst_rate IN (0, 3, 5, 12, 18, 28, 40));
ALTER TABLE "products" ADD CONSTRAINT "products_hsn_code_format" CHECK (hsn_code ~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})?$');
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_gst_rate_known" CHECK (gst_rate IN (0, 3, 5, 12, 18, 28, 40));

-- Orders placed before this change: copy the codes from their products (where the variant
-- still exists; otherwise the defaults stay)
UPDATE "order_items" oi SET "hsn_code" = p."hsn_code", "gst_rate" = p."gst_rate"
FROM "product_variants" v JOIN "products" p ON p."id" = v."product_id"
WHERE v."id" = oi."variant_id";

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_serial_positive" CHECK (serial > 0);
ALTER TABLE "invoice_counters" ADD CONSTRAINT "invoice_counters_last_positive" CHECK (last > 0);

-- APPEND-ONLY, like the audit log: an issued invoice is a tax record. It is never edited or
-- deleted (a refund will get its own credit note). TRUNCATE (the tests) doesn't run row triggers.
CREATE FUNCTION invoices_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'invoices are append-only: an issued invoice is never changed or deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invoices_no_update_or_delete
BEFORE UPDATE OR DELETE ON "invoices"
FOR EACH ROW EXECUTE FUNCTION invoices_append_only();
