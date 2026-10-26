import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { authResponseSchema, problemSchema, userSchema } from '@shop/shared';
import request from 'supertest';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { createTestApp } from './support/create-app.js';
import { createTestPrisma, resetDatabase } from './support/database.js';

describe('Accounts: register, login, me (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  // Login and register allow 10 tries a minute per IP: each test call looks like a different
  // visitor, except in the test that's about that limit
  let visitor = 0;
  const post = (path: string, body: object, ip = `198.51.100.${++visitor % 250}`) =>
    request(app.getHttpServer()).post(`/api/auth/${path}`).set('X-Forwarded-For', ip).send(body);
  const me = (token?: string) => {
    const req = request(app.getHttpServer()).get('/api/auth/me');
    return token === undefined ? req : req.set('Authorization', `Bearer ${token}`);
  };

  const riya = { name: 'Riya Sharma', email: 'riya@example.com', password: 'correct horse battery' };

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

  describe('register', () => {
    it('creates the account and logs it in', async () => {
      const res = await post('register', { ...riya, email: '  Riya@Example.COM ' }).expect(201);
      const auth = authResponseSchema.parse(res.body);
      expect(auth.user).toMatchObject({ name: 'Riya Sharma', email: 'riya@example.com', role: 'CUSTOMER' });
      expect(auth.expiresIn).toBe(15 * 60);
      // The token works straight away
      await me(auth.accessToken).expect(200);
    });

    it('stores an Argon2id hash, never the password', async () => {
      await post('register', riya).expect(201);
      const row = await prisma.user.findUniqueOrThrow({ where: { email: riya.email } });
      expect(row.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
      expect(row.passwordHash).not.toContain(riya.password);
    });

    it('never sends the password hash back, in any response', async () => {
      const registered = await post('register', riya).expect(201);
      const loggedIn = await post('login', riya).expect(200);
      const profile = await me(registered.body.accessToken).expect(200);
      for (const res of [registered, loggedIn, profile]) {
        expect(JSON.stringify(res.body)).not.toMatch(/argon2|passwordHash/i);
      }
    });

    it('one account per email, whatever its capitals', async () => {
      await post('register', riya).expect(201);
      const res = await post('register', { ...riya, email: 'RIYA@example.com' }).expect(409);
      expect(problemSchema.parse(res.body).detail).toMatch(/already exists/);
    });

    it('refuses weak or invalid input with every problem listed', async () => {
      const res = await post('register', { name: '', email: 'not-an-email', password: 'short' }).expect(422);
      expect(problemSchema.parse(res.body).errors?.map((e) => e.path).sort()).toEqual(['email', 'name', 'password']);
    });

    it('cannot sign up as an admin by sending role: ADMIN', async () => {
      const res = await post('register', { ...riya, role: 'ADMIN' }).expect(201);
      expect(res.body.user.role).toBe('CUSTOMER');
    });
  });

  describe('login', () => {
    beforeEach(async () => {
      await post('register', riya).expect(201);
    });

    it('with the right password: the user and a token', async () => {
      const res = await post('login', { email: 'RIYA@example.com', password: riya.password }).expect(200);
      const auth = authResponseSchema.parse(res.body);
      expect(auth.user.email).toBe('riya@example.com');
      const profile = userSchema.parse((await me(auth.accessToken).expect(200)).body);
      expect(profile.id).toBe(auth.user.id);
    });

    it('a wrong password and an unknown email get the SAME answer', async () => {
      const wrongPassword = await post('login', { email: riya.email, password: 'wrong password!' }).expect(401);
      const unknownEmail = await post('login', { email: 'nobody@example.com', password: 'wrong password!' }).expect(401);
      expect(problemSchema.parse(wrongPassword.body).detail).toBe('Wrong email or password');
      expect(problemSchema.parse(unknownEmail.body).detail).toBe('Wrong email or password');
    });

    it('an unknown email takes about as long as a wrong password (no timing leak)', async () => {
      const time = async (email: string) => {
        const start = performance.now();
        await post('login', { email, password: 'wrong password!' }).expect(401);
        return performance.now() - start;
      };
      await time(riya.email);   // warm-up
      const wrong = (await time(riya.email) + await time(riya.email)) / 2;
      const unknown = (await time('nobody@example.com') + await time('nobody@example.com')) / 2;
      // Without the dummy hash check, "unknown" would be many times faster
      expect(unknown).toBeGreaterThan(wrong * 0.5);
    });

    it('10 attempts a minute per address, then 429', async () => {
      const ip = '203.0.113.99';
      for (let i = 0; i < 10; i++) {
        await post('login', { email: riya.email, password: 'guess number ' + i }, ip).expect(401);
      }
      await post('login', riya, ip).expect(429);
    });
  });

  describe('the access token', () => {
    let token: string;
    let userId: string;
    const forge = (payload: object, options: object, secret = process.env.JWT_SECRET!) =>
      new JwtService({ secret }).sign(payload, options);

    beforeEach(async () => {
      const auth = authResponseSchema.parse((await post('register', riya).expect(201)).body);
      token = auth.accessToken;
      userId = auth.user.id;
    });

    it('is required: no token → 401 with WWW-Authenticate', async () => {
      const res = await me().expect(401);
      expect(res.headers['www-authenticate']).toBe('Bearer');
      expect(problemSchema.parse(res.body).detail).toBe('Please log in first.');
    });

    it('a changed token is refused (the signature no longer matches)', async () => {
      const [header, , signature] = token.split('.');
      const payload = Buffer.from(JSON.stringify({ sub: userId, role: 'ADMIN', aud: 'access', iss: 'shop-nest-api', exp: 9999999999 })).toString('base64url');
      await me(`${header}.${payload}.${signature}`).expect(401);
    });

    it('a token signed with another secret is refused', async () => {
      await me(forge({ sub: userId, role: 'CUSTOMER' }, { audience: 'access', issuer: 'shop-nest-api', expiresIn: 60 }, 'some-other-secret-that-is-also-very-long')).expect(401);
    });

    it('an expired token is refused', async () => {
      await me(forge({ sub: userId, role: 'CUSTOMER', exp: Math.floor(Date.now() / 1000) - 10 }, { audience: 'access', issuer: 'shop-nest-api' })).expect(401);
    });

    it('a token meant for something else (another audience) is refused', async () => {
      await me(forge({ sub: userId, role: 'CUSTOMER' }, { audience: 'password-reset', issuer: 'shop-nest-api', expiresIn: 60 })).expect(401);
    });

    it('an unsigned token ("alg": "none") is refused', async () => {
      const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
      await me(`${part({ alg: 'none', typ: 'JWT' })}.${part({ sub: userId, role: 'ADMIN', aud: 'access', iss: 'shop-nest-api' })}.`).expect(401);
    });

    it('a deleted account: its old token stops working', async () => {
      await prisma.user.delete({ where: { id: userId } });
      await me(token).expect(401);
    });
  });
});
