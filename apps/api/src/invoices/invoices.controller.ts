import { Controller, Get, Header, Param, StreamableFile } from '@nestjs/common';
import { orderNumberSchema, type Invoice } from '@shop/shared';
import { Auth } from '../auth/auth.decorator.js';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { renderInvoicePdf } from './invoice-pdf.js';
import { InvoicesService } from './invoices.service.js';

// The invoice of a paid order, as a PDF to save or print: the shopper's own, or any order for
// an admin. 404 while the order isn't paid (or the shop hasn't set up invoices).
@Controller()
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  // GET /api/orders/SN000123/invoice
  @Auth()
  @Get('orders/:number/invoice')
  // A tax document with a name and address: never kept by a shared cache
  @Header('Cache-Control', 'private, no-store')
  async mine(@CurrentUser() user: AuthUser, @Param('number', { schema: orderNumberSchema }) number: string): Promise<StreamableFile> {
    return pdf(await this.invoices.find(number, user.id));
  }

  // GET /api/admin/orders/SN000123/invoice
  @Auth('ADMIN')
  @Get('admin/orders/:number/invoice')
  @Header('Cache-Control', 'private, no-store')
  async any(@Param('number', { schema: orderNumberSchema }) number: string): Promise<StreamableFile> {
    return pdf(await this.invoices.find(number, null));
  }
}

// Binary, so a StreamableFile: sent as raw bytes, never turned into JSON or text
const pdf = async (invoice: Invoice): Promise<StreamableFile> =>
  new StreamableFile(await renderInvoicePdf(invoice), {
    type: 'application/pdf',
    disposition: `attachment; filename="invoice-${invoice.number}.pdf"`,
  });
