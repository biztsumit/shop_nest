import type { CookieOptions, Request, Response } from 'express';

// The refresh token travels in a cookie, never in a response body:
// - httpOnly: page JavaScript can't read it, so a malicious script (XSS) can't steal it
// - secure: only sent over HTTPS (turned off for http://localhost in development)
// - sameSite "lax": not sent with requests that other websites trigger (forms, fetch), which
//   stops them from using your login (CSRF). Clicking a normal link still works.
// - path /api/auth: only sent to the login endpoints, not with every API request
export const REFRESH_COOKIE = 'refresh_token';
const PATH = '/api/auth';

const options = (secure: boolean): CookieOptions => ({ httpOnly: true, secure, sameSite: 'lax', path: PATH });

export const setRefreshCookie = (res: Response, token: string, expiresAt: Date, secure: boolean): void => {
  res.cookie(REFRESH_COOKIE, token, { ...options(secure), expires: expiresAt });
};

// Clearing needs the same path (and flags) the cookie was set with, or the browser keeps it
export const clearRefreshCookie = (res: Response, secure: boolean): void => {
  res.clearCookie(REFRESH_COOKIE, options(secure));
};

export const readRefreshCookie = (req: Request): string | undefined => {
  const value: unknown = req.cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};
