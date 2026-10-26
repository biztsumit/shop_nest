import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@shop/shared';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';

// @Roles('ADMIN') on a route or controller: a typed piece of METADATA (a label) that the
// guard below reads. Reflector.createDecorator makes the decorator and its type in one go.
export const Roles = Reflector.createDecorator<Role[]>();

// Runs AFTER AccessTokenGuard (which proved who the user is) and checks they may do this.
// 401 = "we don't know who you are"; 403 = "we know who you are, and you may not".
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // The roles on the handler win over the ones on its controller
    const required = this.reflector.getAllAndOverride(Roles, [context.getHandler(), context.getClass()]);
    if (!required || required.length === 0) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request>();
    if (!req.user) {
      throw new UnauthorizedException('Please log in first.');
    }

    // The role in the access token can be up to 15 minutes old. For role-restricted routes
    // (admin tools: few, and powerful) the CURRENT role is read from the database instead,
    // so a demoted admin loses access immediately, not "at their next refresh".
    const user = await this.prisma.user.findUnique({ where: { id: req.user.id }, select: { role: true } });
    if (!user) {
      throw new UnauthorizedException('Your session has ended. Please log in again.');
    }
    if (!required.includes(user.role)) {
      throw new ForbiddenException("You don't have permission to do that.");
    }
    req.user.role = user.role;
    return true;
  }
}
