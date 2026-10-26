import type { NestExpressApplication } from '@nestjs/platform-express';
import { adminUserSchema, authResponseSchema, pageSchema, problemSchema } from '@shop/shared';
import request from 'supertest';
import { makeAdmin } from '../scripts/make-admin.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { UsersService } from '../src/users/users.service.js';
import { createTestApp } from './support/create-app.js';
import { createTestPrisma, resetDatabase } from './support/database.js';

describe('Roles and admin access (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let visitor = 0;
  const http = () => request(app.getHttpServer());

  // Signs up (as a different visitor each time: sign-up is rate limited per address)
  const signUp = async (name: string) => {
    const res = await http().post('/api/auth/register').set('X-Forwarded-For', `198.51.100.${++visitor % 250}`)
      .send({ name, email: `${name.toLowerCase()}@example.com`, password: 'correct horse battery' }).expect(201);
    return authResponseSchema.parse(res.body);
  };
  const asUser = (token: string) => ({
    get: (path: string) => http().get(path).set('Authorization', `Bearer ${token}`),
    patch: (path: string, body: object) => http().patch(path).set('Authorization', `Bearer ${token}`).send(body),
  });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = createTestPrisma();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  describe('make-admin script', () => {
    it('promotes an existing account, by email in any capitals', async () => {
      await signUp('Riya');
      expect(await makeAdmin(prisma, ' RIYA@example.com ')).toBe('promoted');
      expect((await prisma.user.findUniqueOrThrow({ where: { email: 'riya@example.com' } })).role).toBe('ADMIN');
      expect(await makeAdmin(prisma, 'riya@example.com')).toBe('already-admin');
    });

    it('does nothing for an email without an account', async () => {
      expect(await makeAdmin(prisma, 'nobody@example.com')).toBe('no-such-user');
      expect(await prisma.user.count()).toBe(0);
    });
  });

  describe('who may use admin routes', () => {
    it('nobody logged in: 401', async () => {
      await http().get('/api/admin/users').expect(401);
    });

    it('a customer: 403 (we know who you are, and you may not)', async () => {
      const customer = await signUp('Customer');
      const res = await asUser(customer.accessToken).get('/api/admin/users').expect(403);
      expect(problemSchema.parse(res.body).detail).toBe("You don't have permission to do that.");
    });

    it('an admin: the list of users, newest first', async () => {
      const riya = await signUp('Riya');
      await signUp('Arjun');
      await makeAdmin(prisma, 'riya@example.com');
      // Riya's token still SAYS customer (made before the promotion), but admin routes check
      // the database: access works straight away
      const res = await asUser(riya.accessToken).get('/api/admin/users').expect(200);
      const page = pageSchema(adminUserSchema).parse(res.body);
      expect(page.data.map((u) => [u.name, u.role])).toEqual([['Arjun', 'CUSTOMER'], ['Riya', 'ADMIN']]);
      expect(JSON.stringify(res.body)).not.toMatch(/argon2|passwordHash/i);
    });

    it('a demoted admin loses access immediately, even with an "admin" token', async () => {
      const riya = await signUp('Riya');
      await makeAdmin(prisma, 'riya@example.com');
      const login = await http().post('/api/auth/login').set('X-Forwarded-For', '198.51.100.251')
        .send({ email: 'riya@example.com', password: 'correct horse battery' }).expect(200);
      const adminToken = authResponseSchema.parse(login.body).accessToken;   // says ADMIN
      await asUser(adminToken).get('/api/admin/users').expect(200);

      await prisma.user.update({ where: { id: riya.user.id }, data: { role: 'CUSTOMER' } });
      await asUser(adminToken).get('/api/admin/users').expect(403);
    });
  });

  describe('changing roles', () => {
    let admin: Awaited<ReturnType<typeof signUp>>;

    beforeEach(async () => {
      admin = await signUp('Riya');
      await makeAdmin(prisma, 'riya@example.com');
    });

    it('an admin can promote and demote others', async () => {
      const arjun = await signUp('Arjun');
      const promoted = await asUser(admin.accessToken).patch(`/api/admin/users/${arjun.user.id}/role`, { role: 'ADMIN' }).expect(200);
      expect(adminUserSchema.parse(promoted.body).role).toBe('ADMIN');
      // Arjun can use admin routes now (his own token says customer: the database decides)
      await asUser(arjun.accessToken).get('/api/admin/users').expect(200);
      await asUser(admin.accessToken).patch(`/api/admin/users/${arjun.user.id}/role`, { role: 'CUSTOMER' }).expect(200);
      await asUser(arjun.accessToken).get('/api/admin/users').expect(403);
    });

    it('the last admin cannot be demoted, not even by themselves', async () => {
      const res = await asUser(admin.accessToken).patch(`/api/admin/users/${admin.user.id}/role`, { role: 'CUSTOMER' }).expect(409);
      expect(problemSchema.parse(res.body).detail).toMatch(/last admin/);
    });

    it('two admins demoting each other at the same time: one admin always remains', async () => {
      const arjun = await signUp('Arjun');
      await makeAdmin(prisma, 'arjun@example.com');

      // Race conditions rarely show up by chance (each transaction takes milliseconds), so this
      // test FORCES the dangerous timing. Transaction A locks the admins, demotes Arjun, and
      // then pauses before committing...
      let release!: () => void;
      const paused = new Promise<void>((resolve) => (release = resolve));
      let holdingLocks!: () => void;
      const locked = new Promise<void>((resolve) => (holdingLocks = resolve));
      const transactionA = prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM users WHERE role = 'ADMIN' FOR UPDATE`;
        await tx.user.update({ where: { id: arjun.user.id }, data: { role: 'CUSTOMER' } });
        holdingLocks();
        await paused;
      }, { timeout: 15_000 });
      await locked;

      // ...meanwhile the service tries to demote Riya. Without its own lock it would read the
      // old data (Arjun still an admin, A hasn't committed), say "fine, there's another admin",
      // and the shop would end up with NONE. With the lock it must wait for A to finish.
      const demoteRiya = app.get(UsersService)
        .changeRole(arjun.user.id, admin.user.id, 'CUSTOMER')
        .then(() => 'demoted', (err: Error) => err.message);
      await new Promise((resolve) => setTimeout(resolve, 300));   // give it time to get stuck
      release();
      await transactionA;

      expect(await demoteRiya).toMatch(/last admin/);
      expect(await prisma.user.count({ where: { role: 'ADMIN' } })).toBe(1);
    });

    it('rejects a bad role, a bad id, and an unknown user', async () => {
      const arjun = await signUp('Arjun');
      await asUser(admin.accessToken).patch(`/api/admin/users/${arjun.user.id}/role`, { role: 'SUPERUSER' }).expect(422);
      await asUser(admin.accessToken).patch('/api/admin/users/not-a-uuid/role', { role: 'ADMIN' }).expect(422);
      await asUser(admin.accessToken).patch('/api/admin/users/0199d1c0-0000-7000-8000-000000000000/role', { role: 'ADMIN' }).expect(404);
    });
  });
});
