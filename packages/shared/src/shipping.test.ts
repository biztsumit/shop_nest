import { describe, expect, it } from "vitest";
import { bookShipmentSchema, normaliseShipmentStatus, parseCourierTime, shipmentPhase, shipOrderSchema } from "./shipping.js";

describe("shipmentPhase", () => {
  it("reads Shiprocket's status names, however they're written", () => {
    expect(shipmentPhase("In Transit")).toBe("moving");
    expect(shipmentPhase("PICKED UP")).toBe("moving");
    expect(shipmentPhase("Delivered")).toBe("delivered");
    expect(shipmentPhase("RTO DELIVERED")).toBe("returned");   // not "delivered"
    expect(shipmentPhase("RTO Initiated")).toBe("moving");
    expect(shipmentPhase("Cancelled")).toBe("cancelled");
    expect(shipmentPhase("PICKUP SCHEDULED")).toBe("other");
  });

  it("falls back to the numeric id for names it doesn't know", () => {
    expect(shipmentPhase("SOMETHING NEW", 7)).toBe("delivered");
    expect(shipmentPhase("SOMETHING NEW", 999)).toBe("other");
  });

  it("normalises spacing and spelling", () => {
    expect(normaliseShipmentStatus("  out_for  delivery ")).toBe("OUT FOR DELIVERY");
  });
});

describe("parseCourierTime", () => {
  it("reads both formats as India time", () => {
    expect(parseCourierTime("2026-11-18 14:05:09")?.toISOString()).toBe("2026-11-18T08:35:09.000Z");
    expect(parseCourierTime("18 11 2026 14:05:09")?.toISOString()).toBe("2026-11-18T08:35:09.000Z");
    expect(parseCourierTime("2026-11-18 14:05")?.toISOString()).toBe("2026-11-18T08:35:00.000Z");
  });

  it("gives null for anything else", () => {
    expect(parseCourierTime("yesterday")).toBeNull();
    expect(parseCourierTime("2026-13-01 10:00:00")).toBeNull();
    expect(parseCourierTime(null)).toBeNull();
  });
});

describe("shipping forms", () => {
  it("wants both the courier and the tracking number, or neither", () => {
    expect(shipOrderSchema.parse({})).toEqual({ courierName: "", trackingNumber: "" });
    expect(shipOrderSchema.parse({ courierName: "India Post", trackingNumber: "EE123456789IN" }).trackingNumber).toBe("EE123456789IN");
    expect(shipOrderSchema.safeParse({ courierName: "India Post" }).success).toBe(false);
  });

  it("keeps parcel sizes sensible", () => {
    expect(bookShipmentSchema.safeParse({ weightGrams: 500, lengthCm: 30, breadthCm: 25, heightCm: 5 }).success).toBe(true);
    expect(bookShipmentSchema.safeParse({ weightGrams: 0, lengthCm: 30, breadthCm: 25, heightCm: 5 }).success).toBe(false);
  });
});
