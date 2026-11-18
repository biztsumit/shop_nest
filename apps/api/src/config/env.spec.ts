import { validateEnv } from './env.js';

// A UNIT test: one function on its own, no database, no HTTP. Fast enough to run on every save.
describe('validateEnv', () => {
  const valid = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/shop_nest',
    JWT_SECRET: 'a-test-secret-that-is-long-enough-1234',
  };

  it('fills in defaults for optional settings', () => {
    expect(validateEnv(valid)).toEqual({
      NODE_ENV: 'development',
      PORT: 4000,
      DATABASE_URL: valid.DATABASE_URL,
      WEB_ORIGIN: 'http://localhost:4100',
      JWT_SECRET: valid.JWT_SECRET,
      ACCESS_TOKEN_MINUTES: 15,
      REFRESH_TOKEN_DAYS: 30,
      EMAIL_TRANSPORT: 'log',
      EMAIL_FROM_ADDRESS: 'shop@example.com',
      EMAIL_FROM_NAME: 'Shop',
      EMAIL_REDIRECT_TO: undefined,
      JOBS_ENABLED: true,
      JOB_SCHEDULES_ENABLED: true,
      ORDER_PAYMENT_MINUTES: 30,
      RAZORPAY_API_URL: 'https://api.razorpay.com',
      INVOICE_PREFIX: 'INV',
      SHIPROCKET_PICKUP_LOCATION: 'Primary',
      SHIPROCKET_API_URL: 'https://apiv2.shiprocket.in',
      SENTRY_TRACES_SAMPLE_RATE: 0.1,
      LOG_LEVEL: 'info',
      RATE_LIMIT_PER_MINUTE: 120,
      TRUST_PROXY: 'loopback',
    });
  });

  it('takes the GST seller details all together, with a GSTIN that checks out', () => {
    const seller = { SHOP_LEGAL_NAME: 'Shop Nest Private Limited', SHOP_GSTIN: '29abcde1234f1zw', SHOP_ADDRESS: '12 MG Road, Bengaluru 560001' };
    expect(validateEnv({ ...valid, ...seller }).SHOP_GSTIN).toBe('29ABCDE1234F1ZW');   // upper-cased
    expect(() => validateEnv({ ...valid, SHOP_GSTIN: seller.SHOP_GSTIN })).toThrow(/set all three or none/);
    expect(() => validateEnv({ ...valid, ...seller, SHOP_GSTIN: '29ABCDE1234F1ZX' })).toThrow(/SHOP_GSTIN: must be a valid 15-character GSTIN/);
  });

  it('takes the email and password of the Shiprocket API user together', () => {
    expect(validateEnv({ ...valid, SHIPROCKET_EMAIL: 'api@shop.in', SHIPROCKET_PASSWORD: 'p4ss' }).SHIPROCKET_EMAIL).toBe('api@shop.in');
    expect(() => validateEnv({ ...valid, SHIPROCKET_EMAIL: 'api@shop.in' })).toThrow(/set both or neither/);
    expect(() => validateEnv({ ...valid, SHIPROCKET_WEBHOOK_TOKEN: 'short' })).toThrow(/SHIPROCKET_WEBHOOK_TOKEN: must be at least 16/);
  });

  it('refuses a short JWT secret, which could be guessed', () => {
    expect(() => validateEnv({ ...valid, JWT_SECRET: 'secret' })).toThrow(/JWT_SECRET: must be at least 32 characters/);
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
    expect(() => validateEnv({ ...valid, DATABASE_URL: 'mysql://localhost/shop' })).toThrow(/postgresql/);
  });

  it('lists every problem at once, not just the first', () => {
    expect(() => validateEnv({ PORT: 'abc', WEB_ORIGIN: 'not a url' })).toThrow(/PORT[\s\S]*DATABASE_URL|DATABASE_URL[\s\S]*PORT/);
  });

  it('really sending email needs a Brevo key', () => {
    expect(() => validateEnv({ ...valid, EMAIL_TRANSPORT: 'brevo' })).toThrow(/BREVO_API_KEY: is required/);
    expect(validateEnv({ ...valid, EMAIL_TRANSPORT: 'brevo', BREVO_API_KEY: 'xkeysib-test' }).EMAIL_TRANSPORT).toBe('brevo');
  });

  it('Cloudinary needs all three settings, or none', () => {
    const cloudinary = { CLOUDINARY_CLOUD_NAME: 'shop', CLOUDINARY_API_KEY: '123456789012345', CLOUDINARY_API_SECRET: 'a-secret-value' };
    expect(validateEnv({ ...valid, ...cloudinary }).CLOUDINARY_CLOUD_NAME).toBe('shop');
    expect(() => validateEnv({ ...valid, CLOUDINARY_CLOUD_NAME: 'shop' })).toThrow(/set all three or none/);
    // An empty line in .env means "not set", not "set to nothing"
    expect(validateEnv({ ...valid, CLOUDINARY_CLOUD_NAME: '', CLOUDINARY_API_KEY: '', CLOUDINARY_API_SECRET: '' }).CLOUDINARY_CLOUD_NAME).toBeUndefined();
  });
});
