import { applyDecorators, UseGuards } from '@nestjs/common';
import type { Role } from '@shop/shared';
import { AccessTokenGuard } from './access-token.guard.js';
import { Roles, RolesGuard } from './roles.guard.js';

// One decorator for "who may call this", composed from smaller ones with applyDecorators:
//   @Auth()          any logged-in user
//   @Auth('ADMIN')   logged-in AND an admin (checked against the database)
// The guards run in this order: first "who are you" (token), then "may you" (role).
export const Auth = (...roles: Role[]) =>
  roles.length === 0
    ? UseGuards(AccessTokenGuard)
    : applyDecorators(Roles(roles), UseGuards(AccessTokenGuard, RolesGuard));
