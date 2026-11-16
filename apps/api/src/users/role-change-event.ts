import type { Role } from '@shop/shared';
import type { AuditInput } from '../audit/record.js';
import type { User as UserRow } from '../generated/prisma/client.js';

// The audit record of a role change. Its own file, free of Nest, because the make-admin script
// (which runs without the app) writes it too, with actorId null.
export const roleChangeEvent = (actorId: string | null, user: UserRow, from: Role): AuditInput => ({
  actorId,
  action: 'user.role_change',
  entityType: 'user',
  entityId: user.id,
  summary: `${user.name} (${user.email}): ${from.toLowerCase()} → ${user.role.toLowerCase()}`,
  changes: { role: { from, to: user.role } },
});
