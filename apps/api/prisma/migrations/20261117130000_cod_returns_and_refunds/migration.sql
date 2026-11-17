-- AlterEnum
ALTER TYPE "order_status" ADD VALUE 'RETURNED' BEFORE 'CANCELLED';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "returned_at" TIMESTAMPTZ(3);

-- AlterTable (order_id is filled in below before it becomes NOT NULL)
ALTER TABLE "refunds" ADD COLUMN     "order_id" UUID,
ADD COLUMN     "reference" VARCHAR(100),
ALTER COLUMN "payment_id" DROP NOT NULL;

-- ---------- Added by hand ----------

-- Every refund so far was an online one: its order is its payment's order
UPDATE "refunds" r SET "order_id" = p."order_id" FROM "payments" p WHERE p."id" = r."payment_id";
ALTER TABLE "refunds" ALTER COLUMN "order_id" SET NOT NULL;

-- A refund is EITHER online (through Razorpay, against a payment) OR cash on delivery
-- (recorded with a reference to how the shop paid it back), never both or neither
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_online_or_cash"
  CHECK ((payment_id IS NULL) = (reference IS NOT NULL));

-- ---------- Generated ----------

-- CreateIndex
CREATE INDEX "refunds_order_id_idx" ON "refunds"("order_id");

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
