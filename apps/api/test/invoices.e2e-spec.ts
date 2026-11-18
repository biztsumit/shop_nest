import type { NestExpressApplication } from '@nestjs/platform-express';
import { addressSchema, invoiceSchema, orderSchema, problemSchema, startPaymentSchema } from '@shop/shared';
import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { createTestApp } from './support/create-app.js';
import { createTestPrisma, resetDatabase } from './support/database.js';
import { fakeRazorpay } from './support/razorpay.js';
import { signUp, variantOf } from './support/shopper.js';
import { TEST_SELLER } from './test-env.js';

// Collects a binary response (the PDF) as a Buffer
const binary = (res: Response, done: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

describe('GST invoices (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;

  // A shopper with 2 tees (₹499 each, 5% GST, HSN 6109) in the cart, shipping to `state`
  const shopper = async (name = 'Riya', state = 'Maharashtra') => {
    const s = await signUp(app, name);
    await prisma.user.update({ where: { id: s.user.id }, data: { emailVerifiedAt: new Date() } });
    const address = addressSchema.parse((await s.as('post', '/addresses', {
      fullName: `${name} Rao`, phone: '9876543210', line1: '4 Lake View', city: state === 'Karnataka' ? 'Mysuru' : 'Pune', state, pincode: '570001',
    }).expect(201)).body);
    const variantId = await variantOf(prisma, `tee-${name.toLowerCase()}`, { price: 49900, stock: 10 });
    const { productId } = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });
    await prisma.product.update({ where: { id: productId }, data: { hsnCode: '6109', gstRate: 5 } });
    await s.as('post', '/cart/items', { variantId, quantity: 2 }).expect(200);
    const place = async (paymentMethod: 'ONLINE' | 'COD' = 'ONLINE') =>
      orderSchema.parse((await s.as('post', '/orders', { addressId: address.id, paymentMethod }, { 'Idempotency-Key': randomUUID() }).expect(201)).body);
    const pay = async (number: string) => {
      const { razorpayOrderId } = startPaymentSchema.parse((await s.as('post', `/orders/${number}/payment`).expect(200)).body);
      const { payment, signature } = await fakeRazorpay.pay(razorpayOrderId);
      await s.as('post', `/orders/${number}/payment/verify`, { razorpayOrderId, razorpayPaymentId: payment.id, razorpaySignature: signature }).expect(200);
    };
    const invoice = (number: string) => s.as('get', `/orders/${number}/invoice`).buffer(true).parse(binary);
    return { ...s, productId, place, pay, invoice };
  };
  const admin = async () => {
    const boss = await signUp(app, 'Meera');
    await prisma.user.update({ where: { id: boss.user.id }, data: { role: 'ADMIN' } });
    return boss;
  };
  const stored = async (number: string) =>
    invoiceSchema.parse((await prisma.invoice.findFirstOrThrow({ where: { order: { number } } })).data);

  beforeAll(async () => {
    app = await createTestApp();
    prisma = createTestPrisma();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await fakeRazorpay.reset();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('a paid order gets a numbered invoice at once, at the rate it was ordered at; IGST to another state', async () => {
    const riya = await shopper();
    const order = await riya.place();
    expect(await prisma.invoice.count()).toBe(0);   // not paid: no invoice
    const unpaid = await riya.as('get', `/orders/${order.number}/invoice`).expect(404);
    expect(problemSchema.parse(unpaid.body).detail).toMatch(/issued once the order is paid/);

    // The rate changes after the order was placed: the invoice still uses 5%
    await prisma.product.update({ where: { id: riya.productId }, data: { gstRate: 18 } });
    await riya.pay(order.number);

    const invoice = await stored(order.number);
    expect(invoice).toMatchObject({
      number: expect.stringMatching(/^INV\d{4}-000001$/),
      orderNumber: order.number,
      paymentMethod: 'ONLINE',
      seller: { legalName: TEST_SELLER.legalName, gstin: TEST_SELLER.gstin, state: 'Karnataka', stateCode: '29' },
      buyer: { name: 'Riya Rao', state: 'Maharashtra', stateCode: '27' },
      interState: true,
    });
    // ₹998 of tees at 5% (IGST ₹47.52) + ₹49 delivery at 5% (₹2.33)
    expect(invoice.lines.map((l) => [l.hsn, l.rate, l.taxable, l.igst, l.cgst, l.total])).toEqual([
      ['6109', 5, 95048, 4752, 0, 99800],
      ['996812', 5, 4667, 233, 0, 4900],
    ]);
    expect(invoice.totals.total).toBe(order.total);
    expect(invoice.amountInWords).toBe('Rupees One Thousand Forty Seven Only');

    const pdf = await riya.invoice(order.number).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toBe(`attachment; filename="invoice-${invoice.number}.pdf"`);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    // Someone else's order: no such order. An admin: any order.
    const other = await shopper('Kabir');
    await other.as('get', `/orders/${order.number}/invoice`).expect(404);
    const boss = await admin();
    await boss.as('get', `/admin/orders/${order.number}/invoice`).buffer(true).parse(binary).expect(200);
  });

  it('numbers run on without gaps; an issued invoice can never be changed or deleted', async () => {
    const riya = await shopper();
    const first = await riya.place();
    await riya.pay(first.number);
    const kabir = await shopper('Kabir');
    const second = await kabir.place();
    await kabir.pay(second.number);

    expect((await stored(second.number)).number).toMatch(/-000002$/);
    const row = await prisma.invoice.findFirstOrThrow({ where: { order: { number: first.number } } });
    await expect(prisma.invoice.update({ where: { id: row.id }, data: { number: 'INV0000-999999' } })).rejects.toThrow(/append-only/);
    await expect(prisma.invoice.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
  });

  it('cash on delivery: invoiced when delivered; CGST + SGST within the shop\'s state', async () => {
    const riya = await shopper('Riya', 'Karnataka');
    const order = await riya.place('COD');
    const boss = await admin();
    await boss.as('post', `/admin/orders/${order.number}/ship`).expect(200);
    expect(await prisma.invoice.count()).toBe(0);
    await boss.as('post', `/admin/orders/${order.number}/deliver`).expect(200);

    const invoice = await stored(order.number);
    expect(invoice).toMatchObject({ paymentMethod: 'COD', interState: false, buyer: { state: 'Karnataka', stateCode: '29' } });
    expect(invoice.lines.map((l) => l.description)).toEqual(['Tee Riya', 'Delivery charges', 'Cash on delivery fee']);
    expect(invoice.lines[0]).toMatchObject({ cgst: 2376, sgst: 2376, igst: 0 });
    expect(invoice.totals.total).toBe(order.total);
    await riya.invoice(order.number).expect(200);
  });

  it('an order paid before invoices were set up gets one when first asked for', async () => {
    const riya = await shopper();
    const order = await riya.place();
    // Paid, with no invoice (as if the shop had no GST details then)
    await prisma.order.update({ where: { number: order.number }, data: { status: 'PAID', paidAt: new Date() } });
    expect(await prisma.invoice.count()).toBe(0);

    await riya.invoice(order.number).expect(200);
    await riya.invoice(order.number).expect(200);   // the same one again, not a second
    expect(await prisma.invoice.count()).toBe(1);
  });
});
