import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { changeRoleSchema, type AdminUser, type ChangeRole, type Page } from '@shop/shared';
import { z } from 'zod';
import { Auth } from '../auth/auth.decorator.js';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { UsersService } from './users.service.js';

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.uuid().optional(),
});

// Every route here: admins only (one decorator on the class covers them all)
@Auth('ADMIN')
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: UsersService) {}

  // GET /api/admin/users?limit=50&cursor=<last id>
  @Get()
  list(@Query({ schema: listQuerySchema }) query: z.infer<typeof listQuerySchema>): Promise<Page<AdminUser>> {
    return this.users.list(query.limit, query.cursor);
  }

  // PATCH /api/admin/users/:id/role  { role: "ADMIN" | "CUSTOMER" }
  @Patch(':id/role')
  changeRole(
    @CurrentUser() actor: AuthUser,
    @Param('id', { schema: z.uuid() }) id: string,
    @Body({ schema: changeRoleSchema }) body: ChangeRole,
  ): Promise<AdminUser> {
    return this.users.changeRole(actor.id, id, body.role);
  }
}
