import { z } from "zod";

// BACK-IN-STOCK ALERTS: "email me when this size is back"
//   PUT    /api/stock-alerts/:variantId   start waiting (only for a sold-out variant)
//   DELETE /api/stock-alerts/:variantId   stop waiting
//   GET    /api/stock-alerts/ids          the variants this shopper is waiting for

// Enough for anyone; stops one account from filling the table
export const MAX_STOCK_ALERTS = 50;

export const stockAlertIdsSchema = z.array(z.uuid());
