import { z } from "zod";

// ---------- Shipments ----------

// SHIPROCKET: booked through Shiprocket's API (tracking arrives by webhook).
// MANUAL: sent some other way; the admin typed the courier and tracking number.
export const shipmentProviderSchema = z.enum(["SHIPROCKET", "MANUAL"]);

// One line of a parcel's journey, as the courier reported it
export const shipmentEventSchema = z.object({
  status: z.string(),     // "IN TRANSIT"
  activity: z.string(),   // "Shipment arrived at Pune hub"
  location: z.string(),   // "" when the courier didn't say
  at: z.string(),
});

// The order's parcel (null until one is booked or shipped)
export const shipmentSchema = z.object({
  provider: shipmentProviderSchema,
  courierName: z.string().nullable(),
  awb: z.string().nullable(),          // the courier's tracking number
  trackingUrl: z.string().nullable(),  // a page where anyone with the link can follow it
  status: z.string(),                  // the courier's latest word: "PICKED UP", "DELIVERED"
  statusAt: z.string(),
  events: z.array(shipmentEventSchema), // newest first
});

// What admins see too: the label to stick on the parcel, and whether a pickup was requested
export const adminShipmentSchema = shipmentSchema.extend({
  labelUrl: z.string().nullable(),
  pickupRequestedAt: z.string().nullable(),
});

// POST /api/admin/orders/:number/shipment: the parcel's size, which the courier charges by
const dimension = (label: string) => z.number().int(`${label} must be whole centimetres`).min(1).max(200);
export const bookShipmentSchema = z.object({
  weightGrams: z.number().int("must be whole grams").min(10).max(50_000),
  lengthCm: dimension("length"),
  breadthCm: dimension("breadth"),
  heightCm: dimension("height"),
});

// A typical clothing parcel: what the booking form starts with
export const DEFAULT_PACKAGE: BookShipment = { weightGrams: 500, lengthCm: 30, breadthCm: 25, heightCm: 5 };

// POST /api/admin/orders/:number/ship, when it went with a courier outside Shiprocket: both or
// neither (no body at all = neither)
export const shipOrderSchema = z.preprocess((body) => body ?? {}, z
  .object({
    courierName: z.string().trim().max(100).default(""),
    trackingNumber: z.string().trim().regex(/^[\w-]{0,40}$/, "must be letters, digits or - (up to 40)").default(""),
  })
  .refine((s) => Boolean(s.courierName) === Boolean(s.trackingNumber), { path: ["trackingNumber"], message: "Give both the courier and the tracking number, or neither" }));

// ---------- What a courier status means for the order ----------

// moving: picked up and on its way (the order is SHIPPED) · delivered · returned: came back to
// the shop (RTO = "return to origin") · cancelled: the booking was called off before pickup ·
// other: nothing changes (e.g. "PICKUP SCHEDULED")
export type ShipmentPhase = "moving" | "delivered" | "returned" | "cancelled" | "other";

// Shiprocket's status names (shipment_status / sr-status-label), in capitals
const PHASES: Record<string, ShipmentPhase> = {
  "PICKED UP": "moving",
  SHIPPED: "moving",
  "IN TRANSIT": "moving",
  "REACHED AT DESTINATION HUB": "moving",
  "REACHED DESTINATION HUB": "moving",
  "OUT FOR DELIVERY": "moving",
  UNDELIVERED: "moving",       // a failed attempt: the courier tries again
  DELAYED: "moving",
  MISROUTED: "moving",
  "RTO INITIATED": "moving",   // on its way BACK: still out there until it arrives
  "RTO IN TRANSIT": "moving",
  DELIVERED: "delivered",
  "RTO DELIVERED": "returned",
  CANCELED: "cancelled",
};

// Shiprocket's numeric shipment status ids, used when a name isn't one we know
const PHASES_BY_ID: Record<number, ShipmentPhase> = {
  6: "moving", 17: "moving", 18: "moving", 38: "moving", 42: "moving", 9: "moving",
  7: "delivered", 10: "returned", 8: "cancelled",
};

// "In Transit", "in  transit" → "IN TRANSIT"; "CANCELLED" → "CANCELED" (couriers spell it both ways)
export const normaliseShipmentStatus = (status: string): string =>
  status.trim().toUpperCase().replace(/[\s_]+/g, " ").replace("CANCELLED", "CANCELED");

export const shipmentPhase = (status: string, statusId?: number | null): ShipmentPhase =>
  PHASES[normaliseShipmentStatus(status)] ?? (statusId != null ? PHASES_BY_ID[statusId] : undefined) ?? "other";

// Couriers write times in India time without a zone, as "2026-11-18 14:05:09" or
// "18 11 2026 14:05:09". null = unreadable.
export const parseCourierTime = (value: string | null | undefined): Date | null => {
  const text = value?.trim() ?? "";
  const ymd = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  const dmy = text.match(/^(\d{2}) (\d{2}) (\d{4}) (\d{2}):(\d{2})(?::(\d{2}))?$/);
  const parts = ymd ? [ymd[1], ymd[2], ymd[3], ymd[4], ymd[5], ymd[6]] : dmy ? [dmy[3], dmy[2], dmy[1], dmy[4], dmy[5], dmy[6]] : null;
  if (!parts) return null;
  const [y, mo, d, h, mi, s] = parts.map((p) => Number(p ?? 0)) as [number, number, number, number, number, number];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  return new Date(Date.UTC(y, mo - 1, d, h, mi, s) - 5.5 * 60 * 60 * 1000);
};

export type ShipmentEvent = z.infer<typeof shipmentEventSchema>;
export type Shipment = z.infer<typeof shipmentSchema>;
export type AdminShipment = z.infer<typeof adminShipmentSchema>;
export type BookShipment = z.infer<typeof bookShipmentSchema>;
export type ShipOrder = z.infer<typeof shipOrderSchema>;
