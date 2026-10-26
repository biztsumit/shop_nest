import { createHmac } from 'node:crypto';
import { FAKE_RAZORPAY_PORT, FAKE_WEBHOOK_SECRET } from './fake-razorpay.js';

// Drives the fake Razorpay server (started by global-setup.ts) from a test
const control = async <T>(path: string, body: object = {}): Promise<T> => {
  const res = await fetch(`http://127.0.0.1:${FAKE_RAZORPAY_PORT}/__fake/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`fake razorpay ${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
};

export type FakePayment = { id: string; order_id: string; amount: number; status: string };

export const fakeRazorpay = {
  reset: () => control('reset'),
  setDown: (down: boolean) => control('down', { down }),
  // The shopper completes (or fails) a payment in the Checkout popup
  pay: (orderId: string, status: 'captured' | 'authorized' | 'failed' = 'captured', amount?: number) =>
    control<{ payment: FakePayment; signature: string }>('pay', { order_id: orderId, status, amount }),
  payments: async () => (await fetch(`http://127.0.0.1:${FAKE_RAZORPAY_PORT}/__fake/payments`, { method: 'POST' }).then((r) => r.json())) as Array<FakePayment & { amount_refunded: number }>,
};

// A webhook body signed the way Razorpay signs it (HMAC-SHA256 of the raw body, webhook secret)
export const signWebhook = (body: string, secret = FAKE_WEBHOOK_SECRET): string => createHmac('sha256', secret).update(body).digest('hex');
