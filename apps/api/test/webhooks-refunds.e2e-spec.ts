import type { NestExpressApplication } from '@nestjs/platform-express';
import { orderSchema, problemSchema, refundSchema, startPaymentSchema } from '@shop/shared';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { EmailService } from '../src/email/email.service.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { PaymentsService } from '../src/payments/payments.service.js';
import { createTestApp } from './support/create-app.js';
import { createTestPrisma, resetDatabase } from './support/database.js';
import { clearOutbox, waitForEmail } from './support/emails.js';
import { fakeRazorpay, signWebhook } from './support/razorpay.js';
import { signUp, stockOf, variantOf } from './support/shopper.js';

describe('Webhooks, reconciliation and refunds (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;

  // An order with a started payment (a Razorpay order exists), not paid yet
  const orderAwaitingPayment = async (name = 'Riya') => {
    const shopper = await signUp(app, name);
    const address = await shopper.addAddress();
    const variantId = await variantOf(prisma, `tee-${name.toLowerCase()}`, { price: 49900, stock: 5 });
    await shopper.as('post', '/cart/items', { variantId, quantity: 2 }).expect(200);
    const order = orderSchema.parse((await shopper.as('post', '/orders', { addressId: address.id }, { 'Idempotency-Key': randomUUID() }).expect(201)).body);
    const started = startPaymentSchema.parse((await shopper.as('post', `/orders/${order.number}/payment`).expect(200)).body);
    const current = async () => orderSchema.parse((await shopper.as('get', `/orders/${order.number}`)).body);
    return { ...shopper, order, variantId, razorpayOrderId: started.razorpayOrderId, current };
  };

  // A paid order (paid through the browser flow)
  const paidOrder = async (name = 'Riya') => {
    const o = await orderAwaitingPayment(name);
    const { payment, signature } = await fakeRazorpay.pay(o.razorpayOrderId);
    await o.as('post', `/orders/${o.order.number}/payment/verify`, { razorpayOrderId: o.razorpayOrderId, razorpayPaymentId: payment.id, razorpaySignature: signature }).expect(200);
    return o;
  };

  const sendWebhook = (event: object, opts: { eventId?: string; signature?: string; body?: string } = {}) => {
    const body = opts.body ?? JSON.stringify(event);
    return request(app.getHttpServer())
      .post('/api/webhooks/razorpay')
      .set('content-type', 'application/json')
      .set('x-razorpay-signature', opts.signature ?? signWebhook(body))
      .set('x-razorpay-event-id', opts.eventId ?? `evt_${randomUUID().replace(/-/g, '')}`)
      .send(body);
  };
  const capturedEvent = (paymentId: string, orderId: string) => ({ event: 'payment.captured', payload: { payment: { entity: { id: paymentId, order_id: orderId } } } });

  const admin = async () => {
    const a = await signUp(app, 'Admin');
    await prisma.user.update({ where: { id: a.user.id }, data: { role: 'ADMIN' } });
    return a;
  };
  const confirmations = () => app.get(EmailService).outbox.filter((m) => m.subject.endsWith('confirmed'));

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

  describe('webhook', () => {
    it('payment.captured pays the order even if the browser never came back; repeats are ignored', async () => {
      const riya = await orderAwaitingPayment();
      const { payment } = await fakeRazorpay.pay(riya.razorpayOrderId);   // ...and the tab was closed
      const event = capturedEvent(payment.id, riya.razorpayOrderId);

      await sendWebhook(event, { eventId: 'evt_first0001' }).expect(200);
      expect((await riya.current()).status).toBe('PAID');
      await waitForEmail(app, (m) => m.subject === `Order ${riya.order.number} confirmed`);
      expect(await prisma.webhookEvent.findUniqueOrThrow({ where: { id: 'evt_first0001' } })).toMatchObject({ type: 'payment.captured', processedAt: expect.any(Date) });

      // Razorpay delivers the same event again, and a second event about the same payment
      await sendWebhook(event, { eventId: 'evt_first0001' }).expect(200);
      await sendWebhook({ ...event, event: 'order.paid' }).expect(200);
      await new Promise((r) => setTimeout(r, 300));
      expect(confirmations()).toHaveLength(1);
    });

    it('refuses a bad signature, or a body changed after signing', async () => {
      const riya = await orderAwaitingPayment();
      const { payment } = await fakeRazorpay.pay(riya.razorpayOrderId);
      const body = JSON.stringify(capturedEvent(payment.id, riya.razorpayOrderId));

      await sendWebhook({}, { body, signature: signWebhook(body, 'not-the-webhook-secret') }).expect(400);
      await sendWebhook({}, { body: body.replace('payment.captured', 'payment.failed'), signature: signWebhook(body) }).expect(400);
      // One space different from what was signed: also refused (that's why the RAW body is kept)
      await sendWebhook({}, { body: `${body} `, signature: signWebhook(body) }).expect(400);
      await request(app.getHttpServer()).post('/api/webhooks/razorpay').send(body).expect(400);
      expect((await riya.current()).status).toBe('PENDING_PAYMENT');
      expect(await prisma.webhookEvent.count()).toBe(0);
    });

    it("acknowledges events that aren't about our orders, and events it doesn't handle", async () => {
      await sendWebhook(capturedEvent('pay_unknown01', 'order_unknown01')).expect(200);
      await sendWebhook({ event: 'subscription.charged', payload: {} }).expect(200);
    });

    it('refund.processed confirms a refund that was still pending', async () => {
      const riya = await paidOrder();
      const boss = await admin();
      const refund = refundSchema.parse((await boss.as('post', `/admin/orders/${riya.order.number}/refunds`, { amount: 10000, reason: 'Damaged box' }).expect(201)).body);
      const row = await prisma.refund.update({ where: { id: refund.id }, data: { status: 'PENDING' } });
      await sendWebhook({ event: 'refund.processed', payload: { refund: { entity: { id: row.providerRefundId } } } }).expect(200);
      expect((await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } })).status).toBe('PROCESSED');
    });
  });

  describe('reconciliation', () => {
    it('settles payments nobody told us about, after a grace period', async () => {
      const riya = await orderAwaitingPayment();
      await fakeRazorpay.pay(riya.razorpayOrderId);   // paid; no verify, no webhook
      const payments = app.get(PaymentsService);

      expect(await payments.reconcile()).toBe(0);   // too fresh: the browser or webhook may still come
      expect(await payments.reconcile(new Date(Date.now() + 3 * 60_000))).toBe(1);
      expect((await riya.current()).status).toBe('PAID');
      expect(await payments.reconcile(new Date(Date.now() + 4 * 60_000))).toBe(0);   // nothing left
    });

    it('a failed attempt is left alone; a later successful one is found', async () => {
      const riya = await orderAwaitingPayment();
      await fakeRazorpay.pay(riya.razorpayOrderId, 'failed');
      const payments = app.get(PaymentsService);
      const later = new Date(Date.now() + 3 * 60_000);
      expect(await payments.reconcile(later)).toBe(0);
      await fakeRazorpay.pay(riya.razorpayOrderId, 'captured');
      expect(await payments.reconcile(later)).toBe(1);
      expect((await riya.current()).status).toBe('PAID');
    });
  });

  describe('admin refunds', () => {
    it('part, then the rest: the order becomes REFUNDED; never more than was paid', async () => {
      const riya = await paidOrder();
      const boss = await admin();
      const refunds = `/admin/orders/${riya.order.number}/refunds`;
      const total = riya.order.total;   // two tees (₹998) + ₹49 delivery

      const part = refundSchema.parse((await boss.as('post', refunds, { amount: 20000, reason: 'Late delivery' }).expect(201)).body);
      expect(part).toMatchObject({ amount: 20000, status: 'PROCESSED' });
      expect((await riya.current()).status).toBe('PAID');
      expect(await prisma.payment.findFirstOrThrow()).toMatchObject({ status: 'PARTIALLY_REFUNDED', refundedAmount: 20000 });

      const tooMuch = await boss.as('post', refunds, { amount: total, reason: 'Oops' }).expect(422);
      expect(problemSchema.parse(tooMuch.body).detail).toMatch(/At most ₹/);

      const rest = refundSchema.parse((await boss.as('post', refunds, { reason: 'Customer returned it' }).expect(201)).body);
      expect(rest.amount).toBe(total - 20000);
      expect((await riya.current()).status).toBe('REFUNDED');
      expect((await fakeRazorpay.payments())[0]).toMatchObject({ amount_refunded: total, status: 'refunded' });
      await boss.as('post', refunds, { reason: 'again' }).expect(409);

      expect(refundSchema.array().parse((await boss.as('get', refunds).expect(200)).body)).toHaveLength(2);
      await waitForEmail(app, (m) => m.subject === `Refund for order ${riya.order.number}` && m.text.includes('₹200'));
    });

    it('restock only with a full refund, and it puts the items back', async () => {
      const riya = await paidOrder();
      const boss = await admin();
      const refunds = `/admin/orders/${riya.order.number}/refunds`;
      expect(await stockOf(prisma, riya.variantId)).toBe(3);
      await boss.as('post', refunds, { amount: 1000, reason: 'x', restock: true }).expect(422);
      await boss.as('post', refunds, { reason: 'Returned unopened', restock: true }).expect(201);
      expect(await stockOf(prisma, riya.variantId)).toBe(5);
    });

    // Made deterministic: the test itself LOCKS the payment row first, both refunds start while
    // it's held, then it lets go. With the service's FOR UPDATE, both queue at the lock and the
    // second sees nothing left (409). Without it, both would read "full amount remaining".
    it('two admins refunding in full at the same moment: one refund happens', async () => {
      const riya = await paidOrder();
      const boss = await admin();
      const refunds = `/admin/orders/${riya.order.number}/refunds`;
      const payment = await prisma.payment.findFirstOrThrow();

      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      let locked = false;
      const blocker = prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM payments WHERE id = ${payment.id}::uuid FOR UPDATE`;
        locked = true;
        await held;
      }, { timeout: 20_000 });
      while (!locked) await new Promise((r) => setTimeout(r, 10));

      // .then() starts a supertest request
      const both = Promise.all([boss.as('post', refunds, { reason: 'one' }).then((r) => r), boss.as('post', refunds, { reason: 'two' }).then((r) => r)]);
      await new Promise((r) => setTimeout(r, 500));   // both are now waiting at the lock
      release();
      await blocker;
      const [a, b] = await both;
      expect([a.status, b.status].sort((x, y) => x - y)).toEqual([201, 409]);
      expect((await fakeRazorpay.payments())[0]!.amount_refunded).toBe(riya.order.total);
    });

    it('Razorpay refuses: 502, and the reserved amount is released', async () => {
      const riya = await paidOrder();
      const boss = await admin();
      await fakeRazorpay.setDown(true);
      await boss.as('post', `/admin/orders/${riya.order.number}/refunds`, { reason: 'x' }).expect(502);
      expect(await prisma.payment.findFirstOrThrow()).toMatchObject({ refundedAmount: 0, status: 'CAPTURED' });
      expect((await prisma.refund.findFirstOrThrow()).status).toBe('FAILED');
      await fakeRazorpay.setDown(false);
      await boss.as('post', `/admin/orders/${riya.order.number}/refunds`, { reason: 'x' }).expect(201);
    });

    it('admins only; unpaid orders have nothing to refund', async () => {
      const riya = await orderAwaitingPayment();
      await riya.as('post', `/admin/orders/${riya.order.number}/refunds`, { reason: 'me' }).expect(403);
      const boss = await admin();
      await boss.as('post', `/admin/orders/${riya.order.number}/refunds`, { reason: 'x' }).expect(409);
    });
  });
});
