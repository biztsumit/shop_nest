// Razorpay Checkout: Razorpay's own payment window (UPI, cards, netbanking...). Card details go
// straight to Razorpay, never through our servers.
//
//   1. our API creates a Razorpay order for the amount     (POST /api/orders/:number/payment)
//   2. this file opens Razorpay's window, and resolves with what Razorpay returns
//   3. our API checks Razorpay's SIGNATURE on that result  (POST /api/orders/:number/payment/verify)
// Step 3 matters: the browser can't be trusted to just say "it's paid".
import type { StartPayment, VerifyPayment } from "@shop/shared";

const SCRIPT_URL = "https://checkout.razorpay.com/v1/checkout.js";

// The parts of Razorpay's (untyped) browser library that we use
type RazorpayResponse = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };
type RazorpayInstance = { open: () => void; on: (event: string, handler: (response: unknown) => void) => void };
type RazorpayConstructor = new (options: Record<string, unknown>) => RazorpayInstance;

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}

// Loads Razorpay's script the first time it's needed (not on every page of the shop)
let loading: Promise<RazorpayConstructor> | null = null;

const loadRazorpay = (): Promise<RazorpayConstructor> => {
  loading ??= new Promise((resolve, reject) => {
    if (window.Razorpay) {
      resolve(window.Razorpay);
      return;
    }
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => (window.Razorpay ? resolve(window.Razorpay) : reject(new Error("Razorpay didn't load")));
    script.onerror = () => {
      loading = null;   // allow another try (the connection may come back)
      reject(new Error("Couldn't reach Razorpay. Check your connection and try again."));
    };
    document.body.append(script);
  });
  return loading;
};

// The shopper closed the window: not an error to shout about, the order just stays unpaid
export class PaymentCancelled extends Error {
  constructor() {
    super("Payment cancelled");
  }
}

// Razorpay's window works with callbacks; this turns it into a promise: resolves when the
// shopper has paid, rejects if they close the window or the payment fails
export const payWithRazorpay = async (details: StartPayment, shopName: string): Promise<VerifyPayment> => {
  const Razorpay = await loadRazorpay();
  return new Promise((resolve, reject) => {
    const checkout = new Razorpay({
      key: details.keyId,
      order_id: details.razorpayOrderId,
      amount: details.amount,
      currency: details.currency,
      name: shopName,
      description: `Order ${details.orderNumber}`,
      prefill: details.prefill,
      theme: { color: "#4f46e5" },
      handler: (response: RazorpayResponse) =>
        resolve({
          razorpayOrderId: response.razorpay_order_id,
          razorpayPaymentId: response.razorpay_payment_id,
          razorpaySignature: response.razorpay_signature,
        }),
      modal: { ondismiss: () => reject(new PaymentCancelled()) },
    });
    checkout.on("payment.failed", () => reject(new Error("The payment didn't go through. You can try again.")));
    checkout.open();
  });
};
