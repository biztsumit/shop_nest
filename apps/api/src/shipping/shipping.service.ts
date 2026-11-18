import { ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { normaliseShipmentStatus, parseCourierTime, shipmentPhase, type AdminOrder, type BookShipment, type OrderAddress } from '@shop/shared';
import { AdminOrdersService } from '../admin/admin-orders.service.js';
import { AuditService } from '../audit/audit.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ShiprocketClient, type ShiprocketOrderInput, type ShiprocketScan } from './shiprocket.client.js';

// What a courier told us about a parcel, from a webhook or from asking (the tracking job)
type TrackingUpdate = {
  status: string;               // "IN TRANSIT" (normalised)
  statusId: number | null;      // Shiprocket's numeric status, when given
  at: Date;
  events: Array<{ status: string; activity: string; location: string; at: Date }>;
};

// The parts of Shiprocket's tracking webhook we read (it sends more)
type ShiprocketWebhook = {
  awb?: string | number;
  current_status?: string;
  shipment_status?: string;
  shipment_status_id?: number;
  current_timestamp?: string;
  scans?: ShiprocketScan[];
};

// Orders that can be booked: paid online, or cash on delivery and confirmed
const READY_TO_SHIP = ['PAID', 'CONFIRMED'] as const;

const SHIPMENT_FOR_ORDER = {
  items: { orderBy: { position: 'asc' } },
  user: { select: { email: true } },
  shipments: { where: { cancelledAt: null } },
} satisfies Prisma.OrderInclude;
type OrderForBooking = Prisma.OrderGetPayload<{ include: typeof SHIPMENT_FOR_ORDER }>;

const IST = 5.5 * 60 * 60 * 1000;
const rupees = (paise: number): number => paise / 100;
const clip = (text: string, max: number): string => text.slice(0, max);

// Parcels with Shiprocket: booking one (courier, tracking number, label, pickup), calling it off
// before pickup, and following it. Tracking reaches us two ways: Shiprocket's webhook (at once),
// and a job every 30 minutes that asks about parcels still on their way (for webhooks that never
// arrived). Both go through applyUpdate, which moves the ORDER on: picked up → shipped,
// delivered → delivered (cash on delivery: paid), back at the shop → returned.
@Injectable()
export class ShippingService {
  private readonly logger = new Logger(ShippingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly shiprocket: ShiprocketClient,
    private readonly orders: AdminOrdersService,
    private readonly audit: AuditService,
  ) {}

  // Books the order's parcel. Several calls to Shiprocket, any of which can fail, so each step
  // is saved as it succeeds and calling this again CONTINUES from where it stopped (e.g. the
  // pickup request failed after the courier was assigned).
  async book(number: string, pkg: BookShipment, actorId: string): Promise<AdminOrder> {
    if (!this.shiprocket.enabled) throw new ServiceUnavailableException("Shipping with Shiprocket isn't set up on this shop.");
    const order = await this.prisma.order.findUnique({ where: { number }, include: SHIPMENT_FOR_ORDER });
    if (!order) throw new NotFoundException('No such order');
    if (!(READY_TO_SHIP as readonly string[]).includes(order.status)) {
      throw new ConflictException(`Only paid orders (or cash-on-delivery orders) waiting to ship can be booked; this one is ${order.status.toLowerCase().replace('_', ' ')}.`);
    }
    let shipment = order.shipments[0];
    if (shipment && shipment.provider !== 'SHIPROCKET') throw new ConflictException('This order already went with another courier.');
    if (shipment?.awb && shipment.labelUrl && shipment.pickupRequestedAt) throw new ConflictException('This parcel is already booked.');

    if (!shipment) {
      // THE CLAIM: the row is written before anything is booked. The database allows one
      // active shipment per order, so a second click (or a second admin) stops here.
      try {
        shipment = await this.prisma.shipment.create({ data: { orderId: order.id, provider: 'SHIPROCKET', status: 'BOOKING', statusAt: new Date() } });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ConflictException('This order is being booked right now (by someone else, or a second click).');
        }
        throw err;
      }
    }

    if (!shipment.providerShipmentId) {
      try {
        const created = await this.shiprocket.createOrder(this.orderInput(order, pkg));
        shipment = await this.prisma.shipment.update({
          where: { id: shipment.id },
          data: { providerOrderId: created.orderId, providerShipmentId: created.shipmentId, status: 'NEW', statusAt: new Date() },
        });
      } catch (err) {
        // Nothing was booked: let go of the claim, so the admin can fix the problem and try again
        await this.prisma.shipment.delete({ where: { id: shipment.id } });
        throw err;
      }
    }
    const shipmentId = shipment.providerShipmentId!;

    if (!shipment.awb) {
      // If this fails, the row stays (Shiprocket has the order): trying again picks up here
      const { awb, courierName } = await this.shiprocket.assignAwb(shipmentId);
      const now = new Date();
      shipment = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.shipment.update({
          where: { id: shipment!.id },
          data: { awb, courierName: clip(courierName, 100), trackingUrl: `https://shiprocket.co/tracking/${encodeURIComponent(awb)}`, status: 'AWB ASSIGNED', statusAt: now },
        });
        await this.audit.record(tx, {
          actorId,
          action: 'shipment.book',
          entityType: 'order',
          entityId: number,
          summary: `${number}: booked with ${courierName} (Shiprocket), tracking number ${awb}, ${pkg.weightGrams} g, ${pkg.lengthCm}×${pkg.breadthCm}×${pkg.heightCm} cm`,
          changes: { awb: { from: null, to: awb } },
        });
        return updated;
      });
      this.logger.log({ number, awb, courierName }, 'Parcel booked with Shiprocket');
    }

    // The label and the pickup are worth having but not worth failing the booking over: the
    // admin page shows what's missing, and booking again tries again
    if (!shipment.labelUrl) {
      try {
        const labelUrl = await this.shiprocket.label(shipmentId);
        shipment = await this.prisma.shipment.update({ where: { id: shipment.id }, data: { labelUrl: clip(labelUrl, 500) } });
      } catch (err) {
        this.logger.warn({ err, number }, 'Shiprocket label not made yet');
      }
    }
    if (!shipment.pickupRequestedAt) {
      try {
        await this.shiprocket.requestPickup(shipmentId);
        await this.prisma.shipment.update({ where: { id: shipment.id }, data: { pickupRequestedAt: new Date(), status: 'PICKUP SCHEDULED', statusAt: new Date() } });
      } catch (err) {
        this.logger.warn({ err, number }, 'Shiprocket pickup not requested yet');
      }
    }
    return this.orders.get(number);
  }

  // Calls the booking off, before the courier has the parcel. The order is ready to ship again
  // (or can be cancelled, for cash on delivery).
  async cancel(number: string, actorId: string): Promise<AdminOrder> {
    const order = await this.prisma.order.findUnique({ where: { number }, include: { shipments: { where: { cancelledAt: null } } } });
    if (!order) throw new NotFoundException('No such order');
    const shipment = order.shipments[0];
    if (!shipment) throw new ConflictException('This order has no booked parcel.');
    if (!(READY_TO_SHIP as readonly string[]).includes(order.status)) {
      throw new ConflictException('The courier has the parcel already, so the booking can\'t be cancelled.');
    }
    if (shipment.providerOrderId) await this.shiprocket.cancel(shipment.providerOrderId);
    await this.prisma.$transaction(async (tx) => {
      await tx.shipment.update({ where: { id: shipment.id }, data: { cancelledAt: new Date(), status: 'CANCELED', statusAt: new Date() } });
      await this.audit.record(tx, {
        actorId,
        action: 'shipment.cancel',
        entityType: 'order',
        entityId: number,
        summary: `${number}: shipment cancelled${shipment.awb ? ` (tracking number ${shipment.awb})` : ''}`,
        changes: { awb: { from: shipment.awb, to: null } },
      });
    });
    this.logger.log({ number, awb: shipment.awb }, 'Shipment cancelled');
    return this.orders.get(number);
  }

  // POST /api/webhooks/courier, from Shiprocket. Trust comes from the token in x-api-key.
  async handleWebhook(token: string | undefined, body: ShiprocketWebhook): Promise<void> {
    if (!this.shiprocket.isValidWebhookToken(token)) {
      this.logger.warn('Courier webhook with a wrong or missing token');
      throw new UnauthorizedException('Invalid token');
    }
    const awb = body.awb == null ? '' : String(body.awb);
    const status = body.shipment_status ?? body.current_status;
    if (!awb || !status) return;   // Shiprocket's "test" pings: nothing to do
    const shipment = await this.findByAwb(awb);
    // Not ours (another shop on the same account), or long gone: acknowledge and move on
    if (!shipment) return;
    const events = (body.scans ?? []).map(toEvent).filter((e) => e !== null);
    const at = parseCourierTime(body.current_timestamp) ?? events.reduce<Date | null>((latest, e) => (!latest || e.at > latest ? e.at : latest), null) ?? new Date();
    const normalised = normaliseShipmentStatus(status);
    await this.applyUpdate(shipment.id, {
      status: normalised,
      statusId: body.shipment_status_id ?? null,
      at,
      events: events.length > 0 ? events : [{ status: normalised, activity: status, location: '', at }],
    });
  }

  // The tracking job: asks about parcels still on their way that nobody heard about lately.
  // Returns how many it asked about.
  async reconcile(now = new Date()): Promise<number> {
    const due = await this.prisma.shipment.findMany({
      where: {
        provider: 'SHIPROCKET',
        cancelledAt: null,
        awb: { not: null },
        order: { status: { in: ['PAID', 'CONFIRMED', 'SHIPPED'] } },
        OR: [{ checkedAt: null }, { checkedAt: { lt: new Date(now.getTime() - 25 * 60 * 1000) } }],
      },
      orderBy: [{ checkedAt: { sort: 'asc', nulls: 'first' } }],
      take: 50,
      select: { id: true, awb: true },
    });
    for (const { id, awb } of due) {
      try {
        const { tracking_data: data } = await this.shiprocket.track(awb!);
        await this.prisma.shipment.update({ where: { id }, data: { checkedAt: now } });
        const status = data.shipment_track?.[0]?.current_status;
        if (!status || data.error) continue;   // nothing scanned yet
        const events = (data.shipment_track_activities ?? []).map(toEvent).filter((e) => e !== null);
        const latest = events.reduce<Date | null>((l, e) => (!l || e.at > l ? e.at : l), null);
        await this.applyUpdate(id, { status: normaliseShipmentStatus(status), statusId: data.shipment_status ?? null, at: latest ?? now, events });
      } catch (err) {
        // One parcel's problem doesn't stop the others; it's asked about again next run
        this.logger.warn({ err, awb }, 'Tracking check failed');
      }
    }
    return due.length;
  }

  // Records what the courier said, then moves the order on to match. Safe to repeat: steps
  // already stored are skipped, and each order move is a claim that happens once.
  private async applyUpdate(shipmentId: string, update: TrackingUpdate): Promise<void> {
    await this.prisma.shipmentEvent.createMany({
      data: update.events.map((e) => ({ shipmentId, status: clip(e.status, 60), activity: clip(e.activity, 300), location: clip(e.location, 150), at: e.at })),
      skipDuplicates: true,
    });
    // Updates can arrive out of order: an older one doesn't replace the latest status
    await this.prisma.shipment.updateMany({
      where: { id: shipmentId, statusAt: { lte: update.at } },
      data: { status: clip(update.status, 60), statusAt: update.at },
    });

    const shipment = await this.prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId }, include: { order: { select: { number: true, status: true, paymentMethod: true } } } });
    if (shipment.cancelledAt) return;
    const { number, paymentMethod } = shipment.order;
    let status = shipment.order.status;
    const via = `Shiprocket: ${update.status}`;
    const phase = shipmentPhase(update.status, update.statusId);

    if ((phase === 'moving' || phase === 'delivered' || phase === 'returned') && (READY_TO_SHIP as readonly string[]).includes(status)) {
      status = (await this.quietly(this.orders.move(number, 'ship', null, { via })))?.status ?? status;
    }
    if (phase === 'delivered' && status === 'SHIPPED') {
      await this.quietly(this.orders.move(number, 'deliver', null, { via }));
    }
    if (phase === 'returned' && status === 'SHIPPED') {
      if (paymentMethod === 'COD') {
        await this.quietly(this.orders.markReturned(number, null, via));
      } else {
        // A paid parcel back at the shop: the shopper is owed a refund, which an admin makes
        // (with restock) after checking the parcel
        this.logger.warn({ number }, 'Paid parcel returned to the shop: refund it from the order page');
      }
    }
    if (phase === 'cancelled' && (READY_TO_SHIP as readonly string[]).includes(status)) {
      // Called off in Shiprocket's panel: the order is free to be booked again
      await this.prisma.$transaction(async (tx) => {
        const cancelled = await tx.shipment.updateMany({ where: { id: shipmentId, cancelledAt: null }, data: { cancelledAt: new Date() } });
        if (cancelled.count === 0) return;
        await this.audit.record(tx, {
          actorId: null,
          action: 'shipment.cancel',
          entityType: 'order',
          entityId: number,
          summary: `${number}: shipment cancelled (${via})`,
          changes: { awb: { from: shipment.awb, to: null } },
        });
      });
    }
  }

  // Someone (an admin, or the other way tracking arrives) moved the order first: that's fine
  private async quietly<T>(move: Promise<T>): Promise<T | null> {
    try {
      return await move;
    } catch (err) {
      if (err instanceof ConflictException) return null;
      throw err;
    }
  }

  // The newest booking with that tracking number (a cancelled one's number could be reused)
  private findByAwb(awb: string) {
    return this.prisma.shipment.findFirst({ where: { awb, provider: 'SHIPROCKET' }, orderBy: [{ cancelledAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }], select: { id: true } });
  }

  // The order as Shiprocket wants it: rupees, kilograms, the address split into its fields
  private orderInput(order: OrderForBooking, pkg: BookShipment): ShiprocketOrderInput {
    const address = order.shippingAddress as OrderAddress;
    // "2026-11-18 14:05", India time
    const placed = new Date(order.createdAt.getTime() + IST).toISOString().slice(0, 16).replace('T', ' ');
    return {
      order_id: order.number,
      order_date: placed,
      pickup_location: this.shiprocket.pickupLocation,
      billing_customer_name: address.fullName,
      billing_last_name: '',
      billing_address: address.line1,
      billing_address_2: address.line2,
      billing_city: address.city,
      billing_pincode: address.pincode,
      billing_state: address.state,
      billing_country: 'India',
      billing_email: order.user.email,
      billing_phone: address.phone,
      shipping_is_billing: true,
      order_items: order.items.map((i) => {
        const options = Object.values(i.options as Record<string, string>);
        return {
          name: options.length ? `${i.productName} (${options.join(', ')})` : i.productName,
          sku: i.sku ?? i.variantId ?? i.productSlug,
          units: i.quantity,
          selling_price: rupees(i.unitPrice),
          hsn: i.hsnCode,
        };
      }),
      // What the courier collects for cash on delivery is worked out from these
      payment_method: order.paymentMethod === 'COD' ? 'COD' : 'Prepaid',
      sub_total: rupees(order.subtotal),
      shipping_charges: rupees(order.shippingFee),
      transaction_charges: rupees(order.codFee),
      total_discount: rupees(order.discount),
      length: pkg.lengthCm,
      breadth: pkg.breadthCm,
      height: pkg.heightCm,
      weight: pkg.weightGrams / 1000,
    };
  }
}

// One scan from Shiprocket → a step of the journey (null if its time can't be read)
const toEvent = (scan: ShiprocketScan): TrackingUpdate['events'][number] | null => {
  const at = parseCourierTime(scan.date);
  if (!at) return null;
  return {
    status: normaliseShipmentStatus(scan['sr-status-label'] || scan.status || 'UPDATE'),
    activity: scan.activity || scan['sr-status-label'] || '',
    location: scan.location ?? '',
    at,
  };
};
