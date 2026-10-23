import type { NestExpressApplication } from '@nestjs/platform-express';
import { healthSchema } from '@shop/shared';
import request from 'supertest';
import { createTestApp } from './support/create-app.js';

// End-to-end: the whole app (real modules, real database), called over HTTP
describe('Health (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health reports the API and database as up', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    // The response must match the shared schema, the same one the web app checks against
    const health = healthSchema.parse(res.body);
    expect(health.status).toBe('ok');
    expect(health.database).toBe('up');
  });

  it('only allows the web app origin (CORS)', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').set('Origin', 'http://localhost:4100');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:4100');
  });
});
