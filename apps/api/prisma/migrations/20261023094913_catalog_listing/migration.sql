-- Added by hand: trigram matching (used by the search index below). IF NOT EXISTS: a database
-- that already has it (another app, a re-run) is fine.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- DropIndex
DROP INDEX "products_status_category_id_created_at_idx";

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "price" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "stock" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "products_status_id_idx" ON "products"("status", "id" DESC);

-- CreateIndex
CREATE INDEX "products_status_price_id_idx" ON "products"("status", "price", "id");

-- CreateIndex
CREATE INDEX "products_status_name_id_idx" ON "products"("status", "name", "id");

-- CreateIndex
CREATE INDEX "products_category_id_idx" ON "products"("category_id");

-- CreateIndex
CREATE INDEX "products_name_trgm_idx" ON "products" USING GIN ("name" gin_trgm_ops);

-- ---------- Added by hand: keep products.price and products.stock up to date ----------
-- A TRIGGER runs a function automatically when rows change. Whenever a variant is added,
-- changed or deleted, its product's summary is recalculated: price = the lowest variant
-- price, stock = all variants' stock added up. Because the DATABASE does it, the summary can't
-- go stale, whichever code (or person, in psql) changes the variants.
CREATE FUNCTION refresh_product_summary() RETURNS trigger AS $$
BEGIN
  -- NEW is the row after the change (NULL for a DELETE), OLD the row before (NULL for an
  -- INSERT). Both products are refreshed: a variant can even move to another product.
  UPDATE products p
  SET price = COALESCE((SELECT MIN(v.price) FROM product_variants v WHERE v.product_id = p.id), 0),
      stock = COALESCE((SELECT SUM(v.stock) FROM product_variants v WHERE v.product_id = p.id), 0)
  WHERE p.id IN (NEW.product_id, OLD.product_id);
  RETURN NULL;  -- an AFTER trigger's return value is ignored
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER product_variants_refresh_summary
AFTER INSERT OR DELETE OR UPDATE OF price, stock, product_id ON product_variants
FOR EACH ROW EXECUTE FUNCTION refresh_product_summary();

-- Products that already have variants get their summary now
UPDATE products p
SET price = COALESCE((SELECT MIN(v.price) FROM product_variants v WHERE v.product_id = p.id), 0),
    stock = COALESCE((SELECT SUM(v.stock) FROM product_variants v WHERE v.product_id = p.id), 0);
