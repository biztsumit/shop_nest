import type { NestExpressApplication } from '@nestjs/platform-express';
import { problemSchema } from '@shop/shared';
import request from 'supertest';

// Settings are read once, when AppModule is first loaded. This file sets a tiny limit BEFORE
// loading it (each test file runs in its own module registry, so other files keep the default).
process.env.RATE_LIMIT_PER_MINUTE = '3';
const { createTestApp } = await import('./support/create-app.js');

describe('Rate limiting (e2e)', () => {
  let app: NestExpressApplication;
  // Requests come through a proxy on this machine (like the Next.js server), which reports the
  // real client in X-Forwarded-For
  const from = (ip: string) => request(app.getHttpServer()).get('/api/test/missing').set('X-Forwarded-For', ip);

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers 429 with a Problem after the limit, per client', async () => {
    for (let i = 0; i < 3; i++) {
      await from('203.0.113.10').expect(404);
    }
    const res = await from('203.0.113.10').expect(429);
    expect(problemSchema.parse(res.body)).toMatchObject({ type: '/problems/rate-limited', title: 'Too many requests' });
    // The standard header telling the client how long to wait
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('counts each shopper separately, even though all come through the same proxy', async () => {
    await from('198.51.100.20').expect(404);
  });

  it('never limits the health check (monitors call it constantly)', async () => {
    for (let i = 0; i < 6; i++) {
      await request(app.getHttpServer()).get('/api/health').set('X-Forwarded-For', '203.0.113.10').expect(200);
    }
  });
});
