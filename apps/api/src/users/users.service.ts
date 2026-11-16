import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AdminUser, AdminUserListQuery, Page, Role } from '@shop/shared';
import type { User as UserRow } from '../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { toPublicUser } from '../auth/auth.service.js';
import { escapeLike } from '../catalog/catalog.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { roleChangeEvent } from './role-change-event.js';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // Newest first. ids are UUID v7 (time-ordered), so the cursor is simply the last id seen.
  // `search` matches part of the name (any capitals) or of the email (always stored lower-case).
  async list({ role, search, limit, cursor }: AdminUserListQuery): Promise<Page<AdminUser>> {
    const term = search && escapeLike(search);
    const rows = await this.prisma.user.findMany({
      where: {
        ...(role ? { role } : {}),
        ...(term ? { OR: [{ name: { contains: term, mode: 'insensitive' } }, { email: { contains: term.toLowerCase() } }] } : {}),
        ...(cursor ? { id: { lt: cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    return { data: page.map(toAdminUser), nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null };
  }

  // The shop must always keep at least one admin, or nobody could ever manage it again.
  //
  // Checking "is there another admin?" and then updating is NOT enough: two admins demoting
  // each other at the same instant would both see "yes, there's another one" and both succeed,
  // leaving none. So, inside one transaction, every admin row is LOCKED first
  // (SELECT ... FOR UPDATE). A second transaction trying the same waits at that line until the
  // first one finishes, and then sees the updated roles.
  async changeRole(actorId: string, userId: string, role: Role): Promise<AdminUser> {
    const user = await this.prisma.$transaction(async (tx) => {
      const admins = await tx.$queryRaw<Array<{ id: string }>>`SELECT id::text FROM users WHERE role = 'ADMIN' FOR UPDATE`;
      const target = await tx.user.findUnique({ where: { id: userId } });
      if (!target) {
        throw new NotFoundException('No such user');
      }
      if (target.role === 'ADMIN' && role !== 'ADMIN' && admins.length <= 1) {
        throw new ConflictException("This is the shop's last admin. Make someone else an admin first.");
      }
      const updated = await tx.user.update({ where: { id: userId }, data: { role } });
      if (target.role !== role) {
        await this.audit.record(tx, roleChangeEvent(actorId, updated, target.role));
      }
      return updated;
    });

    this.logger.log({ actorId, userId, role }, 'User role changed');
    return toAdminUser(user);
  }
}

// The public fields (one definition, in AuthService), plus what only admins see
const toAdminUser = (user: UserRow): AdminUser => ({ ...toPublicUser(user), createdAt: user.createdAt.toISOString() });
