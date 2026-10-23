import { validateEnv } from './env.js';

// A UNIT test: one function on its own, no database, no HTTP. Fast enough to run on every save.
describe('validateEnv', () => {
  const valid = { DATABASE_URL: 'postgresql://user:pass@localhost:5432/shop_nest' };

  it('fills in defaults for optional settings', () => {
    expect(validateEnv(valid)).toEqual({
      NODE_ENV: 'development',
      PORT: 4000,
      DATABASE_URL: valid.DATABASE_URL,
      WEB_ORIGIN: 'http://localhost:4100',
      LOG_LEVEL: 'info',
      RATE_LIMIT_PER_MINUTE: 120,
      TRUST_PROXY: 'loopback',
    });
  });

  it('turns PORT text from the environment into a number', () => {
    expect(validateEnv({ ...valid, PORT: '8080' }).PORT).toBe(8080);
  });

  it('logs nothing while testing, unless asked to', () => {
    expect(validateEnv({ ...valid, NODE_ENV: 'test' }).LOG_LEVEL).toBe('silent');
    expect(validateEnv({ ...valid, NODE_ENV: 'test', LOG_LEVEL: 'debug' }).LOG_LEVEL).toBe('debug');
  });

  it('reads TRUST_PROXY as a hop count when it is a number', () => {
    expect(validateEnv({ ...valid, TRUST_PROXY: '1' }).TRUST_PROXY).toBe(1);
    expect(validateEnv({ ...valid, TRUST_PROXY: 'loopback, 10.0.0.0/8' }).TRUST_PROXY).toBe('loopback, 10.0.0.0/8');
  });

  it('refuses to start without a database', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });

  it('refuses a database URL that is not PostgreSQL', () => {
    expect(() => validateEnv({ DATABASE_URL: 'mysql://localhost/shop' })).toThrow(/postgresql/);
  });

  it('lists every problem at once, not just the first', () => {
    expect(() => validateEnv({ PORT: 'abc', WEB_ORIGIN: 'not a url' })).toThrow(/PORT[\s\S]*DATABASE_URL|DATABASE_URL[\s\S]*PORT/);
  });
});
