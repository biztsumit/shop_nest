import { Controller, Get, Header, Query, Res } from '@nestjs/common';
import { reportQuerySchema, type ReportQuery, type SalesReport } from '@shop/shared';
import type { Response } from 'express';
import { Auth } from '../auth/auth.decorator.js';
import { AdminReportsService } from './admin-reports.service.js';

@Auth('ADMIN')
@Controller('admin/reports')
export class AdminReportsController {
  constructor(private readonly reports: AdminReportsService) {}

  // GET /api/admin/reports/sales?days=30
  @Get('sales')
  sales(@Query({ schema: reportQuerySchema }) query: ReportQuery): Promise<SalesReport> {
    return this.reports.sales(query.days);
  }

  // GET /api/admin/reports/orders.csv?days=30: a file to open in a spreadsheet
  @Get('orders.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async ordersCsv(@Query({ schema: reportQuerySchema }) query: ReportQuery, @Res({ passthrough: true }) res: Response): Promise<string> {
    res.setHeader('Content-Disposition', `attachment; filename="orders-last-${query.days}-days.csv"`);
    // The "BOM" at the start tells Excel the file is UTF-8 (otherwise ₹ and names like
    // "Zoë" come out garbled)
    return `﻿${await this.reports.ordersCsv(query.days)}`;
  }
}
