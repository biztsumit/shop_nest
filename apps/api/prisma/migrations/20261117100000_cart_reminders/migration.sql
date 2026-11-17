-- AlterTable
ALTER TABLE "users" ADD COLUMN     "cart_reminded_at" TIMESTAMPTZ(3),
ADD COLUMN     "cart_reminders" BOOLEAN NOT NULL DEFAULT true;

