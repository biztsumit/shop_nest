import type { NestExpressApplication } from '@nestjs/platform-express';
import { authResponseSchema, problemSchema } from '@shop/shared';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { RefreshTokensService } from '../src/auth/refresh-tokens.service.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { createTestApp } from './support/create-app.js';
import { createTestPrisma, resetDatabase } from './support/database.js';

const WEB = 'http://localhost:4100';
const riya = { name: 'Riya Sharma', email: 'riya@example.com', password: 'correct horse battery' };

// The refresh_token cookie a response set, and its attributes
const refreshCookie = (res: request.Response): { value: string; header: string } => {
  const raw = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('refresh_token='));
  if (!raw) throw new Error('no refresh_token cookie in the response');
  return { value: decodeURIComponent(raw.split(';')[0]!.slice('refresh_token='.length)), header: raw };
};

describe('Sessions: refresh cookie, rotation, logout (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let visitor = 0;
  const http = () => request(app.getHttpServer());
  const ip = () => `198.51.100.${++visitor % 250}`;   // login is limited per address

  const login = () => http().post('/api/auth/login').set('X-Forwarded-For', ip()).set('Origin', WEB).send(riya).expect(200);
  const refresh = (cookie: string) => http().post('/api/auth/refresh').set('Origin', WEB).set('Cookie', `refresh_token=${cookie}`);

  beforeAll(async () => {
    app = await createTestApp();
    prisma = createTestPrisma();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await http().post('/api/auth/register').set('X-Forwarded-For', ip()).send(riya).expect(201);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('login sets the refresh token as a safe cookie', async () => {
    const { header } = refreshCookie(await login());
    expect(header).toMatch(/HttpOnly/);         // page JavaScript can't read it
    expect(header).toMatch(/SameSite=Lax/);     // other websites can't use it
    expect(header).toMatch(/Path=\/api\/auth/); // only sent to the login endpoints
    expect(header).toMatch(/Expires=/);
    expect(header).not.toMatch(/Secure/);       // off in tests and development (http://localhost)
  });

  it('stores only a hash of the refresh token', async () => {
    const { value } = refreshCookie(await login());
    const rows = await prisma.refreshToken.findMany();
    expect(rows.some((r) => r.tokenHash.includes(value))).toBe(false);
    expect(rows.some((r) => r.tokenHash === createHash('sha256').update(value).digest('hex'))).toBe(true);
  });

  it('refresh: a new access token AND a new refresh cookie', async () => {
    const first = refreshCookie(await login()).value;
    const res = await refresh(first).expect(200);
    const auth = authResponseSchema.parse(res.body);
    const second = refreshCookie(res).value;
    expect(second).not.toBe(first);
    await http().get('/api/auth/me').set('Authorization', `Bearer ${auth.accessToken}`).expect(200);
    // and the new cookie works next time
    await refresh(second).expect(200);
  });

  it('two tabs refreshing at the same moment: one wins, the other is told to retry (409)', async () => {
    const cookie = refreshCookie(await login()).value;
    const [a, b] = await Promise.all([refresh(cookie), refresh(cookie)]);
    expect([a.status, b.status].sort((x, y) => x - y)).toEqual([200, 409]);
  });

  it('a true race (all read the token before any writes): still exactly one winner', async () => {
    // Over HTTP the requests rarely overlap exactly, so this goes straight to the service:
    // five rotations of one token at the same instant. Without the atomic "claim if still
    // unused" update, several would win and the token would have been used more than once.
    const tokens = app.get(RefreshTokensService);
    const cookie = refreshCookie(await login()).value;
    const before = await prisma.refreshToken.count();
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => tokens.rotate(cookie)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.refreshToken.count()).toBe(before + 1);   // ONE replacement, not five
  });

  it('an old refresh token used again later = theft: the whole login is ended', async () => {
    const stolen = refreshCookie(await login()).value;
    const current = refreshCookie(await refresh(stolen).expect(200)).value;   // the real user moves on

    // Pretend it's 5 minutes later: past the retry window
    await prisma.refreshToken.updateMany({ where: { usedAt: { not: null } }, data: { usedAt: new Date(Date.now() - 5 * 60_000) } });

    const res = await refresh(stolen).expect(401);   // the thief tries the copy
    expect(problemSchema.parse(res.body).detail).toBe('Your session has ended. Please log in again.');
    // ...and the real user's newer token was revoked with it: the thief can't use that either
    await refresh(current).expect(401);
  });

  it('other logins of the same person are not affected by one family being revoked', async () => {
    const phone = refreshCookie(await login()).value;
    const laptop = refreshCookie(await login()).value;
    await refresh(phone).expect(200);
    await prisma.refreshToken.updateMany({ where: { usedAt: { not: null } }, data: { usedAt: new Date(Date.now() - 5 * 60_000) } });
    await refresh(phone).expect(401);   // phone's family revoked
    await refresh(laptop).expect(200);  // laptop untouched
  });

  it('logout ends this login and clears the cookie; logging out twice is fine', async () => {
    const cookie = refreshCookie(await login()).value;
    const res = await http().post('/api/auth/logout').set('Origin', WEB).set('Cookie', `refresh_token=${cookie}`).expect(204);
    expect(refreshCookie(res).header).toMatch(/refresh_token=;.*Expires=Thu, 01 Jan 1970/);
    await refresh(cookie).expect(401);
    await http().post('/api/auth/logout').set('Origin', WEB).expect(204);
  });

  it('log out everywhere: every device stops working (needs the access token)', async () => {
    const phone = await login();
    const laptop = refreshCookie(await login()).value;
    await http().post('/api/auth/logout-all').set('Origin', WEB).expect(401);   // no access token
    await http().post('/api/auth/logout-all').set('Origin', WEB)
      .set('Authorization', `Bearer ${phone.body.accessToken}`).expect(204);
    await refresh(refreshCookie(phone).value).expect(401);
    await refresh(laptop).expect(401);
  });

  it('a request started by another website is refused (CSRF)', async () => {
    const cookie = refreshCookie(await login()).value;
    const res = await http().post('/api/auth/refresh').set('Origin', 'https://evil.example').set('Cookie', `refresh_token=${cookie}`).expect(403);
    expect(problemSchema.parse(res.body).detail).toMatch(/another website/);
    // The token itself is untouched: the real site can still use it
    await refresh(cookie).expect(200);
  });

  it('no cookie, an unknown cookie or an expired one: 401, and a dead cookie is cleared', async () => {
    await http().post('/api/auth/refresh').set('Origin', WEB).expect(401);
    const unknown = await refresh('made-up-token').expect(401);
    expect(refreshCookie(unknown).header).toMatch(/Expires=Thu, 01 Jan 1970/);

    const cookie = refreshCookie(await login()).value;
    await prisma.refreshToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    await refresh(cookie).expect(401);
  });

  it('the role in a refreshed access token is the CURRENT one', async () => {
    const cookie = refreshCookie(await login()).value;
    await prisma.user.update({ where: { email: riya.email }, data: { role: 'ADMIN' } });
    const auth = authResponseSchema.parse((await refresh(cookie).expect(200)).body);
    expect(auth.user.role).toBe('ADMIN');
    const payload = JSON.parse(Buffer.from(auth.accessToken.split('.')[1]!, 'base64url').toString());
    expect(payload.role).toBe('ADMIN');
  });

  it('deleting the account deletes its sessions', async () => {
    const cookie = refreshCookie(await login()).value;
    await prisma.user.delete({ where: { email: riya.email } });
    expect(await prisma.refreshToken.count()).toBe(0);
    await refresh(cookie).expect(401);
  });
});
