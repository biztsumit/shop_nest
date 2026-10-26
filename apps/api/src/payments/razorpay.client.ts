import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Env } from '../config/env.js';

// The parts of Razorpay's answers we use (they send more)
export type RazorpayOrder = { id: string; amount: number; currency: string; receipt: string; status: string };
export type RazorpayPayment = {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: 'created' | 'authorized' | 'captured' | 'refunded' | 'failed';
  method: string;
  amount_refunded: number;
  error_description?: string | null;
};
export type RazorpayRefund = { id: string; payment_id: string; amount: number; status: 'pending' | 'processed' | 'failed' };

// Talks to Razorpay's REST API (https://razorpay.com/docs/api/) with plain fetch: a handful of
// calls doesn't need their SDK. Authentication is HTTP Basic with key id : key secret.
@Injectable()
export class RazorpayClient {
  private readonly logger = new Logger(RazorpayClient.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  get enabled(): boolean {
    return Boolean(this.config.get('RAZORPAY_KEY_ID', { infer: true }));
  }

  get keyId(): string {
    return this.requireKeys().keyId;
  }

  createOrder(amount: number, receipt: string, notes: Record<string, string>): Promise<RazorpayOrder> {
    return this.call('POST', '/v1/orders', { amount, currency: 'INR', receipt, notes });
  }

  fetchPayment(paymentId: string): Promise<RazorpayPayment> {
    return this.call('GET', `/v1/payments/${encodeURIComponent(paymentId)}`);
  }

  // Every attempt at paying one Razorpay order (for reconciling: "did any of them succeed?")
  async paymentsOfOrder(orderId: string): Promise<RazorpayPayment[]> {
    return (await this.call<{ items: RazorpayPayment[] }>('GET', `/v1/orders/${encodeURIComponent(orderId)}/payments`)).items;
  }

  // An "authorized" payment is only a hold on the money; capturing takes it
  capture(paymentId: string, amount: number): Promise<RazorpayPayment> {
    return this.call('POST', `/v1/payments/${encodeURIComponent(paymentId)}/capture`, { amount, currency: 'INR' });
  }

  refund(paymentId: string, amount: number, notes: Record<string, string>): Promise<RazorpayRefund> {
    return this.call('POST', `/v1/payments/${encodeURIComponent(paymentId)}/refund`, { amount, notes });
  }

  // Checkout's proof of payment: HMAC-SHA256 of "order_id|payment_id" with OUR secret. Only
  // Razorpay and we know the secret, so a browser can't make a valid one for a payment that
  // didn't happen.
  isValidPaymentSignature(orderId: string, paymentId: string, signature: string): boolean {
    return safeEqualHex(hmac(this.requireKeys().keySecret, `${orderId}|${paymentId}`), signature);
  }

  // Webhook events are signed the same way, over the raw request body, with the webhook secret
  isValidWebhookSignature(rawBody: Buffer, signature: string): boolean {
    const secret = this.config.get('RAZORPAY_WEBHOOK_SECRET', { infer: true });
    return Boolean(secret) && safeEqualHex(hmac(secret!, rawBody), signature);
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: object): Promise<T> {
    const { keyId, keySecret } = this.requireKeys();
    let res: Response;
    try {
      res = await fetch(new URL(path, this.config.get('RAZORPAY_API_URL', { infer: true })), {
        method,
        headers: {
          authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        // Never let a slow payment provider hold a shopper's request forever
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      this.logger.error({ err, method, path }, 'Razorpay unreachable');
      throw new BadGatewayException("The payment service isn't responding. Please try again in a moment.");
    }
    const data = (await res.json().catch(() => ({}))) as T & { error?: { description?: string } };
    if (!res.ok) {
      // Their message is for us (logs), not for shoppers
      this.logger.error({ status: res.status, method, path, error: data.error?.description }, 'Razorpay refused a request');
      throw new BadGatewayException('The payment service refused the request. Please try again, or contact us.');
    }
    return data;
  }

  private requireKeys(): { keyId: string; keySecret: string } {
    const keyId = this.config.get('RAZORPAY_KEY_ID', { infer: true });
    const keySecret = this.config.get('RAZORPAY_KEY_SECRET', { infer: true });
    if (!keyId || !keySecret) {
      throw new ServiceUnavailableException("Online payment isn't set up on this shop yet.");
    }
    return { keyId, keySecret };
  }
}

const hmac = (secret: string, data: string | Buffer): string => createHmac('sha256', secret).update(data).digest('hex');

// Compares in CONSTANT time: `a === b` stops at the first different character, and measuring
// how long that takes can reveal, character by character, what a valid signature looks like
const safeEqualHex = (expected: string, given: string): boolean => {
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(given, 'hex');
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
};
