import { Controller, Get, Query } from '@nestjs/common';
import { auditListQuerySchema, type AuditEvent, type AuditListQuery, type Page } from '@shop/shared';
import { Auth } from '../auth/auth.decorator.js';
import { AuditService } from './audit.service.js';

// Reading the log: admins only. There is no route that changes it.
@Auth('ADMIN')
@Controller('admin/audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  // GET /api/admin/audit?entityType=order&entityId=SN000123&actorId=<id>&limit=50&cursor=<last id>
  @Get()
  list(@Query({ schema: auditListQuerySchema }) query: AuditListQuery): Promise<Page<AuditEvent>> {
    return this.audit.list(query);
  }
}
