import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { healthSchema } from '@shop/shared';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { setupApp } from './../src/setup-app.js';

// End-to-end: the whole app (real modules, real database), called over HTTP
describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    setupApp(app);
    await app.init();
  });

  it('GET /api/health reports the API and database as up', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    // The response must match the shared schema, the same one the web app checks against
    const health = healthSchema.parse(res.body);
    expect(health.status).toBe('ok');
    expect(health.database).toBe('up');
  });

  it('GET /health without the /api prefix is a 404', async () => {
    await request(app.getHttpServer()).get('/health').expect(404);
  });

  it('only allows the web app origin (CORS)', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').set('Origin', 'http://localhost:4100');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:4100');
  });

  afterAll(async () => {
    await app.close();
  });
});
