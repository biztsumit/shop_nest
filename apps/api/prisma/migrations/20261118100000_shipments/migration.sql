-- 11.5 Shipping: parcels booked with Shiprocket (or sent another way), and their journey

CREATE TYPE "shipment_provider" AS ENUM ('SHIPROCKET', 'MANUAL');

CREATE TABLE "shipments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "provider" "shipment_provider" NOT NULL,
    "provider_order_id" VARCHAR(30),
    "provider_shipment_id" VARCHAR(30),
    "awb" VARCHAR(40),
    "courier_name" VARCHAR(100),
    "tracking_url" VARCHAR(300),
    "label_url" VARCHAR(500),
    "status" VARCHAR(60) NOT NULL,
    "status_at" TIMESTAMPTZ(3) NOT NULL,
    "pickup_requested_at" TIMESTAMPTZ(3),
    "checked_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id"),
    -- A manual shipment always has its courier and tracking number
    CONSTRAINT "shipments_manual_has_tracking" CHECK ("provider" <> 'MANUAL' OR ("awb" IS NOT NULL AND "courier_name" IS NOT NULL))
);

CREATE TABLE "shipment_events" (
    "id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "status" VARCHAR(60) NOT NULL,
    "activity" VARCHAR(300) NOT NULL,
    "location" VARCHAR(150) NOT NULL DEFAULT '',
    "at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "shipments_order_id_idx" ON "shipments"("order_id");
CREATE INDEX "shipments_awb_idx" ON "shipments"("awb");
CREATE UNIQUE INDEX "shipment_events_shipment_id_at_status_key" ON "shipment_events"("shipment_id", "at", "status");

-- At most ONE active (not cancelled) shipment per order: a second booking of the same order
-- fails here, whichever server or click it comes from. (A PARTIAL index: Prisma can't describe
-- these, so it lives only in this migration.)
CREATE UNIQUE INDEX "shipments_one_active_per_order" ON "shipments"("order_id") WHERE "cancelled_at" IS NULL;

ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
