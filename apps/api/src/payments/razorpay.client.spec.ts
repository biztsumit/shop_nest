import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import type { Env } from '../config/env.js';
import { RazorpayClient } from './razorpay.client.js';

const configWith = (values: Partial<Record<keyof Env, string>>) =>
  ({ get: (key: keyof Env) => values[key] }) as unknown as ConfigService<Env, true>;

const sign = (secret: string, data: string) => createHmac('sha256', secret).update(data).digest('hex');

describe('RazorpayClient', () => {
  const client = new RazorpayClient(configWith({ RAZORPAY_KEY_ID: 'rzp_test_abc', RAZORPAY_KEY_SECRET: 'top-secret', RAZORPAY_WEBHOOK_SECRET: 'hook-secret' }));

  it('accepts the signature Razorpay makes for order|payment', () => {
    expect(client.isValidPaymentSignature('order_1', 'pay_1', sign('top-secret', 'order_1|pay_1'))).toBe(true);
  });

  it('refuses a signature for other ids, another secret, or garbage', () => {
    expect(client.isValidPaymentSignature('order_1', 'pay_2', sign('top-secret', 'order_1|pay_1'))).toBe(false);
    expect(client.isValidPaymentSignature('order_1', 'pay_1', sign('wrong-secret', 'order_1|pay_1'))).toBe(false);
    expect(client.isValidPaymentSignature('order_1', 'pay_1', 'not-hex')).toBe(false);
    expect(client.isValidPaymentSignature('order_1', 'pay_1', '')).toBe(false);
  });

  it('checks webhook signatures over the raw body', () => {
    const body = Buffer.from('{"event":"payment.captured"}');
    expect(client.isValidWebhookSignature(body, sign('hook-secret', body.toString()))).toBe(true);
    expect(client.isValidWebhookSignature(Buffer.from('{"event":"payment.captured" }'), sign('hook-secret', body.toString()))).toBe(false);
  });

  it('without keys: payments are off, with a clear 503', () => {
    const off = new RazorpayClient(configWith({}));
    expect(off.enabled).toBe(false);
    expect(() => off.keyId).toThrow(ServiceUnavailableException);
    expect(off.isValidWebhookSignature(Buffer.from('{}'), sign('', '{}'))).toBe(false);
  });
});
