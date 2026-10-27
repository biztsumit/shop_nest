import { startPaymentSchema } from "@shop/shared";
import { api, ApiRequestError } from "./client-api";
import { payWithRazorpay, PaymentCancelled } from "./razorpay";
import { site } from "./site";

export type PayOutcome = "paid" | "cancelled" | "unavailable";

// Paying for a placed order, start to finish: start (our API) → Checkout window (Razorpay) →
// verify (our API). Used by checkout and by "Pay now" on the order page.
export const payOrder = async (number: string): Promise<PayOutcome> => {
  let details;
  try {
    details = startPaymentSchema.parse(await api(`/orders/${number}/payment`, { method: "POST" }));
  } catch (err) {
    // 503: the shop has no Razorpay keys yet. The order is placed; it just can't be paid online.
    if (err instanceof ApiRequestError && err.status === 503) return "unavailable";
    throw err;
  }
  try {
    const receipt = await payWithRazorpay(details, site.name);
    await api(`/orders/${number}/payment/verify`, { method: "POST", body: receipt });
    return "paid";
  } catch (err) {
    if (err instanceof PaymentCancelled) return "cancelled";
    throw err;
  }
};
