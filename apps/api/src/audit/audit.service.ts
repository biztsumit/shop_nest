import { Injectable } from '@nestjs/common';
import type { AuditAction, AuditEntityType, AuditEvent, AuditListQuery, Page } from '@shop/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { recordAudit, type AuditInput } from './record.js';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  record(db: Prisma.TransactionClient, event: AuditInput): Promise<void> {
    return recordAudit(db, event);
  }

  // Newest first (ids are UUID v7: time-ordered)
  async list({ entityType, entityId, actorId, limit, cursor }: AuditListQuery): Promise<Page<AuditEvent>> {
    const rows = await this.prisma.auditEvent.findMany({
      where: {
        ...(entityType ? { entityType } : {}),
        ...(entityId ? { entityId } : {}),
        ...(actorId ? { actorId } : {}),
        ...(cursor ? { id: { lt: cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: limit + 1,
      include: { actor: { select: { id: true, name: true, email: true } } },
    });
    const page = rows.slice(0, limit);
    return {
      data: page.map((e) => ({
        id: e.id,
        action: e.action as AuditAction,
        entityType: e.entityType as AuditEntityType,
        entityId: e.entityId,
        summary: e.summary,
        changes: e.changes as AuditEvent['changes'],
        actor: e.actor,
        createdAt: e.createdAt.toISOString(),
      })),
      nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
    };
  }
}
