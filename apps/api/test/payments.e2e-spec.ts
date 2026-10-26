import type { NestExpressApplication } from '@nestjs/platform-express';
import { orderSchema, problemSchema, startPaymentSchema, type Order } from '@shop/shared';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { EmailService } from '../src/email/email.service.js';
import { OrdersService } from '../src/orders/orders.service.js';
import { createTestApp } from './support/create-app.js';
import { createTestPrisma, resetDatabase } from './support/database.js';
import { clearOutbox, waitForEmail } from './support/emails.js';
import { FAKE_KEY_ID } from './support/fake-razorpay.js';
import { fakeRazorpay } from './support/razorpay.js';
import { signUp, stockOf, variantOf } from './support/shopper.js';

describe('Payments with Razorpay (e2e, against a fake Razorpay)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;

  // A shopper who has placed an order (not paid yet)
  const placedOrder = async (opts: { stock?: number; quantity?: number } = {}) => {
    const shopper = await signUp(app);
    const address = await shopper.addAddress();
    const variantId = await variantOf(prisma, 'classic-tee', { price: 49900, stock: opts.stock ?? 5 });
    await shopper.as('post', '/cart/items', { variantId, quantity: opts.quantity ?? 1 }).expect(200);
    const order = orderSchema.parse((await shopper.as('post', '/orders', { addressId: address.id }, { 'Idempotency-Key': randomUUID() }).expect(201)).body);
    const pay = (path = '', body?: object) => shopper.as('post', `/orders/${order.number}/payment${path}`, body);
    const current = async (): Promise<Order> => orderSchema.parse((await shopper.as('get', `/orders/${order.number}`)).body);
    return { ...shopper, order, variantId, pay, current };
  };

  // Start paying, "pay" in the fake Checkout, and send the signed receipt to verify
  const payFully = async (shopper: Awaited<ReturnType<typeof placedOrder>>, status: 'captured' | 'authorized' | 'failed' = 'captured') => {
    const started = startPaymentSchema.parse((await shopper.pay().expect(200)).body);
    const { payment, signature } = await fakeRazorpay.pay(started.razorpayOrderId, status);
    return shopper.pay('/verify', { razorpayOrderId: started.razorpayOrderId, razorpayPaymentId: payment.id, razorpaySignature: signature }).expect(200);
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = createTestPrisma();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await fakeRazorpay.reset();
    clearOutbox(app);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('starting a payment gives Checkout what it needs; trying again reuses the same Razorpay order', async () => {
    const riya = await placedOrder();
    const first = startPaymentSchema.parse((await riya.pay().expect(200)).body);
    expect(first).toMatchObject({
      keyId: FAKE_KEY_ID,
      razorpayOrderId: expect.stringMatching(/^order_/),
      amount: riya.order.total,
      currency: 'INR',
      orderNumber: riya.order.number,
      prefill: { name: 'Riya', email: 'riya@example.com', contact: '9876543210' },
    });
    const again = startPaymentSchema.parse((await riya.pay().expect(200)).body);
    expect(again.razorpayOrderId).toBe(first.razorpayOrderId);
    expect(await prisma.payment.count()).toBe(1);
  });

  it('pay → verify: the order is PAID and a confirmation email goes out; verifying again changes nothing', async () => {
    const riya = await placedOrder();
    const started = startPaymentSchema.parse((await riya.pay().expect(200)).body);
    const { payment, signature } = await fakeRazorpay.pay(started.razorpayOrderId);
    const receipt = { razorpayOrderId: started.razorpayOrderId, razorpayPaymentId: payment.id, razorpaySignature: signature };

    const paid = orderSchema.parse((await riya.pay('/verify', receipt).expect(200)).body);
    expect(paid.status).toBe('PAID');
    expect(paid.paidAt).not.toBeNull();
    expect(await prisma.payment.findFirstOrThrow()).toMatchObject({ status: 'CAPTURED', method: 'upi', providerPaymentId: payment.id });

    const email = await waitForEmail(app, (m) => m.subject === `Order ${riya.order.number} confirmed`);
    expect(email.text).toContain('Total paid: ₹548');

    // The browser sends the same receipt again (a retry, a second tab): same answer, and still
    // one confirmation email
    expect(orderSchema.parse((await riya.pay('/verify', receipt).expect(200)).body).status).toBe('PAID');
    await new Promise((r) => setTimeout(r, 300));
    expect(app.get(EmailService).outbox.filter((m) => m.subject.includes('confirmed'))).toHaveLength(1);
  });

  it('a forged or mismatched receipt is refused, and the order stays unpaid', async () => {
    const riya = await placedOrder();
    const started = startPaymentSchema.parse((await riya.pay().expect(200)).body);
    const { payment } = await fakeRazorpay.pay(started.razorpayOrderId);

    const forged = await riya.pay('/verify', { razorpayOrderId: started.razorpayOrderId, razorpayPaymentId: payment.id, razorpaySignature: 'a'.repeat(64) }).expect(400);
    expect(problemSchema.parse(forged.body).detail).toMatch(/couldn't verify/);
    await riya.pay('/verify', { razorpayOrderId: 'order_someoneelse1', razorpayPaymentId: payment.id, razorpaySignature: 'a'.repeat(64) }).expect(400);
    await riya.pay('/verify', { razorpayOrderId: 'nonsense', razorpayPaymentId: payment.id, razorpaySignature: 'x' }).expect(422);
    expect((await riya.current()).status).toBe('PENDING_PAYMENT');
  });

  it('an "authorized" payment (money held) is captured, then the order is paid', async () => {
    const riya = await placedOrder();
    expect(orderSchema.parse((await payFully(riya, 'authorized')).body).status).toBe('PAID');
    expect((await fakeRazorpay.payments())[0]).toMatchObject({ status: 'captured' });
  });

  it('a failed payment leaves the order waiting; the shopper can try again', async () => {
    const riya = await placedOrder();
    expect(orderSchema.parse((await payFully(riya, 'failed')).body).status).toBe('PENDING_PAYMENT');
    expect((await prisma.payment.findFirstOrThrow()).status).toBe('FAILED');
    expect(orderSchema.parse((await payFully(riya)).body).status).toBe('PAID');
  });

  it('paid after the order expired, stock still there: the stock is taken again and the order honoured', async () => {
    const riya = await placedOrder({ stock: 5, quantity: 2 });
    const started = startPaymentSchema.parse((await riya.pay().expect(200)).body);
    await app.get(OrdersService).expireOverdue(new Date(Date.now() + 31 * 60_000));
    expect(await stockOf(prisma, riya.variantId)).toBe(5);

    const { payment, signature } = await fakeRazorpay.pay(started.razorpayOrderId);
    const res = await riya.pay('/verify', { razorpayOrderId: started.razorpayOrderId, razorpayPaymentId: payment.id, razorpaySignature: signature }).expect(200);
    expect(orderSchema.parse(res.body).status).toBe('PAID');
    expect(await stockOf(prisma, riya.variantId)).toBe(3);
  });

  it('paid after the order expired and the stock sold out: refunded automatically, shopper told', async () => {
    const riya = await placedOrder({ stock: 1 });
    const started = startPaymentSchema.parse((await riya.pay().expect(200)).body);
    await app.get(OrdersService).expireOverdue(new Date(Date.now() + 31 * 60_000));
    await prisma.productVariant.update({ where: { id: riya.variantId }, data: { stock: 0 } });   // someone else bought it

    const { payment, signature } = await fakeRazorpay.pay(started.razorpayOrderId);
    const res = await riya.pay('/verify', { razorpayOrderId: started.razorpayOrderId, razorpayPaymentId: payment.id, razorpaySignature: signature }).expect(200);
    expect(orderSchema.parse(res.body).status).toBe('EXPIRED');
    expect(await prisma.payment.findFirstOrThrow()).toMatchObject({ status: 'REFUNDED', refundedAmount: riya.order.total });
    expect((await fakeRazorpay.payments())[0]).toMatchObject({ amount_refunded: riya.order.total, status: 'refunded' });
    await waitForEmail(app, (m) => m.subject === `Refund for order ${riya.order.number}`);
  });

  it("can't pay an order that's cancelled or already paid", async () => {
    const riya = await placedOrder();
    await payFully(riya);
    expect(problemSchema.parse((await riya.pay().expect(409)).body).detail).toBe('This order is already paid.');

    await resetDatabase(prisma);
    const arjun = await placedOrder();
    await arjun.as('post', `/orders/${arjun.order.number}/cancel`).expect(200);
    await arjun.pay().expect(409);
  });

  it('Razorpay down: a clear 502, and nothing is half-saved', async () => {
    const riya = await placedOrder();
    await fakeRazorpay.setDown(true);
    const res = await riya.pay().expect(502);
    expect(problemSchema.parse(res.body).detail).toMatch(/payment service/);
    expect(await prisma.payment.count()).toBe(0);
    await fakeRazorpay.setDown(false);
    await riya.pay().expect(200);
  });

  it("someone else's order: not found", async () => {
    const riya = await placedOrder();
    const arjun = await signUp(app, 'Arjun');
    await arjun.as('post', `/orders/${riya.order.number}/payment`).expect(404);
  });
});
