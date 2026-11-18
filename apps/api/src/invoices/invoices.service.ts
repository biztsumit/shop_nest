import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  amountInWords,
  buildInvoiceLines,
  financialYear,
  GST_STATE_CODES,
  invoiceNumber,
  invoiceSchema,
  stateOfGstin,
  type Invoice,
} from '@shop/shared';
import type { Env } from '../config/env.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Db = Prisma.TransactionClient;
type StoredAddress = { fullName: string; line1: string; line2: string; city: string; state: string; pincode: string };

// GST INVOICES. One per paid order, issued in the SAME transaction that makes the order paid
// (OrdersService callers: an online payment captured, or cash collected on delivery), so a paid
// order and its invoice exist together or not at all.
//
// An order paid while invoices weren't set up gets its invoice the first time someone asks for
// it (see `find`).
@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  // The seller, or null when the shop hasn't set its GST details (then no invoices are issued)
  private seller(): Invoice['seller'] | null {
    const legalName = this.config.get('SHOP_LEGAL_NAME', { infer: true });
    const gstin = this.config.get('SHOP_GSTIN', { infer: true });
    const address = this.config.get('SHOP_ADDRESS', { infer: true });
    if (!legalName || !gstin || !address) return null;
    return { legalName, gstin, address, state: stateOfGstin(gstin)!, stateCode: gstin.slice(0, 2) };
  }

  // Issues the order's invoice, unless it has one already or invoices aren't set up. Call it
  // inside the transaction that marks the order paid.
  async issue(db: Db, orderId: string, at: Date): Promise<void> {
    const seller = this.seller();
    if (!seller) return;
    if (await db.invoice.findUnique({ where: { orderId }, select: { id: true } })) return;

    const order = await db.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: { orderBy: { position: 'asc' } }, user: { select: { name: true } } },
    });
    const address = order.shippingAddress as StoredAddress;
    const buyerStateCode = GST_STATE_CODES[address.state as keyof typeof GST_STATE_CODES];
    const interState = buyerStateCode !== seller.stateCode;
    const { lines, totals } = buildInvoiceLines({
      items: order.items.map((i) => {
        const options = Object.values(i.options as Record<string, string>).join(', ');
        return { description: options ? `${i.productName} (${options})` : i.productName, hsn: i.hsnCode, quantity: i.quantity, unitPrice: i.unitPrice, lineTotal: i.lineTotal, gstRate: i.gstRate };
      }),
      discount: order.discount,
      shippingFee: order.shippingFee,
      codFee: order.codFee,
      interState,
    });
    if (totals.total !== order.total) {
      // Can't happen: orders_total_adds_up guarantees the parts add up. Refuse rather than
      // issue a wrong tax record.
      throw new Error(`Invoice total ${totals.total} differs from order ${order.number} total ${order.total}`);
    }

    // The next number in this financial year's series. The counter row stays LOCKED until this
    // transaction ends, so two invoices issued at once get consecutive numbers, and a transaction
    // that fails gives its number back (no gaps).
    const year = financialYear(at);
    const [counter] = await db.$queryRaw<Array<{ last: number }>>`
      INSERT INTO invoice_counters (financial_year, last) VALUES (${year}, 1)
      ON CONFLICT (financial_year) DO UPDATE SET last = invoice_counters.last + 1
      RETURNING last`;
    const serial = counter!.last;
    const number = invoiceNumber(this.config.get('INVOICE_PREFIX', { infer: true }), year, serial);

    const data: Invoice = {
      number,
      issuedAt: at.toISOString(),
      orderNumber: order.number,
      orderDate: order.createdAt.toISOString(),
      paymentMethod: order.paymentMethod,
      seller,
      buyer: {
        name: address.fullName,
        address: [address.line1, address.line2, `${address.city} ${address.pincode}`].filter(Boolean),
        state: address.state,
        stateCode: buyerStateCode,
      },
      interState,
      lines,
      totals,
      amountInWords: amountInWords(totals.total),
    };
    await db.invoice.create({ data: { orderId, number, financialYear: year, serial, issuedAt: at, data } });
    this.logger.log({ orderId, number }, 'Invoice issued');
  }

  // The invoice of order `number`: the shopper's own (`userId`), or any order for an admin
  // (`userId` null). Issued now if the order was paid while invoices weren't set up.
  async find(number: string, userId: string | null): Promise<Invoice> {
    const order = await this.prisma.order.findFirst({
      where: { number, ...(userId ? { userId } : {}) },
      select: { id: true, paidAt: true, invoice: { select: { data: true } } },
    });
    if (!order) throw new NotFoundException('No such order');
    if (order.invoice) return invoiceSchema.parse(order.invoice.data);
    if (!order.paidAt) throw new NotFoundException('This order has no invoice yet: it is issued once the order is paid.');
    if (!this.seller()) throw new NotFoundException("Invoices aren't set up on this shop yet.");

    try {
      await this.prisma.$transaction((tx) => this.issue(tx, order.id, new Date()));
    } catch (err) {
      // Someone else issued it at the same moment: theirs is the one
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
    }
    const issued = await this.prisma.invoice.findUniqueOrThrow({ where: { orderId: order.id }, select: { data: true } });
    return invoiceSchema.parse(issued.data);
  }
}
