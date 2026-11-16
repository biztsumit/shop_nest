import type { AuditAction, AuditEntityType } from '@shop/shared';
import type { Prisma } from '../generated/prisma/client.js';
import type { Changes } from './changes.js';

export type AuditInput = {
  actorId: string | null;   // null = the shop itself
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  summary: string;
  changes?: Changes;
};

// Writes one event. Always pass the TRANSACTION the change itself runs in: if the change rolls
// back, so does its record, and a record never describes a change that didn't happen.
// Free of Nest, so scripts (make-admin) can log what they change too.
export const recordAudit = async (db: Prisma.TransactionClient, event: AuditInput): Promise<void> => {
  await db.auditEvent.create({ data: { ...event, summary: event.summary.slice(0, 500), changes: event.changes ?? {} } });
};
