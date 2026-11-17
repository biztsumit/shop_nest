-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('ONLINE', 'COD');

-- AlterEnum
ALTER TYPE "order_status" ADD VALUE 'CONFIRMED' BEFORE 'PAID';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "cod_fee" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "payment_method" "payment_method" NOT NULL DEFAULT 'ONLINE';


-- ---------- Added by hand ----------

-- The total now includes the cash-on-delivery fee (replaces the rule from *_orders)
ALTER TABLE "orders" DROP CONSTRAINT "orders_total_adds_up";
ALTER TABLE "orders" ADD CONSTRAINT "orders_total_adds_up"
  CHECK (total = subtotal - discount + shipping_fee + cod_fee);
-- Only orders paid on delivery carry the fee
ALTER TABLE "orders" ADD CONSTRAINT "orders_cod_fee_only_for_cod"
  CHECK (cod_fee >= 0 AND (payment_method = 'COD' OR cod_fee = 0));
