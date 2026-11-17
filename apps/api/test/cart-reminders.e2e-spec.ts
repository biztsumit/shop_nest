import type { NestExpressApplication } from '@nestjs/platform-express';
import { emailPreferencesSchema } from '@shop/shared';
import request from 'supertest';
import { CartRemindersService } from '../src/cart-reminders/cart-reminders.service.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { createTestApp } from './support/create-app.js';
import { createTestPrisma, resetDatabase } from './support/database.js';
import { clearOutbox, waitForEmail } from './support/emails.js';
import { signUp, variantOf } from './support/shopper.js';

describe('Abandoned-cart reminders (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  // The scheduled job's work, run when the test says so (schedules are off in tests)
  const runJob = () => app.get(CartRemindersService).sendReminders();

  // A signed-up shopper with a confirmed email and one item in the cart
  const shopperWithCart = async (name = 'Riya', stock = 5) => {
    const shopper = await signUp(app, name);
    await prisma.user.update({ where: { id: shopper.user.id }, data: { emailVerifiedAt: new Date() } });
    const variantId = await variantOf(prisma, `tee-for-${name.toLowerCase()}`, { stock: 5, price: 49900 });
    await shopper.as('post', '/cart/items', { variantId, quantity: 2 }).expect(200);
    if (stock === 0) await prisma.productVariant.update({ where: { id: variantId }, data: { stock: 0 } });
    return { ...shopper, variantId };
  };
  // Pretend the cart was last changed `hours` ago
  const ageCart = (userId: string, hours: number) =>
    prisma.$executeRaw`UPDATE cart_items SET updated_at = now() - make_interval(hours => ${hours}) WHERE user_id = ${userId}::uuid`;
  const reminderFor = (email: string) => waitForEmail(app, (m) => m.to === email && m.subject === 'You left something in your cart');
  const unsubscribeToken = (text: string) => /unsubscribe\?token=([\w.-]+)/.exec(text)?.[1] ?? '';

  beforeAll(async () => {
    app = await createTestApp();
    prisma = createTestPrisma();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    clearOutbox(app);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('a cart untouched for a day gets ONE reminder, with what is in it', async () => {
    const riya = await shopperWithCart();
    await ageCart(riya.user.id, 23);
    expect(await runJob()).toBe(0);   // not a day yet

    await ageCart(riya.user.id, 25);
    expect(await runJob()).toBe(1);
    const email = await reminderFor('riya@example.com');
    expect(email.text).toContain('2 × Tee For Riya: ₹998');
    expect(email.text).toContain('/checkout');
    expect(email.text).toContain('/unsubscribe?token=');

    expect(await runJob()).toBe(0);   // reminded already
  });

  it('changing the cart afterwards re-arms it: one more reminder later', async () => {
    const riya = await shopperWithCart();
    await ageCart(riya.user.id, 25);
    expect(await runJob()).toBe(1);

    // As if that reminder went out 30 hours ago, and the shopper changed the cart since
    await prisma.user.update({ where: { id: riya.user.id }, data: { cartRemindedAt: new Date(Date.now() - 30 * 60 * 60 * 1000) } });
    await riya.as('put', `/cart/items/${riya.variantId}`, { quantity: 3 }).expect(200);
    expect(await runJob()).toBe(0);   // just changed
    await ageCart(riya.user.id, 25);
    expect(await runJob()).toBe(1);
  });

  it('no reminder: unconfirmed email, a cart over a week old, nothing buyable, or turned off', async () => {
    const unconfirmed = await shopperWithCart('Arjun');
    await prisma.user.update({ where: { id: unconfirmed.user.id }, data: { emailVerifiedAt: null } });
    await ageCart(unconfirmed.user.id, 25);

    const stale = await shopperWithCart('Kavya');
    await ageCart(stale.user.id, 8 * 24);

    const soldOut = await shopperWithCart('Rohan', 0);
    await ageCart(soldOut.user.id, 25);

    const optedOut = await shopperWithCart('Meera');
    await optedOut.as('patch', '/account/preferences', { cartReminders: false }).expect(200);
    await ageCart(optedOut.user.id, 25);

    expect(await runJob()).toBe(0);
  });

  it('the one-click link turns reminders off without logging in, and is no login token', async () => {
    const riya = await shopperWithCart();
    await ageCart(riya.user.id, 25);
    await runJob();
    const token = unsubscribeToken((await reminderFor('riya@example.com')).text);

    // It can't be used to log in...
    await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
    // ...and a login token can't be used as an unsubscribe link
    await request(app.getHttpServer()).post('/api/email-preferences/unsubscribe').send({ token: riya.accessToken }).expect(400);

    await request(app.getHttpServer()).post('/api/email-preferences/unsubscribe').send({ token }).expect(204);
    expect(emailPreferencesSchema.parse((await riya.as('get', '/account/preferences').expect(200)).body)).toEqual({ cartReminders: false });

    // Off: a new abandoned cart gets nothing
    await riya.as('put', `/cart/items/${riya.variantId}`, { quantity: 1 }).expect(200);
    await ageCart(riya.user.id, 25);
    expect(await runJob()).toBe(0);
  });

  it('the account page reads and changes the choice', async () => {
    const riya = await signUp(app);
    expect(emailPreferencesSchema.parse((await riya.as('get', '/account/preferences').expect(200)).body)).toEqual({ cartReminders: true });
    await riya.as('patch', '/account/preferences', { cartReminders: false }).expect(200);
    await riya.as('patch', '/account/preferences', { cartReminders: 'no' }).expect(422);
    await request(app.getHttpServer()).get('/api/account/preferences').expect(401);
  });
});
