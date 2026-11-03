-- AlterTable
ALTER TABLE "products" ADD COLUMN     "rating_avg" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "rating_count" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "products_status_rating_avg_id_idx" ON "products"("status", "rating_avg" DESC, "id" DESC);

-- ---------- Added by hand: keep products.rating_avg and products.rating_count up to date ----------
-- Like refresh_product_summary (migration *_catalog_listing) does for price and stock: whenever
-- a review is written, changed, hidden or deleted, its product's stars are recalculated. Hidden
-- reviews don't count, the same rule as the product page's rating summary.
CREATE FUNCTION refresh_product_rating() RETURNS trigger AS $$
BEGIN
  UPDATE products p
  SET rating_avg = COALESCE((SELECT AVG(r.rating) FROM reviews r WHERE r.product_id = p.id AND NOT r.hidden), 0),
      rating_count = (SELECT COUNT(*) FROM reviews r WHERE r.product_id = p.id AND NOT r.hidden)
  WHERE p.id IN (NEW.product_id, OLD.product_id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER reviews_refresh_product_rating
AFTER INSERT OR DELETE OR UPDATE OF rating, hidden, product_id ON reviews
FOR EACH ROW EXECUTE FUNCTION refresh_product_rating();

-- Products that already have reviews get their stars now
UPDATE products p
SET rating_avg = COALESCE((SELECT AVG(r.rating) FROM reviews r WHERE r.product_id = p.id AND NOT r.hidden), 0),
    rating_count = (SELECT COUNT(*) FROM reviews r WHERE r.product_id = p.id AND NOT r.hidden);
