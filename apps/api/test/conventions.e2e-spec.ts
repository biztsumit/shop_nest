import type { NestExpressApplication } from '@nestjs/platform-express';
import { problemSchema, type Problem } from '@shop/shared';
import request from 'supertest';
import { createTestApp } from './support/create-app.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// The rules every endpoint follows: request ids, security headers, one error format, validation
describe('API conventions (e2e)', () => {
  let app: NestExpressApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // Every error must be a valid Problem, sent as application/problem+json, with the request id
  // that's also in the X-Request-Id header
  const expectProblem = (res: request.Response, status: number): Problem => {
    expect(res.status).toBe(status);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    const problem = problemSchema.parse(res.body);
    expect(problem.status).toBe(status);
    expect(problem.requestId).toBe(res.headers['x-request-id']);
    return problem;
  };

  describe('request ids', () => {
    it('gives every response a new X-Request-Id', async () => {
      const [a, b] = await Promise.all([http().get('/api/health'), http().get('/api/health')]);
      expect(a.headers['x-request-id']).toMatch(UUID);
      expect(a.headers['x-request-id']).not.toBe(b.headers['x-request-id']);
    });

    it('keeps an id passed in by the caller (e.g. the web server), so both logs share it', async () => {
      const res = await http().get('/api/health').set('X-Request-Id', 'web-7f3a9c21');
      expect(res.headers['x-request-id']).toBe('web-7f3a9c21');
    });

    it('ignores an id that could fake log lines, and makes its own', async () => {
      const res = await http().get('/api/health').set('X-Request-Id', 'x"} {"level":60,"msg":"hacked');
      expect(res.headers['x-request-id']).toMatch(UUID);
    });
  });

  it('sends security headers (Helmet)', async () => {
    const res = await http().get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['x-powered-by']).toBeUndefined();   // don't advertise the server software
  });

  describe('one error format (Problem Details)', () => {
    it('an unknown route', async () => {
      const problem = expectProblem(await http().get('/api/nope?x=1'), 404);
      expect(problem).toMatchObject({ type: 'about:blank', title: 'Not found', instance: '/api/nope' });
      expect(problem.detail).toBe('There is no GET /api/nope endpoint.');
    });

    it('an error thrown on purpose keeps its message', async () => {
      const problem = expectProblem(await http().get('/api/test/missing'), 404);
      expect(problem.detail).toBe('That product no longer exists');
    });

    it('a crash is a 500 that reveals nothing about the cause', async () => {
      const res = await http().get('/api/test/boom');
      const problem = expectProblem(res, 500);
      expect(problem.detail).toMatch(/quote the request ID/);
      expect(JSON.stringify(res.body)).not.toContain('hunter2');
    });

    it('broken JSON in the body', async () => {
      const res = await http().post('/api/test/echo').set('Content-Type', 'application/json').send('{"name": "Ri');
      expect(expectProblem(res, 400).detail).toBe('The request body is not valid JSON.');
    });
  });

  describe('validation with the shared zod schemas', () => {
    it('lists every invalid field, with its path', async () => {
      const res = await http().post('/api/test/echo').send({ name: 'R', age: -3, address: { postalCode: '12' } });
      const problem = expectProblem(res, 422);
      expect(problem).toMatchObject({ type: '/problems/validation', title: 'Validation failed', detail: '3 fields are invalid' });
      expect(problem.errors?.map((e) => e.path).sort()).toEqual(['address.postalCode', 'age', 'name']);
      expect(problem.errors?.find((e) => e.path === 'address.postalCode')?.message).toBe('must be 6 digits');
    });

    it('a missing body is also a validation problem, not a crash', async () => {
      const problem = expectProblem(await http().post('/api/test/echo'), 422);
      expect(problem.errors?.length).toBeGreaterThan(0);
    });

    it('valid input reaches the handler AFTER the schema cleaned it (trimmed, converted)', async () => {
      const res = await http().post('/api/test/echo').send({ name: '  Riya  ', age: '29', address: { postalCode: '560001' } }).expect(201);
      expect(res.body).toEqual({ name: 'Riya', age: 29, address: { postalCode: '560001' } });
    });
  });
});
