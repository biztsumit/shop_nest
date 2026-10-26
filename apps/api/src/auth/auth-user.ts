import type { Role } from '@shop/shared';

// Who is making the request, as proven by their access token
export type AuthUser = { id: string; role: Role };

// The token's payload. `sub` (subject) = the user id: the standard JWT name for "who this is about"
export type AccessTokenPayload = { sub: string; role: Role };

// Teach TypeScript that an Express request can carry the logged-in user (set by the guard)
declare module 'express' {
  interface Request {
    user?: AuthUser;
  }
}
