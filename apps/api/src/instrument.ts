// Error tracking and tracing (Sentry). Loaded BEFORE the app:
//
//   node --import ./dist/instrument.js dist/main.js
//
// "Before" matters: tracing works by wrapping modules (http, express, pg) as they are first
// loaded, and in an ES-module app that's only possible from a module loaded with --import.
// Without SENTRY_DSN this file does nothing at all, so it's always safe to load.
import * as Sentry from '@sentry/node';

const dsn = process.env.SENTRY_DSN?.trim();

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    // The share of requests traced end to end (0.1 = one in ten): enough to see slow spots
    // without paying to record every request
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    // Never send personal data to a third party. Careful: in this SDK version everything here
    // is COLLECTED BY DEFAULT, including request bodies (a login's password, an address) and
    // headers (the Authorization token, the refresh cookie). Each one is switched off.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    },
  });
}
