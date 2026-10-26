import type { NestExpressApplication } from '@nestjs/platform-express';
import { authResponseSchema, problemSchema, userSchema } from '@shop/shared';
import request from 'supertest';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { createTestApp } from './support/create-app.js';
import { createTestPrisma, resetDatabase } from './support/database.js';
import { clearOutbox, tokenFrom, waitForEmail } from './support/emails.js';

const WEB = 'http://localhost:4100';
const riya = { name: 'Riya <b>Sharma</b>', email: 'riya@example.com', password: 'correct horse battery' };

describe('Account emails: verification and passwords (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let visitor = 0;
  const http = () => request(app.getHttpServer());
  const post = (path: string, body?: object, token?: string) => {
    const req = http().post(`/api/auth/${path}`).set('Origin', WEB).set('X-Forwarded-For', `198.51.100.${++visitor % 250}`);
    return (token ? req.set('Authorization', `Bearer ${token}`) : req).send(body);
  };
  const to = (email: string, subject: RegExp) => (m: { to: string; subject: string }) => m.to === email && subject.test(m.subject);

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

  describe('email verification', () => {
    it('signing up sends a link; opening it confirms the address', async () => {
      const auth = authResponseSchema.parse((await post('register', riya).expect(201)).body);
      expect(auth.user.emailVerified).toBe(false);

      const email = await waitForEmail(app, to(riya.email, /Confirm your email/));
      expect(email.text).toContain(`${WEB}/verify-email?token=`);
      // The user's name is escaped in the HTML: it's shown, never run
      expect(email.html).toContain('Riya &lt;b&gt;Sharma&lt;/b&gt;');

      const verified = userSchema.parse((await post('verify-email', { token: tokenFrom(email) }).expect(200)).body);
      expect(verified.emailVerified).toBe(true);
    });

    it('a link works once', async () => {
      await post('register', riya).expect(201);
      const token = tokenFrom(await waitForEmail(app, to(riya.email, /Confirm/)));
      await post('verify-email', { token }).expect(200);
      const res = await post('verify-email', { token }).expect(400);
      expect(problemSchema.parse(res.body).detail).toMatch(/invalid or has expired/);
    });

    it('asking for a new link makes the old one stop working', async () => {
      const auth = authResponseSchema.parse((await post('register', riya).expect(201)).body);
      const first = tokenFrom(await waitForEmail(app, to(riya.email, /Confirm/)));
      clearOutbox(app);
      await post('resend-verification', undefined, auth.accessToken).expect(202);
      const second = tokenFrom(await waitForEmail(app, to(riya.email, /Confirm/)));
      expect(second).not.toBe(first);
      await post('verify-email', { token: first }).expect(400);
      await post('verify-email', { token: second }).expect(200);
      // Already confirmed: no more links
      await post('resend-verification', undefined, auth.accessToken).expect(409);
    });

    it('an expired link is refused', async () => {
      await post('register', riya).expect(201);
      const token = tokenFrom(await waitForEmail(app, to(riya.email, /Confirm/)));
      await prisma.emailToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
      await post('verify-email', { token }).expect(400);
    });

    it('only hashes of link tokens are stored', async () => {
      await post('register', riya).expect(201);
      const token = tokenFrom(await waitForEmail(app, to(riya.email, /Confirm/)));
      const rows = await prisma.emailToken.findMany();
      expect(rows.some((r) => r.tokenHash.includes(token))).toBe(false);
    });
  });

  describe('forgot and reset password', () => {
    beforeEach(async () => {
      await post('register', riya).expect(201);
      await waitForEmail(app, to(riya.email, /Confirm/));
      clearOutbox(app);
    });

    it('the same answer whether or not the email has an account', async () => {
      const known = await post('forgot-password', { email: riya.email }).expect(202);
      const unknown = await post('forgot-password', { email: 'nobody@example.com' }).expect(202);
      expect(known.body).toEqual(unknown.body);
      await waitForEmail(app, to(riya.email, /Reset your password/));
      expect(app.get((await import('../src/email/email.service.js')).EmailService).outbox.some((m) => m.to === 'nobody@example.com')).toBe(false);
    });

    it('reset: the new password works, the old one and every login stop working', async () => {
      const oldSession = await post('login', { email: riya.email, password: riya.password }).expect(200);
      const cookie = ([] as string[]).concat(oldSession.headers['set-cookie'] ?? []).find((c) => c.startsWith('refresh_token='))!.split(';')[0]!;

      await post('forgot-password', { email: riya.email }).expect(202);
      const token = tokenFrom(await waitForEmail(app, to(riya.email, /Reset/)));
      await post('reset-password', { token, password: 'a brand new passphrase' }).expect(204);

      await post('login', { email: riya.email, password: riya.password }).expect(401);
      await post('login', { email: riya.email, password: 'a brand new passphrase' }).expect(200);
      await http().post('/api/auth/refresh').set('Origin', WEB).set('Cookie', cookie).expect(401);   // logged out everywhere
      await waitForEmail(app, to(riya.email, /password was changed/));
      // Using the reset link proved they own the inbox
      expect((await prisma.user.findUniqueOrThrow({ where: { email: riya.email } })).emailVerifiedAt).not.toBeNull();
      // ...and the link can't be used twice
      await post('reset-password', { token, password: 'another new passphrase' }).expect(400);
    });

    it('a verification link cannot be used as a reset link', async () => {
      const auth = authResponseSchema.parse((await post('login', { email: riya.email, password: riya.password }).expect(200)).body);
      await post('resend-verification', undefined, auth.accessToken).expect(202);
      const verifyToken = tokenFrom(await waitForEmail(app, to(riya.email, /Confirm/)));
      await post('reset-password', { token: verifyToken, password: 'a brand new passphrase' }).expect(400);
    });
  });

  describe('change password (logged in)', () => {
    it('needs the current password; other devices are logged out, this one stays in', async () => {
      const phone = await post('register', riya).expect(201);
      const phoneCookie = ([] as string[]).concat(phone.headers['set-cookie'] ?? []).find((c) => c.startsWith('refresh_token='))!.split(';')[0]!;
      const laptop = authResponseSchema.parse((await post('login', { email: riya.email, password: riya.password }).expect(200)).body);

      const wrong = await post('change-password', { currentPassword: 'not it', newPassword: 'a brand new passphrase' }, laptop.accessToken).expect(401);
      expect(problemSchema.parse(wrong.body).detail).toBe('Your current password is not right.');

      const res = await post('change-password', { currentPassword: riya.password, newPassword: 'a brand new passphrase' }, laptop.accessToken).expect(200);
      authResponseSchema.parse(res.body);
      expect(([] as string[]).concat(res.headers['set-cookie'] ?? []).some((c) => c.startsWith('refresh_token='))).toBe(true);
      await http().post('/api/auth/refresh').set('Origin', WEB).set('Cookie', phoneCookie).expect(401);
      await waitForEmail(app, to(riya.email, /password was changed/));
    });
  });
});
