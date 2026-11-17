import { Controller, Delete, Get, HttpCode, Param, Put } from '@nestjs/common';
import { z } from 'zod';
import { Auth } from '../auth/auth.decorator.js';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { StockAlertsService } from './stock-alerts.service.js';

// "Notify me when it's back": needs an account (the email goes to it)
@Auth()
@Controller('stock-alerts')
export class StockAlertsController {
  constructor(private readonly alerts: StockAlertsService) {}

  // GET /api/stock-alerts/ids → ["<variant id>", ...] still waiting
  @Get('ids')
  ids(@CurrentUser() user: AuthUser): Promise<string[]> {
    return this.alerts.waitingIds(user.id);
  }

  // PUT /api/stock-alerts/:variantId (start waiting), DELETE (stop). Both idempotent.
  @Put(':variantId')
  @HttpCode(204)
  watch(@CurrentUser() user: AuthUser, @Param('variantId', { schema: z.uuid() }) variantId: string): Promise<void> {
    return this.alerts.watch(user.id, variantId);
  }

  @Delete(':variantId')
  @HttpCode(204)
  unwatch(@CurrentUser() user: AuthUser, @Param('variantId', { schema: z.uuid() }) variantId: string): Promise<void> {
    return this.alerts.unwatch(user.id, variantId);
  }
}
