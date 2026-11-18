import type { NestExpressApplication } from '@nestjs/platform-express';
import { addressSchema, adminOrderSchema, auditEventSchema, orderSchema, pageSchema, problemSchema, startPaymentSchema } from '@shop/shared';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { ShippingService } from '../src/shipping/shipping.service.js';
import { createTestApp } from './support/create-app.js';
import { createTestPrisma, resetDatabase } from './support/database.js';
import { clearOutbox, waitForEmail } from './support/emails.js';
import { FAKE_SHIPROCKET_WEBHOOK_TOKEN, fakeShiprocket } from './support/fake-shiprocket.js';
import { fakeRazorpay } from './support/razorpay.js';
import { signUp, stockOf, variantOf } from './support/shopper.js';

const PARCEL = { weightGrams: 750, lengthCm: 30, breadthCm: 25, heightCm: 6 };

describe('Shipping with Shiprocket (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;

  // A shopper with 2 tees (₹499 each) in the cart
  const shopper = async (name = 'Riya') => {
    const s = await signUp(app, name);
    await prisma.user.update({ where: { id: s.user.id }, data: { emailVerifiedAt: new Date() } });
    const address = addressSchema.parse((await s.as('post', '/addresses', {
      fullName: `${name} Rao`, phone: '9876543210', line1: '4 Lake View', line2: 'Near the park', city: 'Pune', state: 'Maharashtra', pincode: '411001',
    }).expect(201)).body);
    const variantId = await variantOf(prisma, `tee-${name.toLowerCase()}`, { price: 49900, stock: 10 });
    await s.as('post', '/cart/items', { variantId, quantity: 2 }).expect(200);
    const place = async (paymentMethod: 'ONLINE' | 'COD' = 'ONLINE') =>
      orderSchema.parse((await s.as('post', '/orders', { addressId: address.id, paymentMethod }, { 'Idempotency-Key': randomUUID() }).expect(201)).body);
    const placePaid = async () => {
      const order = await place();
      const { razorpayOrderId } = startPaymentSchema.parse((await s.as('post', `/orders/${order.number}/payment`).expect(200)).body);
      const { payment, signature } = await fakeRazorpay.pay(razorpayOrderId);
      await s.as('post', `/orders/${order.number}/payment/verify`, { razorpayOrderId, razorpayPaymentId: payment.id, razorpaySignature: signature }).expect(200);
      return order;
    };
    return { ...s, variantId, place, placePaid };
  };
  const admin = async () => {
    const boss = await signUp(app, 'Meera');
    await prisma.user.update({ where: { id: boss.user.id }, data: { role: 'ADMIN' } });
    return boss;
  };
  const webhook = (body: object, token = FAKE_SHIPROCKET_WEBHOOK_TOKEN) =>
    request(app.getHttpServer()).post('/api/webhooks/courier').set('x-api-key', token).send(body);
  // A webhook the way Shiprocket sends it
  const scan = (awb: string, status: string, date: string, activity = status) => ({
    awb, courier_name: 'Delhivery Surface', current_status: status, shipment_status: status, current_timestamp: date.split(/[- ]/).slice(0, 3).reverse().join(' ') + ' ' + date.split(' ')[1],
    scans: [{ date, status: 'X', activity, location: 'Pune', 'sr-status-label': status }],
  });
  const paths = async () => (await fakeShiprocket.requests()).requests.map((r) => r.path.replace('/v1/external/', ''));

  beforeAll(async () => {
    app = await createTestApp();
    prisma = createTestPrisma();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await fakeRazorpay.reset();
    await fakeShiprocket.reset();
    clearOutbox(app);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('books a paid order: courier, tracking number, label and pickup; once only', async () => {
    const riya = await shopper();
    const order = await riya.placePaid();
    const boss = await admin();

    const booked = adminOrderSchema.parse((await boss.as('post', `/admin/orders/${order.number}/shipment`, PARCEL).expect(200)).body);
    expect(booked.status).toBe('PAID');   // shipped only once the courier picks it up
    expect(booked.shiprocketEnabled).toBe(true);
    expect(booked.shipment).toMatchObject({
      provider: 'SHIPROCKET',
      courierName: 'Delhivery Surface',
      awb: expect.stringMatching(/^7799\d{8}$/),
      status: 'PICKUP SCHEDULED',
      labelUrl: expect.stringMatching(/^https:\/\/labels\.fake\//),
      pickupRequestedAt: expect.any(String),
    });
    expect(booked.shipment!.trackingUrl).toBe(`https://shiprocket.co/tracking/${booked.shipment!.awb}`);

    // What Shiprocket was sent: rupees, kilograms, our order number, the pickup address's nickname
    const { requests, logins } = await fakeShiprocket.requests();
    expect(requests.map((r) => r.path)).toEqual([
      '/v1/external/orders/create/adhoc', '/v1/external/courier/assign/awb', '/v1/external/courier/generate/label', '/v1/external/courier/generate/pickup',
    ]);
    expect(requests[0]!.body).toMatchObject({
      order_id: order.number, pickup_location: 'Primary', payment_method: 'Prepaid',
      billing_customer_name: 'Riya Rao', billing_address_2: 'Near the park', billing_pincode: '411001', billing_phone: '9876543210', billing_email: 'riya@example.com',
      sub_total: 998, shipping_charges: 49, transaction_charges: 0, weight: 0.75, length: 30, breadth: 25, height: 6,
      order_items: [{ name: 'Tee Riya', units: 2, selling_price: 499 }],
    });
    expect(logins).toBe(1);

    // The shopper sees the courier and tracking number, but not the label
    const mine = (await riya.as('get', `/orders/${order.number}`).expect(200)).body as Record<string, Record<string, unknown>>;
    expect(orderSchema.parse(mine).shipment).toMatchObject({ awb: booked.shipment!.awb, courierName: 'Delhivery Surface' });
    expect(mine.shipment).not.toHaveProperty('labelUrl');

    // A second booking: refused, nothing more sent to Shiprocket
    const again = await boss.as('post', `/admin/orders/${order.number}/shipment`, PARCEL).expect(409);
    expect(problemSchema.parse(again.body).detail).toMatch(/already booked/);
    expect(await paths()).toHaveLength(4);
    expect(await prisma.shipment.count()).toBe(1);

    const history = pageSchema(auditEventSchema).parse((await boss.as('get', `/admin/audit?entityType=order&entityId=${order.number}`).expect(200)).body);
    expect(history.data[0]).toMatchObject({ action: 'shipment.book', summary: expect.stringContaining(`tracking number ${booked.shipment!.awb}`) });
  });

  it('the courier\'s webhook moves the order on: picked up → shipped (email with tracking), delivered', async () => {
    const riya = await shopper();
    const order = await riya.placePaid();
    const boss = await admin();
    const { shipment } = adminOrderSchema.parse((await boss.as('post', `/admin/orders/${order.number}/shipment`, PARCEL).expect(200)).body);
    const awb = shipment!.awb!;

    // Only Shiprocket knows the token
    await webhook(scan(awb, 'PICKED UP', '2026-11-19 11:00:00'), 'not-the-token-at-all-000').expect(401);
    await request(app.getHttpServer()).post('/api/webhooks/courier').send(scan(awb, 'PICKED UP', '2026-11-19 11:00:00')).expect(401);

    await webhook(scan(awb, 'PICKED UP', '2026-11-19 11:00:00', 'Shipment picked up')).expect(200);
    await webhook(scan(awb, 'PICKED UP', '2026-11-19 11:00:00', 'Shipment picked up')).expect(200);   // sent again: stored once
    const shipped = orderSchema.parse((await riya.as('get', `/orders/${order.number}`).expect(200)).body);
    expect(shipped.status).toBe('SHIPPED');
    expect(shipped.shipment).toMatchObject({ status: 'PICKED UP', events: [{ status: 'PICKED UP', activity: 'Shipment picked up', location: 'Pune', at: '2026-11-19T05:30:00.000Z' }] });
    const email = await waitForEmail(app, (m) => m.subject === `Order ${order.number} is on its way`);
    expect(email.text).toContain(`with Delhivery Surface (tracking number ${awb})`);
    expect(email.text).toContain(`https://shiprocket.co/tracking/${awb}`);

    // An older update arriving late doesn't replace the latest status
    await webhook(scan(awb, 'IN TRANSIT', '2026-11-20 09:00:00')).expect(200);
    await webhook(scan(awb, 'PICKUP SCHEDULED', '2026-11-18 18:00:00')).expect(200);
    expect((await prisma.shipment.findFirstOrThrow()).status).toBe('IN TRANSIT');

    await webhook(scan(awb, 'DELIVERED', '2026-11-21 14:30:00')).expect(200);
    const delivered = orderSchema.parse((await riya.as('get', `/orders/${order.number}`).expect(200)).body);
    expect(delivered.status).toBe('DELIVERED');
    expect(delivered.shipment!.events.map((e) => e.status)).toEqual(['DELIVERED', 'IN TRANSIT', 'PICKED UP', 'PICKUP SCHEDULED']);   // newest first

    const history = pageSchema(auditEventSchema).parse((await boss.as('get', `/admin/audit?entityType=order&entityId=${order.number}`).expect(200)).body);
    expect(history.data[0]).toMatchObject({ action: 'order.deliver', actor: null, summary: expect.stringContaining('(Shiprocket: DELIVERED)') });

    // Someone else's parcel, or a test ping: acknowledged, nothing happens
    await webhook(scan('000000000000', 'DELIVERED', '2026-11-21 14:30:00')).expect(200);
    await webhook({}).expect(200);
  });

  it('cash on delivery: refused at the door and back at the shop → returned, stock back; delivered (found by the tracking job) → paid and invoiced', async () => {
    const riya = await shopper();
    const boss = await admin();
    const refused = await riya.place('COD');
    const first = adminOrderSchema.parse((await boss.as('post', `/admin/orders/${refused.number}/shipment`, PARCEL).expect(200)).body);
    expect((await fakeShiprocket.requests()).requests[0]!.body).toMatchObject({ payment_method: 'COD', transaction_charges: 49, shipping_charges: 49 });   // ₹998: under free delivery
    expect(await stockOf(prisma, riya.variantId)).toBe(8);

    await webhook(scan(first.shipment!.awb!, 'RTO INITIATED', '2026-11-20 10:00:00')).expect(200);
    expect((await prisma.order.findUniqueOrThrow({ where: { number: refused.number } })).status).toBe('SHIPPED');
    await webhook(scan(first.shipment!.awb!, 'RTO DELIVERED', '2026-11-23 10:00:00')).expect(200);
    expect((await prisma.order.findUniqueOrThrow({ where: { number: refused.number } })).status).toBe('RETURNED');
    expect(await stockOf(prisma, riya.variantId)).toBe(10);

    // No webhook this time: the scheduled check asks Shiprocket
    await riya.as('post', '/cart/items', { variantId: riya.variantId, quantity: 2 }).expect(200);
    const kept = await riya.place('COD');
    const second = adminOrderSchema.parse((await boss.as('post', `/admin/orders/${kept.number}/shipment`, PARCEL).expect(200)).body);
    const shipping = app.get(ShippingService);
    expect(await shipping.reconcile()).toBe(1);   // asked; nothing scanned yet
    expect((await prisma.order.findUniqueOrThrow({ where: { number: kept.number } })).status).toBe('CONFIRMED');

    await fakeShiprocket.setTracking(second.shipment!.awb!, {
      status: 'Delivered', statusId: 7,
      activities: [
        { date: '2026-11-21 16:00:00', activity: 'Delivered to consignee', label: 'DELIVERED' },
        { date: '2026-11-20 09:00:00', activity: 'Picked up', label: 'PICKED UP' },
      ],
    });
    expect(await shipping.reconcile()).toBe(0);   // asked a moment ago: not again yet
    const later = new Date(Date.now() + 30 * 60 * 1000);
    expect(await shipping.reconcile(later)).toBe(1);
    const row = await prisma.order.findUniqueOrThrow({ where: { number: kept.number }, include: { invoice: true } });
    expect(row).toMatchObject({ status: 'DELIVERED', paidAt: expect.any(Date) });
    expect(row.invoice).not.toBeNull();
    expect(await shipping.reconcile(new Date(later.getTime() + 60 * 60 * 1000))).toBe(0);   // delivered: no longer asked about
  });

  it('a booking can be cancelled before pickup; while booked, the order can\'t be cancelled', async () => {
    const riya = await shopper();
    const boss = await admin();
    const order = await riya.place('COD');
    await boss.as('post', `/admin/orders/${order.number}/shipment`, PARCEL).expect(200);

    const shopperTry = await riya.as('post', `/orders/${order.number}/cancel`).expect(409);
    expect(problemSchema.parse(shopperTry.body).detail).toMatch(/being packed/);
    const adminTry = await boss.as('post', `/admin/orders/${order.number}/cancel`).expect(409);
    expect(problemSchema.parse(adminTry.body).detail).toMatch(/Cancel the shipment first/);

    const cancelled = adminOrderSchema.parse((await boss.as('delete', `/admin/orders/${order.number}/shipment`).expect(200)).body);
    expect(cancelled.shipment).toBeNull();
    expect(cancelled.status).toBe('CONFIRMED');
    expect(await paths()).toContain('orders/cancel');
    await boss.as('delete', `/admin/orders/${order.number}/shipment`).expect(409);   // nothing booked now

    // Booked again (the old one stays as history), then picked up: too late to cancel
    const rebooked = adminOrderSchema.parse((await boss.as('post', `/admin/orders/${order.number}/shipment`, PARCEL).expect(200)).body);
    expect(await prisma.shipment.count()).toBe(2);
    await webhook(scan(rebooked.shipment!.awb!, 'PICKED UP', '2026-11-19 11:00:00')).expect(200);
    const late = await boss.as('delete', `/admin/orders/${order.number}/shipment`).expect(409);
    expect(problemSchema.parse(late.body).detail).toMatch(/courier has the parcel/);
  });

  it('a failed step can be tried again: nothing booked twice; a refused booking leaves nothing behind', async () => {
    const riya = await shopper();
    const boss = await admin();
    const order = await riya.placePaid();

    // Shiprocket refuses the order: its reason is shown, and nothing is left half-booked
    await fakeShiprocket.failNext('/v1/external/orders/create/adhoc', 'Delivery postcode not serviceable');
    const refused = await boss.as('post', `/admin/orders/${order.number}/shipment`, PARCEL).expect(502);
    expect(problemSchema.parse(refused.body).detail).toBe("Shiprocket couldn't create order: Delivery postcode not serviceable");
    expect(await prisma.shipment.count()).toBe(0);

    // Booked, but the pickup request fails: the booking stands, without a pickup
    await fakeShiprocket.failNext('/v1/external/courier/generate/pickup', 'Pickup cut-off time passed');
    const partly = adminOrderSchema.parse((await boss.as('post', `/admin/orders/${order.number}/shipment`, PARCEL).expect(200)).body);
    expect(partly.shipment).toMatchObject({ awb: expect.any(String), pickupRequestedAt: null });

    // Booking again only asks for the pickup
    await fakeShiprocket.expireTokens();   // and the token ran out meanwhile: logs in again by itself
    const done = adminOrderSchema.parse((await boss.as('post', `/admin/orders/${order.number}/shipment`, PARCEL).expect(200)).body);
    expect(done.shipment).toMatchObject({ awb: partly.shipment!.awb, pickupRequestedAt: expect.any(String) });
    const sent = await paths();
    expect(sent.filter((p) => p === 'orders/create/adhoc')).toHaveLength(2);   // the refused one, then the real one
    expect(sent.filter((p) => p === 'courier/assign/awb')).toHaveLength(1);
    expect((await fakeShiprocket.requests()).logins).toBe(2);
  });

  it('sent with another courier: the admin types the tracking number, the shopper sees it', async () => {
    const riya = await shopper();
    const boss = await admin();
    const order = await riya.placePaid();

    const half = await boss.as('post', `/admin/orders/${order.number}/ship`, { courierName: 'India Post' }).expect(422);
    expect(problemSchema.parse(half.body).errors?.[0]?.path).toBe('trackingNumber');

    await boss.as('post', `/admin/orders/${order.number}/ship`, { courierName: 'India Post', trackingNumber: 'EE123456789IN' }).expect(200);
    const mine = orderSchema.parse((await riya.as('get', `/orders/${order.number}`).expect(200)).body);
    expect(mine).toMatchObject({ status: 'SHIPPED', shipment: { provider: 'MANUAL', courierName: 'India Post', awb: 'EE123456789IN', trackingUrl: null } });
    const email = await waitForEmail(app, (m) => m.subject === `Order ${order.number} is on its way`);
    expect(email.text).toContain('with India Post (tracking number EE123456789IN)');
    expect(await paths()).toEqual([]);   // Shiprocket wasn't involved
  });
});
