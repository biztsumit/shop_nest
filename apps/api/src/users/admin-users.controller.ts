import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import {
  adminUserListQuerySchema,
  changeRoleSchema,
  type AdminUser,
  type AdminUserListQuery,
  type ChangeRole,
  type Page,
} from '@shop/shared';
import { z } from 'zod';
import { Auth } from '../auth/auth.decorator.js';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { UsersService } from './users.service.js';

// Every route here: admins only (one decorator on the class covers them all)
@Auth('ADMIN')
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: UsersService) {}

  // GET /api/admin/users?role=ADMIN&search=riya&limit=50&cursor=<last id>
  @Get()
  list(@Query({ schema: adminUserListQuerySchema }) query: AdminUserListQuery): Promise<Page<AdminUser>> {
    return this.users.list(query);
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
